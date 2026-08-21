import type { User } from "@supabase/supabase-js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORG_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const APP_ROLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

export interface EntraJitConfig {
  orgSlug: string;
  tenantId: string;
  requiredAppRole: string;
}

export type EntraJitConfigResult =
  | { status: "disabled" }
  | { status: "invalid"; invalidFields: string[] }
  | { status: "ready"; config: EntraJitConfig };

export type EntraJitEligibility =
  | { status: "eligible"; config: EntraJitConfig }
  | {
      status:
        | "disabled"
        | "invalid_configuration"
        | "azure_identity_missing"
        | "tenant_mismatch"
        | "guest_or_account_type_unverified"
        | "email_not_verified"
        | "email_mismatch"
        | "required_app_role_missing";
    };

type Environment = Partial<Record<string, string | undefined>>;
type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function normalizedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedEmail(value: unknown): string {
  return normalizedString(value).toLowerCase();
}

function normalizedScalar(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return normalizedString(value);
}

function trueClaim(value: unknown): boolean {
  return value === true || value === 1 || (typeof value === "string" && ["true", "1"].includes(value.toLowerCase()));
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

/**
 * JIT is enabled only by an explicit server-side switch and a complete,
 * syntactically valid policy. A partial rollout never widens access.
 */
export function resolveEntraJitConfig(environment: Environment = process.env): EntraJitConfigResult {
  if (environment.CAREON_ENTRA_JIT_ENABLED !== "1") return { status: "disabled" };

  const config: EntraJitConfig = {
    orgSlug: normalizedString(environment.CAREON_ENTRA_JIT_ORG_SLUG).toLowerCase(),
    tenantId: normalizedString(environment.CAREON_ENTRA_JIT_TENANT_ID).toLowerCase(),
    requiredAppRole: normalizedString(environment.CAREON_ENTRA_JIT_REQUIRED_APP_ROLE),
  };
  const invalidFields = [
    !ORG_SLUG_PATTERN.test(config.orgSlug) ? "CAREON_ENTRA_JIT_ORG_SLUG" : "",
    !UUID_PATTERN.test(config.tenantId) ? "CAREON_ENTRA_JIT_TENANT_ID" : "",
    !APP_ROLE_PATTERN.test(config.requiredAppRole) ? "CAREON_ENTRA_JIT_REQUIRED_APP_ROLE" : "",
  ].filter(Boolean);

  return invalidFields.length > 0 ? { status: "invalid", invalidFields } : { status: "ready", config };
}

/**
 * Validates only immutable/provider-controlled identity data. In particular,
 * user_metadata is never consulted for authorization.
 */
export function evaluateEntraJitEligibility(
  user: Pick<User, "email" | "identities">,
  configResult: EntraJitConfigResult = resolveEntraJitConfig(),
): EntraJitEligibility {
  if (configResult.status === "disabled") return { status: "disabled" };
  if (configResult.status === "invalid") return { status: "invalid_configuration" };

  const azureIdentity = user.identities?.find((identity) => identity.provider === "azure");
  if (!azureIdentity) return { status: "azure_identity_missing" };

  const identity = asRecord(azureIdentity.identity_data);
  const customClaims = asRecord(identity.custom_claims);
  const tenantId = normalizedString(customClaims.tid ?? identity.tid).toLowerCase();
  if (tenantId !== configResult.config.tenantId) return { status: "tenant_mismatch" };

  // `acct` is an Entra optional claim: 0 = tenant member, 1 = guest.
  // Missing is rejected so a manifest regression cannot silently widen JIT.
  const accountType = normalizedScalar(customClaims.acct ?? identity.acct);
  if (accountType !== "0") return { status: "guest_or_account_type_unverified" };

  const emailVerified = trueClaim(customClaims.xms_edov ?? identity.xms_edov);
  if (!emailVerified) return { status: "email_not_verified" };

  const authEmail = normalizedEmail(user.email);
  const identityEmail = normalizedEmail(identity.email || customClaims.email || identity.preferred_username);
  if (!authEmail || !identityEmail || authEmail !== identityEmail) return { status: "email_mismatch" };

  const roles = stringArray(customClaims.roles ?? identity.roles);
  if (!roles.includes(configResult.config.requiredAppRole)) return { status: "required_app_role_missing" };

  return { status: "eligible", config: configResult.config };
}
