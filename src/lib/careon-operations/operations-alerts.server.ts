import "server-only";

import {
  parseOperationsAlert,
  resolveOperationsAlertConfiguration,
  serializedOperationsAlertPayload,
} from "./operations-alerts";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type TransitionResult =
  | { status: "completed"; changed: boolean; alertQueue: "queued" | "existing" | "not_alertable" }
  | { status: "unavailable" };

export type OperationsAlertDispatchResult =
  | { status: "disabled" | "idle" | "delivered" }
  | { status: "pending" | "misconfigured" | "unavailable" };

interface ClaimResponse {
  status?: unknown;
  alert?: unknown;
}

interface QueueStatusResponse {
  outstanding?: unknown;
  due?: unknown;
}

function serviceHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function rpc(name: string, body: Record<string, unknown>): Promise<unknown | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export async function recordTgcWorkerTransition(
  orgId: string,
  state: "available" | "offline" | "unknown",
  ageBucket: "under_2m" | "2m_15m" | "15m_1h" | "1h_plus" | "unknown",
): Promise<TransitionResult> {
  if (!UUID_PATTERN.test(orgId)) return { status: "unavailable" };
  const value = (await rpc("careon_record_tgc_worker_transition", {
    p_org_id: orgId,
    p_state: state,
    p_age_bucket: ageBucket,
  })) as Record<string, unknown> | null;
  if (
    value?.status !== "completed" ||
    typeof value.changed !== "boolean" ||
    (value.alertQueue !== "queued" && value.alertQueue !== "existing" && value.alertQueue !== "not_alertable")
  ) {
    return { status: "unavailable" };
  }
  return {
    status: "completed",
    changed: value.changed,
    alertQueue: value.alertQueue,
  };
}

async function queueStatus(): Promise<number | null> {
  const value = (await rpc("careon_operation_alert_queue_status", {})) as QueueStatusResponse | null;
  return Number.isSafeInteger(value?.outstanding) && (value?.outstanding as number) >= 0
    ? (value?.outstanding as number)
    : null;
}

async function releaseForRetry(
  alertId: string,
  lockToken: string,
  errorCode: "timeout" | "network" | "http_4xx" | "http_5xx" | "unexpected_status",
): Promise<boolean> {
  return (
    (await rpc("careon_retry_operation_alert", {
      p_alert_id: alertId,
      p_lock_token: lockToken,
      p_error_code: errorCode,
    })) === true
  );
}

function responseErrorCode(status: number) {
  if (status >= 400 && status < 500) return "http_4xx" as const;
  if (status >= 500 && status < 600) return "http_5xx" as const;
  return "unexpected_status" as const;
}

export async function dispatchOperationsAlert(): Promise<OperationsAlertDispatchResult> {
  const configuration = resolveOperationsAlertConfiguration(process.env);
  if (configuration.status === "disabled") return { status: "disabled" };
  if (configuration.status === "invalid") return { status: "misconfigured" };
  if (!SUPABASE_URL || !SERVICE_KEY) return { status: "unavailable" };

  const lockToken = randomUUID();
  const claim = (await rpc("careon_claim_operation_alert", { p_lock_token: lockToken })) as ClaimResponse | null;
  if (!claim) return { status: "unavailable" };
  if (claim.status === "idle") {
    const outstanding = await queueStatus();
    if (outstanding === null) return { status: "unavailable" };
    return { status: outstanding === 0 ? "idle" : "pending" };
  }
  if (claim.status !== "claimed") return { status: "unavailable" };
  const alert = parseOperationsAlert(claim.alert);
  if (!alert) return { status: "unavailable" };

  let response: Response;
  try {
    response = await fetch(configuration.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Careon-Incident-Id": alert.id,
      },
      body: serializedOperationsAlertPayload(alert),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    const code = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network";
    const released = await releaseForRetry(alert.id, lockToken, code);
    return { status: released ? "pending" : "unavailable" };
  }
  if (!response.ok) {
    const released = await releaseForRetry(alert.id, lockToken, responseErrorCode(response.status));
    return { status: released ? "pending" : "unavailable" };
  }

  const completed = await rpc("careon_complete_operation_alert", {
    p_alert_id: alert.id,
    p_lock_token: lockToken,
  });
  if (completed !== true) return { status: "unavailable" };
  const outstanding = await queueStatus();
  if (outstanding === null) return { status: "unavailable" };
  return { status: outstanding === 0 ? "delivered" : "pending" };
}
