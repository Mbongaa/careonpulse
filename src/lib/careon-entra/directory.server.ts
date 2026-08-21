import "server-only";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORG_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const GRAPH_ORIGIN = "https://graph.microsoft.com";

export type EntraDirectorySource = "app_role_assignments" | "group";

export interface EntraDirectoryConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  source: EntraDirectorySource;
  groupId: string | null;
  servicePrincipalId: string | null;
  appRoleId: string | null;
  orgSlug: string;
}

export interface EntraDirectoryMember {
  entraObjectId: string;
  displayName: string;
  email: string;
  userPrincipalName: string;
  jobTitle: string;
  userType: "Member" | "Guest" | "Unknown";
  accountEnabled: boolean | null;
  licensed: boolean | null;
  eligible: boolean;
}

export type EntraDirectoryResult =
  | { status: "disabled" }
  | { status: "invalid_configuration"; invalidFields: string[] }
  | { status: "ready"; config: EntraDirectoryConfig; members: EntraDirectoryMember[] }
  | { status: "token_unavailable" | "graph_unavailable" | "unexpected_response" };

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveEntraDirectoryConfig(
  environment: Partial<Record<string, string | undefined>> = process.env,
):
  | { status: "disabled" }
  | { status: "invalid_configuration"; invalidFields: string[] }
  | { status: "ready"; config: EntraDirectoryConfig } {
  if (environment.CAREON_ENTRA_DIRECTORY_ENABLED !== "1") return { status: "disabled" };

  const sourceValue = text(environment.CAREON_ENTRA_DIRECTORY_SOURCE).toLowerCase();
  const source = sourceValue === "group" || sourceValue === "app_role_assignments" ? sourceValue : null;
  const groupId = text(environment.CAREON_ENTRA_DIRECTORY_GROUP_ID).toLowerCase();
  const servicePrincipalId = text(environment.CAREON_ENTRA_DIRECTORY_SERVICE_PRINCIPAL_ID).toLowerCase();
  const appRoleId = text(environment.CAREON_ENTRA_DIRECTORY_APP_ROLE_ID).toLowerCase();
  const config: EntraDirectoryConfig = {
    tenantId: text(environment.CAREON_ENTRA_DIRECTORY_TENANT_ID).toLowerCase(),
    clientId: text(environment.CAREON_ENTRA_DIRECTORY_CLIENT_ID).toLowerCase(),
    clientSecret: text(environment.CAREON_ENTRA_DIRECTORY_CLIENT_SECRET),
    source: source ?? "group",
    groupId: source === "group" ? groupId : null,
    servicePrincipalId: source === "app_role_assignments" ? servicePrincipalId : null,
    appRoleId: source === "app_role_assignments" ? appRoleId : null,
    orgSlug: text(environment.CAREON_ENTRA_DIRECTORY_ORG_SLUG).toLowerCase(),
  };
  const invalidFields = [
    !source ? "CAREON_ENTRA_DIRECTORY_SOURCE" : "",
    !UUID_PATTERN.test(config.tenantId) ? "CAREON_ENTRA_DIRECTORY_TENANT_ID" : "",
    !UUID_PATTERN.test(config.clientId) ? "CAREON_ENTRA_DIRECTORY_CLIENT_ID" : "",
    config.clientSecret.length < 16 ? "CAREON_ENTRA_DIRECTORY_CLIENT_SECRET" : "",
    source === "group" && !UUID_PATTERN.test(groupId) ? "CAREON_ENTRA_DIRECTORY_GROUP_ID" : "",
    source === "app_role_assignments" && !UUID_PATTERN.test(servicePrincipalId)
      ? "CAREON_ENTRA_DIRECTORY_SERVICE_PRINCIPAL_ID"
      : "",
    source === "app_role_assignments" && !UUID_PATTERN.test(appRoleId) ? "CAREON_ENTRA_DIRECTORY_APP_ROLE_ID" : "",
    !ORG_SLUG_PATTERN.test(config.orgSlug) ? "CAREON_ENTRA_DIRECTORY_ORG_SLUG" : "",
  ].filter(Boolean);
  return invalidFields.length > 0 ? { status: "invalid_configuration", invalidFields } : { status: "ready", config };
}

function graphCollectionPath(config: EntraDirectoryConfig): string {
  return config.source === "group"
    ? `/v1.0/groups/${config.groupId}/members`
    : `/v1.0/servicePrincipals/${config.servicePrincipalId}/appRoleAssignedTo`;
}

function safeNextLink(value: unknown, expectedPath: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.origin === GRAPH_ORIGIN && url.pathname === expectedPath ? url.toString() : null;
  } catch {
    return null;
  }
}

