import "server-only";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORG_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const GRAPH_ORIGIN = "https://graph.microsoft.com";
const GRAPH_PATH_PREFIX = "/v1.0/groups/";

export interface EntraDirectoryConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  groupId: string;
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

  const config: EntraDirectoryConfig = {
    tenantId: text(environment.CAREON_ENTRA_DIRECTORY_TENANT_ID).toLowerCase(),
    clientId: text(environment.CAREON_ENTRA_DIRECTORY_CLIENT_ID).toLowerCase(),
    clientSecret: text(environment.CAREON_ENTRA_DIRECTORY_CLIENT_SECRET),
    groupId: text(environment.CAREON_ENTRA_DIRECTORY_GROUP_ID).toLowerCase(),
    orgSlug: text(environment.CAREON_ENTRA_DIRECTORY_ORG_SLUG).toLowerCase(),
  };
  const invalidFields = [
    !UUID_PATTERN.test(config.tenantId) ? "CAREON_ENTRA_DIRECTORY_TENANT_ID" : "",
    !UUID_PATTERN.test(config.clientId) ? "CAREON_ENTRA_DIRECTORY_CLIENT_ID" : "",
    config.clientSecret.length < 16 ? "CAREON_ENTRA_DIRECTORY_CLIENT_SECRET" : "",
    !UUID_PATTERN.test(config.groupId) ? "CAREON_ENTRA_DIRECTORY_GROUP_ID" : "",
    !ORG_SLUG_PATTERN.test(config.orgSlug) ? "CAREON_ENTRA_DIRECTORY_ORG_SLUG" : "",
  ].filter(Boolean);
  return invalidFields.length > 0 ? { status: "invalid_configuration", invalidFields } : { status: "ready", config };
}

function safeNextLink(value: unknown, config: EntraDirectoryConfig): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const expectedPrefix = `${GRAPH_PATH_PREFIX}${config.groupId}/members`;
    return url.origin === GRAPH_ORIGIN && url.pathname.startsWith(expectedPrefix) ? url.toString() : null;
  } catch {
    return null;
  }
}

function graphMember(value: unknown): EntraDirectoryMember | null {
  const item = record(value);
  if (item["@odata.type"] !== "#microsoft.graph.user" || !UUID_PATTERN.test(text(item.id))) return null;
  const userType = item.userType === "Member" || item.userType === "Guest" ? item.userType : "Unknown";
  return {
    entraObjectId: text(item.id),
    displayName: text(item.displayName),
    email: text(item.mail).toLowerCase(),
    userPrincipalName: text(item.userPrincipalName).toLowerCase(),
    jobTitle: text(item.jobTitle),
    userType,
    accountEnabled: typeof item.accountEnabled === "boolean" ? item.accountEnabled : null,
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
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = record(await response.json().catch(() => null));
  return payload.token_type === "Bearer" && typeof payload.access_token === "string" ? payload.access_token : null;
}

/**
 * Reads only the explicitly configured eligibility group. The connector has
 * no write methods and accepts pagination links only from the fixed Graph
 * origin and group path.
 */
export async function listEntraDirectoryMembers(): Promise<EntraDirectoryResult> {
  const configResult = resolveEntraDirectoryConfig();
  if (configResult.status !== "ready") return configResult;
  const { config } = configResult;
  const accessToken = await applicationToken(config);
  if (!accessToken) return { status: "token_unavailable" };

  const select = "id,displayName,mail,userPrincipalName,jobTitle,userType,accountEnabled";
  let nextUrl: string | null =
    `${GRAPH_ORIGIN}${GRAPH_PATH_PREFIX}${config.groupId}/members?$select=${select}&$top=999`;
  const byId = new Map<string, EntraDirectoryMember>();

  for (let page = 0; nextUrl && page < 5; page += 1) {
    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!response?.ok) return { status: "graph_unavailable" };
    const payload = record(await response.json().catch(() => null));
    if (!Array.isArray(payload.value)) return { status: "unexpected_response" };
    for (const item of payload.value) {
      const member = graphMember(item);
      if (member) byId.set(member.entraObjectId, member);
    }
    const providedNext = typeof payload["@odata.nextLink"] === "string";
    nextUrl = safeNextLink(payload["@odata.nextLink"], config);
    if (providedNext && !nextUrl) return { status: "unexpected_response" };
  }
  if (nextUrl) return { status: "unexpected_response" };

  return {
    status: "ready",
    config,
    members: [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "nl")),
  };
}
