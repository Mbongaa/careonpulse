import "server-only";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORG_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_RESPONSE_BYTES = 512_000;

export interface YaazDirectoryUser {
  careonSubject: string | null;
  email: string;
  status: "active" | "disabled" | "needs_approval" | "deleted";
  lastLogin: string | null;
  microsoftConnected: boolean;
  microsoftUpdatedAt: string | null;
}

interface YaazDirectoryConfig {
  endpoint: string;
  secret: string;
  orgSlug: string;
}

export type YaazDirectoryResult =
  | { status: "disabled" }
  | { status: "invalid_configuration"; invalidFields: string[] }
  | { status: "ready"; orgSlug: string; users: YaazDirectoryUser[] }
  | { status: "upstream_unavailable" | "unexpected_response" };

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function normalizedText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function endpoint(value: string | undefined): string {
  try {
    const url = new URL(value?.trim() ?? "");
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !localHttp) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname.replace(/\/+$/, "") !== "/microsoft-365/internal-directory"
    ) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function resolveConfig(environment: Partial<Record<string, string | undefined>> = process.env):
  | { status: "disabled" }
  | { status: "invalid_configuration"; invalidFields: string[] }
  | {
      status: "ready";
      config: YaazDirectoryConfig;
    } {
  if (environment.CAREON_YAAZ_DIRECTORY_ENABLED !== "1") return { status: "disabled" };
  const config: YaazDirectoryConfig = {
    endpoint: endpoint(environment.CAREON_YAAZ_DIRECTORY_URL),
    secret: environment.CAREON_YAAZ_DIRECTORY_KEY?.trim() ?? "",
    orgSlug: environment.CAREON_YAAZ_DIRECTORY_ORG_SLUG?.trim().toLowerCase() ?? "",
  };
  const invalidFields = [
    !config.endpoint ? "CAREON_YAAZ_DIRECTORY_URL" : "",
    config.secret.length < 32 || config.secret.length > 256 ? "CAREON_YAAZ_DIRECTORY_KEY" : "",
    !ORG_SLUG_PATTERN.test(config.orgSlug) ? "CAREON_YAAZ_DIRECTORY_ORG_SLUG" : "",
  ].filter(Boolean);
  return invalidFields.length > 0 ? { status: "invalid_configuration", invalidFields } : { status: "ready", config };
}

function optionalMoment(value: unknown): string | null | undefined {
  if (value === null) return null;
  const text = normalizedText(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : undefined;
}

function directoryUser(value: unknown): YaazDirectoryUser | null {
  const item = record(value);
  const email = normalizedText(item.email).toLowerCase();
  const subject = item.careonSubject === null ? null : normalizedText(item.careonSubject);
  const allowedStatuses = new Set(["active", "disabled", "needs_approval", "deleted"]);
  const status = normalizedText(item.status);
  const lastLogin = optionalMoment(item.lastLogin);
  const microsoftUpdatedAt = optionalMoment(item.microsoftUpdatedAt);
  if (
    !email.includes("@") ||
    (subject !== null && !UUID_PATTERN.test(subject)) ||
    !allowedStatuses.has(status) ||
    lastLogin === undefined ||
    typeof item.microsoftConnected !== "boolean" ||
    microsoftUpdatedAt === undefined
  ) {
    return null;
  }
  return {
    careonSubject: subject,
    email,
    status: status as YaazDirectoryUser["status"],
    lastLogin,
    microsoftConnected: item.microsoftConnected,
    microsoftUpdatedAt,
  };
}

export async function listYaazDirectoryUsers(): Promise<YaazDirectoryResult> {
  const configResult = resolveConfig();
  if (configResult.status !== "ready") return configResult;
  const response = await fetch(configResult.config.endpoint, {
    headers: { Authorization: `Bearer ${configResult.config.secret}`, Accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response?.ok) return { status: "upstream_unavailable" };
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) return { status: "unexpected_response" };
  const body = await response.text().catch(() => "");
  if (!body || new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    return { status: "unexpected_response" };
  }
  let payload: UnknownRecord;
  try {
    payload = record(JSON.parse(body));
  } catch {
    return { status: "unexpected_response" };
  }
  const orgSlug = normalizedText(payload.orgSlug).toLowerCase();
  if (payload.version !== 1 || orgSlug !== configResult.config.orgSlug || !Array.isArray(payload.users)) {
    return { status: "unexpected_response" };
  }
  if (payload.users.length > 1000) return { status: "unexpected_response" };
  const users = payload.users.map(directoryUser);
  if (users.some((user) => user === null)) return { status: "unexpected_response" };
  return { status: "ready", orgSlug, users: users as YaazDirectoryUser[] };
}
