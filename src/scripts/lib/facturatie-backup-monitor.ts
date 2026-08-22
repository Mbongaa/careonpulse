import { resolveFacturatieBackupMonitorConfiguration } from "../../lib/careon-operations/operations-alerts";

const ORG_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export type FacturatieBackupAttemptError =
  | "backup_failed"
  | "configuration"
  | "network"
  | "remote_verification"
  | "source_verification";

export type FacturatieBackupPublishResult =
  | { status: "disabled" | "completed" }
  | { status: "misconfigured" | "unavailable"; required: boolean };

export async function publishFacturatieBackupAttempt(
  environment: Record<string, string | undefined>,
  success: boolean,
  errorCode: FacturatieBackupAttemptError | null,
): Promise<FacturatieBackupPublishResult> {
  const configuration = resolveFacturatieBackupMonitorConfiguration(environment);
  if (configuration.status === "disabled") return { status: "disabled" };
  if (configuration.status === "invalid") return { status: "misconfigured", required: configuration.required };
  if ((success && errorCode !== null) || (!success && errorCode === null)) {
    return { status: "misconfigured", required: configuration.required };
  }
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const serviceKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const orgSlug = environment.CAREON_TGC_ORG_SLUG?.trim() || "tgc";
  if (
    !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl) ||
    serviceKey.length < 32 ||
    !ORG_SLUG_PATTERN.test(orgSlug)
  ) {
    return { status: "misconfigured", required: configuration.required };
  }
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/careon_record_facturatie_backup_attempt`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_org_slug: orgSlug, p_success: success, p_error_code: errorCode }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { status: "unavailable", required: configuration.required };
    const value = (await response.json()) as Record<string, unknown>;
    return value.status === "completed"
      ? { status: "completed" }
      : { status: "unavailable", required: configuration.required };
  } catch {
    return { status: "unavailable", required: configuration.required };
  }
}
