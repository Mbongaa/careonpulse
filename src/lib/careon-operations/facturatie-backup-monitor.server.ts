import "server-only";

import {
  type FacturatieBackupStatusInput,
  type OperationsAlertAgeBucket,
  resolveFacturatieBackupMonitorConfiguration,
  resolveFacturatieBackupObservation,
} from "./operations-alerts";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const CONNECTOR_ORG_SLUG = process.env.CAREON_TGC_ORG_SLUG?.trim() || "tgc";

interface OrganizationRow {
  id: string;
}

interface BackupStatusRow {
  last_result?: unknown;
  last_attempt_at?: unknown;
  last_success_at?: unknown;
}

export type FacturatieBackupMonitorResult =
  | { status: "disabled" }
  | { status: "misconfigured" | "not_configured" | "unavailable" | "transition_failed" }
  | {
      status: "completed";
      state: "healthy" | "failed" | "stale" | "unknown";
      ageBucket: OperationsAlertAgeBucket;
      changed: boolean;
    };

function serviceHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function serviceGet<T>(path: string): Promise<T | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: serviceHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function recordTransition(
  orgId: string,
  state: "healthy" | "failed" | "stale" | "unknown",
  ageBucket: OperationsAlertAgeBucket,
): Promise<{ changed: boolean } | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/careon_record_facturatie_backup_transition`, {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ p_org_id: orgId, p_state: state, p_age_bucket: ageBucket }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const value = (await response.json()) as Record<string, unknown>;
    return value.status === "completed" && typeof value.changed === "boolean" ? { changed: value.changed } : null;
  } catch {
    return null;
  }
}

function parseStatus(row: BackupStatusRow | undefined): FacturatieBackupStatusInput | null {
  if (!row) return null;
  if (
    (row.last_result !== "healthy" && row.last_result !== "failed") ||
    typeof row.last_attempt_at !== "string" ||
    (row.last_success_at !== null && typeof row.last_success_at !== "string")
  ) {
    return {
      lastResult: "failed" as const,
      lastAttemptAt: "invalid",
      lastSuccessAt: null,
    };
  }
  return {
    lastResult: row.last_result,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
  };
}

/** Reads only the latest metadata-only backup result and derives freshness. */
export async function monitorFacturatieBackup(nowMs = Date.now()): Promise<FacturatieBackupMonitorResult> {
  const configuration = resolveFacturatieBackupMonitorConfiguration(process.env);
  if (configuration.status === "disabled") return { status: "disabled" };
  if (configuration.status === "invalid") return { status: "misconfigured" };
  if (!SUPABASE_URL || !SERVICE_KEY) return { status: "unavailable" };

  const orgParams = new URLSearchParams({ select: "id", slug: `eq.${CONNECTOR_ORG_SLUG}`, limit: "2" });
  const organizations = await serviceGet<OrganizationRow[]>(`organizations?${orgParams}`);
  if (!organizations) return { status: "unavailable" };
  if (organizations.length === 0) return { status: "not_configured" };
  if (organizations.length !== 1) return { status: "unavailable" };
  const orgId = organizations[0].id;

  const statusParams = new URLSearchParams({
    select: "last_result,last_attempt_at,last_success_at",
    org_id: `eq.${orgId}`,
    limit: "2",
  });
  const rows = await serviceGet<BackupStatusRow[]>(`careon_facturatie_backup_status?${statusParams}`);
  if (!rows || rows.length > 1) return { status: "unavailable" };
  const observation = resolveFacturatieBackupObservation(parseStatus(rows[0]), configuration.maximumAgeHours, nowMs);
  const transition = await recordTransition(orgId, observation.state, observation.ageBucket);
  if (!transition) return { status: "transition_failed" };
  return { status: "completed", ...observation, changed: transition.changed };
}
