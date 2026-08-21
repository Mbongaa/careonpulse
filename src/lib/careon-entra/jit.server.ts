import "server-only";

import type { User } from "@supabase/supabase-js";

import { type EntraJitEligibility, evaluateEntraJitEligibility } from "./jit-claims";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EntraJitProvisionResult =
  | { status: "created" | "existing"; orgId: string }
  | {
      status:
        | Exclude<EntraJitEligibility["status"], "eligible">
        | "organization_not_found"
        | "existing_other_organization"
        | "user_not_verified"
        | "upstream_unavailable"
        | "unexpected_response";
    };

interface RpcPayload {
  status?: unknown;
  org_id?: unknown;
}

const REJECTION_STATUSES = new Set<EntraJitProvisionResult["status"]>([
  "invalid_configuration",
  "organization_not_found",
  "existing_other_organization",
  "user_not_verified",
  "azure_identity_missing",
  "tenant_mismatch",
  "guest_or_account_type_unverified",
  "email_not_verified",
  "email_mismatch",
  "required_app_role_missing",
]);

/**
 * Runs the same claim checks in TypeScript for a fast denial, then asks the
 * database RPC to re-check auth.identities and create membership + audit in a
 * single transaction. Both layers must agree before access is granted.
 */
export async function provisionEntraJitMembership(
  user: Pick<User, "id" | "email" | "identities">,
): Promise<EntraJitProvisionResult> {
  const eligibility = evaluateEntraJitEligibility(user);
  if (eligibility.status !== "eligible") return eligibility;
  if (!SUPABASE_URL || !SERVICE_KEY) return { status: "upstream_unavailable" };

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/careon_provision_entra_member`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_user_id: user.id,
      p_org_slug: eligibility.config.orgSlug,
      p_tenant_id: eligibility.config.tenantId,
      p_required_app_role: eligibility.config.requiredAppRole,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);

  if (!response?.ok) return { status: "upstream_unavailable" };

  let payload: RpcPayload;
  try {
    payload = (await response.json()) as RpcPayload;
  } catch {
    return { status: "unexpected_response" };
  }

  if ((payload.status === "created" || payload.status === "existing") && typeof payload.org_id === "string") {
    return UUID_PATTERN.test(payload.org_id)
      ? { status: payload.status, orgId: payload.org_id }
      : { status: "unexpected_response" };
  }
  if (
    typeof payload.status === "string" &&
    REJECTION_STATUSES.has(payload.status as EntraJitProvisionResult["status"])
  ) {
    return { status: payload.status as Exclude<EntraJitProvisionResult["status"], "created" | "existing"> };
  }
  return { status: "unexpected_response" };
}