function graphMember(value: unknown): EntraDirectoryMember | null {
  const item = record(value);
  if (!UUID_PATTERN.test(text(item.id))) return null;
  const userType = item.userType === "Member" || item.userType === "Guest" ? item.userType : "Unknown";
  return {
    entraObjectId: text(item.id),
    displayName: text(item.displayName),
    email: text(item.mail).toLowerCase(),
    userPrincipalName: text(item.userPrincipalName).toLowerCase(),
    jobTitle: text(item.jobTitle),
    userType,
    accountEnabled: typeof item.accountEnabled === "boolean" ? item.accountEnabled : null,
    licensed: Array.isArray(item.assignedLicenses) ? item.assignedLicenses.length > 0 : null,
    eligible: false,
  };
}

async function applicationToken(config: EntraDirectoryConfig): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const response = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = record(await response.json().catch(() => null));
  return payload.token_type === "Bearer" && typeof payload.access_token === "string" ? payload.access_token : null;
}

async function pagedGraphValues(
  initialUrl: string,
  expectedPath: string,
  accessToken: string,
): Promise<{ status: "graph_unavailable" | "unexpected_response" } | { status: "ready"; values: unknown[] }> {
  let nextUrl: string | null = initialUrl;
  const values: unknown[] = [];

  for (let page = 0; nextUrl && page < 5; page += 1) {
    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!response?.ok) return { status: "graph_unavailable" };
    const payload = record(await response.json().catch(() => null));
    if (!Array.isArray(payload.value)) return { status: "unexpected_response" };
    values.push(...payload.value);
    const providedNext = typeof payload["@odata.nextLink"] === "string";
    nextUrl = safeNextLink(payload["@odata.nextLink"], expectedPath);
    if (providedNext && !nextUrl) return { status: "unexpected_response" };
  }
  if (nextUrl || values.length > 1_000) return { status: "unexpected_response" };
  return { status: "ready", values };
}

function assignedUserId(value: unknown, appRoleId: string): string | null {
  const item = record(value);
  if (
    item.principalType !== "User" ||
    text(item.appRoleId).toLowerCase() !== appRoleId ||
    !UUID_PATTERN.test(text(item.principalId))
  ) {
    return null;
  }
  return text(item.principalId).toLowerCase();
}

function groupUserId(value: unknown): string | null {
  const item = record(value);
  return item["@odata.type"] === "#microsoft.graph.user" && UUID_PATTERN.test(text(item.id))
    ? text(item.id).toLowerCase()
    : null;
}

/**
 * Reads the complete Entra user inventory plus one explicitly configured
 * eligibility source: either direct app-role assignments (the licence-safe
 * TGC fallback) or a group. The connector has no write methods and accepts
 * pagination only on its two exact Graph paths.
 */
export async function listEntraDirectoryMembers(): Promise<EntraDirectoryResult> {
  const configResult = resolveEntraDirectoryConfig();
  if (configResult.status !== "ready") return configResult;
  const { config } = configResult;
  const accessToken = await applicationToken(config);
  if (!accessToken) return { status: "token_unavailable" };

  const inventoryPath = "/v1.0/users";
  const inventorySelect = "id,displayName,mail,userPrincipalName,jobTitle,userType,accountEnabled,assignedLicenses";
  const inventoryResult = await pagedGraphValues(
    `${GRAPH_ORIGIN}${inventoryPath}?$select=${inventorySelect}&$top=999`,
    inventoryPath,
    accessToken,
  );
  if (inventoryResult.status !== "ready") return inventoryResult;

  const eligibilityPath = graphCollectionPath(config);
  const eligibilityUrl =
    config.source === "group"
      ? `${GRAPH_ORIGIN}${eligibilityPath}?$select=id&$top=999`
      : `${GRAPH_ORIGIN}${eligibilityPath}?$select=principalId,principalType,appRoleId&$top=999`;
  const eligibilityResult = await pagedGraphValues(eligibilityUrl, eligibilityPath, accessToken);
  if (eligibilityResult.status !== "ready") return eligibilityResult;

  const eligibleIds = new Set(
    eligibilityResult.values
      .map((item) => (config.source === "group" ? groupUserId(item) : assignedUserId(item, config.appRoleId as string)))
      .filter((value): value is string => value !== null),
  );
  const byId = new Map<string, EntraDirectoryMember>();
  for (const item of inventoryResult.values) {
    const member = graphMember(item);
    if (!member) return { status: "unexpected_response" };
    const id = member.entraObjectId.toLowerCase();
    if (byId.has(id)) return { status: "unexpected_response" };
    byId.set(id, { ...member, eligible: eligibleIds.has(id) });
  }
  // Every eligible user must also occur in the complete user inventory. A
  // mismatch means Graph returned an incomplete snapshot; no lifecycle caller
  // may treat that as an eligibility removal.
  if ([...eligibleIds].some((id) => !byId.has(id))) return { status: "unexpected_response" };
  const members = [...byId.values()];

  return {
    status: "ready",
    config,
    members: members.sort((a, b) => a.displayName.localeCompare(b.displayName, "nl")),
  };
}
