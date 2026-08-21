import "server-only";

import { applyYaazLifecycle, resolveYaazLifecycleConfig } from "../careon-yaaz/lifecycle.server";
import { listEntraDirectoryMembers } from "./directory.server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ACTIONS_PER_RUN = 10;
const BAN_FOREVER = "876000h";

type LifecycleAction = "offboard" | "reactivate";

interface LifecycleCandidate {
  entraObjectId: string;
  careonUserId: string;
  email: string;
  reason: string;
}

interface SnapshotResponse {
  status?: unknown;
  observed?: unknown;
  offboard?: unknown;
  reactivate?: unknown;
}

function serviceHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

function candidate(value: unknown): LifecycleCandidate | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const entraObjectId = typeof item.entraObjectId === "string" ? item.entraObjectId : "";
  const careonUserId = typeof item.careonUserId === "string" ? item.careonUserId : "";
  const email = typeof item.email === "string" ? item.email.trim().toLowerCase() : "";
  const reason = typeof item.reason === "string" ? item.reason.trim() : "";
  if (!UUID_PATTERN.test(entraObjectId) || !UUID_PATTERN.test(careonUserId) || !email.includes("@") || !reason) {
    return null;
  }
  return { entraObjectId, careonUserId, email, reason };
}

async function updateCareonAuth(userId: string, blocked: boolean): Promise<boolean> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: serviceHeaders(),
    body: JSON.stringify({ ban_duration: blocked ? BAN_FOREVER : "none" }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  return response?.ok === true;
}

async function finalize(
  orgSlug: string,
  target: LifecycleCandidate,
  action: LifecycleAction,
  success: boolean,
  error: string | null,
): Promise<boolean> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/careon_finalize_entra_lifecycle_action`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      p_org_slug: orgSlug,
      p_entra_object_id: target.entraObjectId,
      p_action: action,
      p_success: success,
      p_reason: target.reason,
      p_error: error,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  return response?.ok === true;
}

async function applyCandidate(orgSlug: string, target: LifecycleCandidate, action: LifecycleAction) {
  let success = false;
  let error: string | null = null;
  if (action === "offboard") {
    if (!(await updateCareonAuth(target.careonUserId, true))) {
      error = "careon_auth_unavailable";
    } else {
      const yaaz = await applyYaazLifecycle(target.careonUserId, "offboard");
      success = yaaz.status === "completed" || yaaz.status === "not_found";
      if (!success) error = `yaaz_${yaaz.status}`;
    }
  } else {
    const yaaz = await applyYaazLifecycle(target.careonUserId, "reactivate");
    if (yaaz.status !== "completed" && yaaz.status !== "not_found") {
      error = `yaaz_${yaaz.status}`;
    } else if (!(await updateCareonAuth(target.careonUserId, false))) {
      error = "careon_auth_unavailable";
    } else {
      success = true;
    }
  }
  const finalized = await finalize(orgSlug, target, action, success, error);
  return { action, success: success && finalized, error, finalized };
}

export type EntraLifecycleRunResult =
  | { status: "disabled" }
  | { status: "not_configured" | "directory_unavailable" | "snapshot_failed" | "guarded" }
  | {
      status: "completed";
      observed: number;
      actions: Awaited<ReturnType<typeof applyCandidate>>[];
    };

export async function reconcileEntraLifecycle(): Promise<EntraLifecycleRunResult> {
  if (process.env.CAREON_ENTRA_LIFECYCLE_ENABLED !== "1") return { status: "disabled" };
  if (!SUPABASE_URL || !SERVICE_KEY || resolveYaazLifecycleConfig().status !== "ready") {
    return { status: "not_configured" };
  }

  const directory = await listEntraDirectoryMembers();
  if (directory.status !== "ready") return { status: "directory_unavailable" };
  const snapshot = directory.members.map((member) => ({
    entraObjectId: member.entraObjectId,
    email: member.email || member.userPrincipalName,
    userType: member.userType,
    accountEnabled: member.accountEnabled,
    eligible: member.eligible,
  }));
  if (snapshot.some((member) => !member.email.includes("@"))) return { status: "snapshot_failed" };

  const threshold = Math.min(24, Math.max(2, Number(process.env.CAREON_ENTRA_LIFECYCLE_MISSING_RUNS) || 2));
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/careon_reconcile_entra_snapshot`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      p_org_slug: directory.config.orgSlug,
      p_snapshot: snapshot,
      p_missing_threshold: threshold,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!response?.ok) return { status: "snapshot_failed" };

  const payload = (await response.json().catch(() => null)) as SnapshotResponse | null;
  if (payload?.status !== "ready" || !Array.isArray(payload.offboard) || !Array.isArray(payload.reactivate)) {
    return { status: "snapshot_failed" };
  }
  const offboard = payload.offboard.map(candidate);
  const reactivate = payload.reactivate.map(candidate);
  if (offboard.some((item) => item === null) || reactivate.some((item) => item === null)) {
    return { status: "snapshot_failed" };
  }
  const targets = [
    ...(offboard as LifecycleCandidate[]).map((target) => ({ action: "offboard" as const, target })),
    ...(reactivate as LifecycleCandidate[]).map((target) => ({ action: "reactivate" as const, target })),
  ];
  if (targets.length > MAX_ACTIONS_PER_RUN) return { status: "guarded" };

  const actions = [];
  for (const item of targets) {
    actions.push(await applyCandidate(directory.config.orgSlug, item.target, item.action));
  }
  return {
    status: "completed",
    observed: typeof payload.observed === "number" ? payload.observed : snapshot.length,
    actions,
  };
}
