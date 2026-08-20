import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import type { CareonSession } from "@/lib/supabase/session.server";

import {
  clampTgcSyncProgress,
  type TgcSyncEvent,
  type TgcSyncJob,
  type TgcSyncJobStatus,
  type TgcSyncRequestedVia,
} from "./tgc-sync-jobs";

const CONNECTOR_ORG_SLUG = process.env.CAREON_TGC_ORG_SLUG?.trim() || "tgc";
const JOB_SELECT = [
  "id",
  "org_id",
  "requested_via",
  "status",
  "stage",
  "message",
  "progress",
  "events",
  "result",
  "error",
  "created_at",
  "started_at",
  "finished_at",
  "updated_at",
].join(",");

interface JobRow {
  id: string;
  org_id: string;
  requested_via: TgcSyncRequestedVia;
  status: TgcSyncJobStatus;
  stage: string;
  message: string;
  progress: number;
  events: TgcSyncEvent[] | null;
  result: TgcSyncJob["result"] | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

export type TgcJobServiceResult<T> =
  | { status: "ok"; value: T }
  | { status: "not_configured" }
  | { status: "unavailable" };

function toJob(row: JobRow): TgcSyncJob {
  return {
    id: row.id,
    orgId: row.org_id,
    requestedVia: row.requested_via,
    status: row.status,
    stage: row.stage,
    message: row.message,
    progress: clampTgcSyncProgress(row.progress),
    events: Array.isArray(row.events) ? row.events.slice(-24) : [],
    result: row.result && typeof row.result === "object" ? row.result : {},
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

async function userFetch(session: CareonSession, path: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(`${POSTGREST_URL}/${path}`, {
      ...init,
      headers: userRestHeaders(session, init?.headers),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    console.error("TGC sync job storage unavailable", error);
    return null;
  }
}

async function connectorEnabled(session: CareonSession): Promise<boolean | null> {
  const params = new URLSearchParams({
    select: "id",
    id: `eq.${session.orgId}`,
    slug: `eq.${CONNECTOR_ORG_SLUG}`,
    limit: "1",
  });
  const response = await userFetch(session, `organizations?${params}`);
  if (!response?.ok) return null;
  const rows = (await response.json()) as { id: string }[];
  return rows.length === 1;
}

async function findJob(session: CareonSession, jobId?: string, activeOnly = false): Promise<TgcSyncJob | null | false> {
  const params = new URLSearchParams({
    select: JOB_SELECT,
    org_id: `eq.${session.orgId}`,
    order: "created_at.desc",
    limit: "1",
  });
  if (jobId) params.set("id", `eq.${jobId}`);
  if (activeOnly) params.set("status", "in.(queued,running)");
  const response = await userFetch(session, `careon_tgc_sync_jobs?${params}`);
  if (!response?.ok) return false;
  const rows = (await response.json()) as JobRow[];
  return rows[0] ? toJob(rows[0]) : null;
}

export async function getTgcSyncJob(
  session: CareonSession,
  jobId?: string,
): Promise<TgcJobServiceResult<TgcSyncJob | null>> {
  const enabled = await connectorEnabled(session);
  if (enabled === null) return { status: "unavailable" };
  if (!enabled) return { status: "not_configured" };
  const job = await findJob(session, jobId);
  return job === false ? { status: "unavailable" } : { status: "ok", value: job };
}

export async function createTgcSyncJob(
  session: CareonSession,
  requestedVia: Exclude<TgcSyncRequestedVia, "scheduled">,
): Promise<TgcJobServiceResult<{ job: TgcSyncJob; reused: boolean }>> {
  const enabled = await connectorEnabled(session);
  if (enabled === null) return { status: "unavailable" };
  if (!enabled) return { status: "not_configured" };

  const existing = await findJob(session, undefined, true);
  if (existing === false) return { status: "unavailable" };
  if (existing) return { status: "ok", value: { job: existing, reused: true } };

  const now = new Date().toISOString();
  const event: TgcSyncEvent = {
    at: now,
    stage: "queued",
    message: "Update aangevraagd; de beveiligde TGC-worker neemt deze automatisch over.",
    progress: 0,
  };
  const response = await userFetch(session, `careon_tgc_sync_jobs?select=${JOB_SELECT}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      org_id: session.orgId,
      requested_by: session.userId,
      requested_via: requestedVia,
      events: [event],
    }),
  });
  if (response?.ok) {
    const rows = (await response.json()) as JobRow[];
    if (rows[0]) return { status: "ok", value: { job: toJob(rows[0]), reused: false } };
  }

  // The partial unique index is the final concurrency boundary. If two
  // requests raced, return the winner instead of presenting an error.
  if (response?.status === 409) {
    const raced = await findJob(session, undefined, true);
    if (raced) return { status: "ok", value: { job: raced, reused: true } };
  }
  return { status: "unavailable" };
}
