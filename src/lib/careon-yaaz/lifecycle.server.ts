import "server-only";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORG_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_RESPONSE_BYTES = 16_384;

interface YaazLifecycleConfig {
  endpoint: string;
  secret: string;
  orgSlug: string;
}

export type YaazLifecycleResult =
  | { status: "completed" | "not_found" }
  | { status: "disabled" }
  | { status: "invalid_configuration"; invalidFields: string[] }
  | { status: "upstream_unavailable" | "unexpected_response" | "refused" };

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
      url.pathname.replace(/\/+$/, "") !== "/microsoft-365/internal-lifecycle"
    ) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

export function resolveYaazLifecycleConfig(environment: Partial<Record<string, string | undefined>> = process.env):
  | { status: "disabled" }
  | { status: "invalid_configuration"; invalidFields: string[] }
  | {
      status: "ready";
      config: YaazLifecycleConfig;
    } {
  if (environment.CAREON_YAAZ_LIFECYCLE_ENABLED !== "1") return { status: "disabled" };
  const config: YaazLifecycleConfig = {
    endpoint: endpoint(environment.CAREON_YAAZ_LIFECYCLE_URL),
    secret: environment.CAREON_YAAZ_LIFECYCLE_KEY?.trim() ?? "",
    orgSlug: environment.CAREON_YAAZ_LIFECYCLE_ORG_SLUG?.trim().toLowerCase() ?? "",
  };
  const invalidFields = [
    !config.endpoint ? "CAREON_YAAZ_LIFECYCLE_URL" : "",
    config.secret.length < 32 || config.secret.length > 256 ? "CAREON_YAAZ_LIFECYCLE_KEY" : "",
    !ORG_SLUG_PATTERN.test(config.orgSlug) ? "CAREON_YAAZ_LIFECYCLE_ORG_SLUG" : "",
  ].filter(Boolean);
  return invalidFields.length > 0 ? { status: "invalid_configuration", invalidFields } : { status: "ready", config };
}

export async function applyYaazLifecycle(
  careonSubject: string,
  action: "offboard" | "reactivate",
): Promise<YaazLifecycleResult> {
  const configResult = resolveYaazLifecycleConfig();
  if (configResult.status !== "ready") return configResult;
  if (!UUID_PATTERN.test(careonSubject)) return { status: "unexpected_response" };

  const response = await fetch(configResult.config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${configResult.config.secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: 1,
      orgSlug: configResult.config.orgSlug,
      careonSubject: careonSubject.toLowerCase(),
      action,
    }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response) return { status: "upstream_unavailable" };
  if (response.status === 409) return { status: "refused" };
  if (!response.ok) return { status: "upstream_unavailable" };
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) return { status: "unexpected_response" };
  const body = await response.text().catch(() => "");
  if (!body || new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    return { status: "unexpected_response" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { status: "unexpected_response" };
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { status: "unexpected_response" };
  }
  const result = payload as Record<string, unknown>;
  if (result.version !== 1 || result.orgSlug !== configResult.config.orgSlug) {
    return { status: "unexpected_response" };
  }
  return result.status === "completed" || result.status === "not_found"
    ? { status: result.status }
    : { status: "unexpected_response" };
}
