import "server-only";

import { writeAuditEvent } from "@/lib/careon-audit/audit.server";

import {
  resolveTgcWorkerAgeBucket,
  resolveTgcWorkerAvailability,
  TGC_WORKER_MONITOR_ACTIONS,
  type TgcSyncWorkerState,
  type TgcWorkerAgeBucket,
  tgcWorkerMonitorAction,
  tgcWorkerStateChanged,
  tgcWorkerStateFromMonitorAction,
} from "./tgc-sync-jobs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONNECTOR_ORG_SLUG = process.env.CAREON_TGC_ORG_SLUG?.trim() || "tgc";

interface OrganizationRow {
  id: string;
}

interface WorkerRow {
  last_seen_at: string;
}

interface AuditRow {
  action: string;
}

export type TgcWorkerMonitorResult =
  | {
      status: "completed";
      state: TgcSyncWorkerState;
      changed: boolean;
      ageBucket: TgcWorkerAgeBucket;
    }
  | { status: "not_configured" | "unavailable" | "audit_failed" };

async function serviceGet<T>(path: string): Promise<T | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Metadata-only monitor for the one TGC ingestion worker. It never reads job
 * payloads, export contents, patient tables or portal credentials.
 */
export async function monitorTgcWorker(nowMs = Date.now()): Promise<TgcWorkerMonitorResult> {
  if (!SUPABASE_URL || !SERVICE_KEY) return { status: "not_configured" };

  const orgParams = new URLSearchParams({ select: "id", slug: `eq.${CONNECTOR_ORG_SLUG}`, limit: "2" });
  const organizations = await serviceGet<OrganizationRow[]>(`organizations?${orgParams}`);
  if (!organizations) return { status: "unavailable" };
  if (organizations.length === 0) return { status: "not_configured" };
  if (organizations.length !== 1) return { status: "unavailable" };
  const orgId = organizations[0].id;

  const workerParams = new URLSearchParams({ select: "last_seen_at", org_id: `eq.${orgId}`, limit: "1" });
  const workers = await serviceGet<WorkerRow[]>(`careon_tgc_sync_workers?${workerParams}`);
  if (!workers) return { status: "unavailable" };
  const lastSeenAt = workers[0]?.last_seen_at ?? null;
  const { state } = resolveTgcWorkerAvailability(lastSeenAt, nowMs);
  const ageBucket = resolveTgcWorkerAgeBucket(lastSeenAt, nowMs);

  const auditParams = new URLSearchParams({
    select: "action",
    org_id: `eq.${orgId}`,
    action: `in.(${TGC_WORKER_MONITOR_ACTIONS.join(",")})`,
    order: "created_at.desc,id.desc",
    limit: "1",
  });
  const auditRows = await serviceGet<AuditRow[]>(`audit_events?${auditParams}`);
  if (!auditRows) return { status: "unavailable" };
  const previousAction = auditRows[0]?.action;
  const changed = tgcWorkerStateChanged(previousAction, state);

  if (changed) {
    const recorded = await writeAuditEvent({
      action: tgcWorkerMonitorAction(state),
      orgId,
      resource: "careon_tgc_sync_workers",
      detail: {
        state,
        previous: tgcWorkerStateFromMonitorAction(previousAction),
        ageBucket,
      },
    });
    if (!recorded) return { status: "audit_failed" };
  }

  return { status: "completed", state, changed, ageBucket };
}
