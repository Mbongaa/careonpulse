import "server-only";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { CAREON_MODULES } from "@/data/careon/careon-modules";
import type { CareonSession } from "@/lib/supabase/session.server";

import { buildCareonShellRegistry, resolveCareonShellTarget } from "./module-registry";
import { createHash, randomBytes } from "node:crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PUBLIC_APP_URL = process.env.CAREON_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ?? "";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MobileHandoffMintResult =
  | { status: "created"; code: string; endpoint: string; expiresAt: string }
  | { status: "invalid_module" }
  | { status: "invalid_target" }
  | { status: "unavailable" };

export interface ConsumedMobileHandoff {
  user: User;
  session: CareonSession;
  moduleId: string;
  targetUrl: string;
}

export type MobileHandoffConsumeResult =
  | { status: "ready"; handoff: ConsumedMobileHandoff }
  | { status: "invalid_or_expired" }
  | { status: "no_longer_allowed" }
  | { status: "unavailable" };

interface MintRpcPayload {
  status?: unknown;
  expires_at?: unknown;
}

interface ConsumeRpcRow {
  user_id?: unknown;
  org_id?: unknown;
  module_id?: unknown;
  target_url?: unknown;
}

function serviceHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}

function tokenHash(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

function isBlocked(bannedUntil: string | null | undefined): boolean {
  if (!bannedUntil) return false;
  const timestamp = Date.parse(bannedUntil);
  return Number.isNaN(timestamp) || timestamp > Date.now();
}

function handoffEndpoint(): string | null {
  try {
    const endpoint = new URL("/api/mobile/v1/session", PUBLIC_APP_URL);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) return null;
    return endpoint.toString();
  } catch {
    return null;
  }
}

export async function mintCareonMobileHandoff(
  session: CareonSession,
  moduleId: string,
  requestedTarget?: string | null,
): Promise<MobileHandoffMintResult> {
  const endpoint = handoffEndpoint();
  if (!SUPABASE_URL || !SERVICE_KEY || !endpoint) return { status: "unavailable" };
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(moduleId)) return { status: "invalid_module" };

  const registry = buildCareonShellRegistry(CAREON_MODULES, session, PUBLIC_APP_URL);
  const module = registry.modules.find((candidate) => candidate.id === moduleId && candidate.enabled);
  if (!module) return { status: "invalid_module" };
  const targetUrl = resolveCareonShellTarget(module, requestedTarget);
  if (!targetUrl) return { status: "invalid_target" };

  const code = randomBytes(32).toString("base64url");
  const digest = tokenHash(code);
  if (!TOKEN_PATTERN.test(code) || !HASH_PATTERN.test(digest)) return { status: "unavailable" };

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/careon_create_mobile_handoff`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      p_token_hash: digest,
      p_user_id: session.userId,
      p_org_id: session.orgId,
      p_module_id: moduleId,
      p_target_url: targetUrl,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response?.ok) return { status: "unavailable" };
  const payload = (await response.json().catch(() => null)) as MintRpcPayload | null;
  const expiresAt = typeof payload?.expires_at === "string" ? payload.expires_at : "";
  const expiry = Date.parse(expiresAt);
  const remaining = expiry - Date.now();
  if (payload?.status !== "created" || !Number.isFinite(expiry) || remaining <= 0 || remaining > 120_000) {
    return { status: "unavailable" };
  }
  return { status: "created", code, endpoint, expiresAt: new Date(expiry).toISOString() };
}

export async function consumeCareonMobileHandoff(code: string): Promise<MobileHandoffConsumeResult> {
  if (!SUPABASE_URL || !SERVICE_KEY) return { status: "unavailable" };
  if (!TOKEN_PATTERN.test(code)) return { status: "invalid_or_expired" };
  const digest = tokenHash(code);

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/careon_consume_mobile_handoff`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ p_token_hash: digest }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response?.ok) return { status: "unavailable" };
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!Array.isArray(payload) || payload.length !== 1) return { status: "invalid_or_expired" };
  const row = payload[0] as ConsumeRpcRow;
  const userId = typeof row.user_id === "string" ? row.user_id : "";
  const orgId = typeof row.org_id === "string" ? row.org_id : "";
  const moduleId = typeof row.module_id === "string" ? row.module_id : "";
  const targetUrl = typeof row.target_url === "string" ? row.target_url : "";
  if (!UUID_PATTERN.test(userId) || !UUID_PATTERN.test(orgId) || !moduleId || !targetUrl) {
    return { status: "unavailable" };
  }

  const admin = serviceClient();
  const [userResult, membershipResult, platformAdminResult] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin
      .from("organization_members")
      .select("role, organizations(name)")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .maybeSingle(),
    admin.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  const user = userResult.data.user;
  const membership = membershipResult.data as {
    role?: "org_admin" | "member";
    organizations?: { name?: string | null } | { name?: string | null }[] | null;
  } | null;
  if (
    userResult.error ||
    membershipResult.error ||
    !user ||
    isBlocked(user.banned_until) ||
    !membership ||
    (membership.role !== "org_admin" && membership.role !== "member")
  ) {
    return { status: "no_longer_allowed" };
  }
  const organization = Array.isArray(membership.organizations) ? membership.organizations[0] : membership.organizations;
  const session: CareonSession = {
    userId,
    email: user.email ?? "",
    fullName: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "",
    orgId,
    orgName: typeof organization?.name === "string" ? organization.name : null,
    orgRole: membership.role,
    isSuperadmin: Boolean(platformAdminResult.data),
    accessToken: "",
  };
  const registry = buildCareonShellRegistry(CAREON_MODULES, session, PUBLIC_APP_URL);
  const module = registry.modules.find((candidate) => candidate.id === moduleId && candidate.enabled);
  if (!module?.launchUrl) return { status: "no_longer_allowed" };
  try {
    const target = new URL(targetUrl);
    const launch = new URL(module.launchUrl);
    if (
      target.protocol !== "https:" ||
      target.origin !== launch.origin ||
      target.username ||
      target.password ||
      target.toString().length > 2_048
    ) {
      return { status: "no_longer_allowed" };
    }
  } catch {
    return { status: "no_longer_allowed" };
  }
  return { status: "ready", handoff: { user, session, moduleId, targetUrl } };
}

export async function establishCareonBrowserSession(
  browserClient: SupabaseClient,
  handoff: ConsumedMobileHandoff,
): Promise<"ready" | "unavailable"> {
  const current = await browserClient.auth.getUser();
  if (current.data.user?.id === handoff.user.id && !current.error) return "ready";
  if (current.data.user) await browserClient.auth.signOut({ scope: "local" }).catch(() => undefined);
  const email = handoff.user.email?.trim().toLowerCase();
  if (!email) return "unavailable";

  const generated = await serviceClient().auth.admin.generateLink({ type: "magiclink", email });
  if (generated.error || generated.data.user.id !== handoff.user.id || !generated.data.properties.hashed_token) {
    return "unavailable";
  }
  const verified = await browserClient.auth.verifyOtp({
    token_hash: generated.data.properties.hashed_token,
    type: "magiclink",
  });
  if (verified.error || verified.data.user?.id !== handoff.user.id || !verified.data.session) {
    await browserClient.auth.signOut({ scope: "local" }).catch(() => undefined);
    return "unavailable";
  }
  return "ready";
}
