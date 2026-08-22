import "server-only";

import { getTgcSyncWorkerAvailability } from "@/lib/careon-production/tgc-sync-jobs.server";
import { POSTGREST_URL } from "@/lib/supabase/postgrest.server";
import type { CareonSession } from "@/lib/supabase/session.server";

import {
  type FacturatieBackupStatusInput,
  resolveFacturatieBackupMonitorConfiguration,
  resolveFacturatieBackupObservation,
} from "./operations-alerts";
import type { CareonOperationsStatus, OperationsBackupStatus } from "./operations-status";

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

interface BackupStatusRow {
  last_result?: unknown;
  last_attempt_at?: unknown;
  last_success_at?: unknown;
}

function backupInput(row: BackupStatusRow): FacturatieBackupStatusInput | null {
  if (
    (row.last_result !== "healthy" && row.last_result !== "failed") ||
    typeof row.last_attempt_at !== "string" ||
    (row.last_success_at !== null && typeof row.last_success_at !== "string")
  ) {
    return null;
  }
  return {
    lastResult: row.last_result,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
  };
}

async function getBackupStatus(orgId: string, nowMs: number): Promise<OperationsBackupStatus> {
  const configuration = resolveFacturatieBackupMonitorConfiguration(process.env);
  if (configuration.status === "disabled") {
    return { state: "disabled", lastAttemptAt: null, lastSuccessAt: null };
  }
  if (configuration.status === "invalid") {
    return { state: "misconfigured", lastAttemptAt: null, lastSuccessAt: null };
  }
  if (!POSTGREST_URL.startsWith("https://") || SERVICE_KEY === "") {
    return { state: "unavailable", lastAttemptAt: null, lastSuccessAt: null };
  }

  const params = new URLSearchParams({
    select: "last_result,last_attempt_at,last_success_at",
    org_id: `eq.${orgId}`,
    limit: "2",
  });
  try {
    const response = await fetch(`${POSTGREST_URL}/careon_facturatie_backup_status?${params}`, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { state: "unavailable", lastAttemptAt: null, lastSuccessAt: null };
    const rows = (await response.json()) as BackupStatusRow[];
    if (rows.length === 0) return { state: "not_configured", lastAttemptAt: null, lastSuccessAt: null };
    if (rows.length !== 1) return { state: "unavailable", lastAttemptAt: null, lastSuccessAt: null };
    const input = backupInput(rows[0]);
    if (!input) return { state: "unknown", lastAttemptAt: null, lastSuccessAt: null };
    const observation = resolveFacturatieBackupObservation(input, configuration.maximumAgeHours, nowMs);
    return {
      state: observation.state,
      lastAttemptAt: input.lastAttemptAt,
      lastSuccessAt: input.lastSuccessAt,
    };
  } catch {
    return { state: "unavailable", lastAttemptAt: null, lastSuccessAt: null };
  }
}

/**
 * Organization-admin view over metadata-only worker and backup health. The
 * service-role read stays server-side and is filtered to the authenticated
 * administrator's exact organization before any status leaves this boundary.
 */
export async function getCareonOperationsStatus(
  session: CareonSession,
  nowMs = Date.now(),
): Promise<CareonOperationsStatus | null> {
  if (!session.orgId || (session.orgRole !== "org_admin" && !session.isSuperadmin)) return null;

  const [workerResult, backup] = await Promise.all([
    getTgcSyncWorkerAvailability(session),
    getBackupStatus(session.orgId, nowMs),
  ]);
  return {
    worker: workerResult.status === "ok" ? workerResult.value : { state: workerResult.status, lastSeenAt: null },
    backup,
  };
}
