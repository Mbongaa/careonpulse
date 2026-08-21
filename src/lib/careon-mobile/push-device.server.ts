import "server-only";

import type { CareonSession } from "@/lib/supabase/session.server";

import { type MobilePushDeviceInput, protectMobilePushToken } from "./push-device";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TOKEN_ENCRYPTION_KEY = process.env.CAREON_MOBILE_PUSH_TOKEN_ENCRYPTION_KEY;

function serviceHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

type PushDeviceMutationResult = "ok" | "membership_missing" | "misconfigured" | "unavailable";

export async function registerMobilePushDevice(
  session: CareonSession,
  input: MobilePushDeviceInput,
): Promise<PushDeviceMutationResult> {
  if (!SUPABASE_URL || !SERVICE_KEY) return "misconfigured";
  const protectedToken = protectMobilePushToken(input.token, TOKEN_ENCRYPTION_KEY);
  if (!protectedToken) return "misconfigured";

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/careon_register_mobile_push_device`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      p_user_id: session.userId,
      p_org_id: session.orgId,
      p_installation_id: input.installationId,
      p_platform: input.platform,
      p_token_hash: protectedToken.tokenHash,
      p_token_ciphertext: protectedToken.tokenCiphertext,
      p_app_version: input.appVersion,
      p_locale: input.locale,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response?.ok) return "unavailable";
  const payload = (await response.json().catch(() => null)) as { status?: unknown } | null;
  if (payload?.status === "membership_missing") return "membership_missing";
  return payload?.status === "registered" ? "ok" : "unavailable";
}

export async function unregisterMobilePushDevice(
  session: CareonSession,
  installationId: string,
): Promise<Exclude<PushDeviceMutationResult, "membership_missing">> {
  if (!SUPABASE_URL || !SERVICE_KEY) return "misconfigured";
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/careon_unregister_mobile_push_device`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      p_user_id: session.userId,
      p_org_id: session.orgId,
      p_installation_id: installationId,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response?.ok) return "unavailable";
  const payload = (await response.json().catch(() => null)) as { status?: unknown } | null;
  return payload?.status === "unregistered" ? "ok" : "unavailable";
}
