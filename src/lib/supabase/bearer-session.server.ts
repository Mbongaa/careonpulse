import "server-only";

import { createClient } from "@supabase/supabase-js";

import { isSupabaseAuthConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import type { CareonSession } from "./session.server";

export type CareonShellSessionResult =
  | { status: "ok"; session: CareonSession }
  | { status: "misconfigured" }
  | { status: "unauthenticated" }
  | { status: "wrong-client" }
  | { status: "no-org" };

export function parseBearerToken(authorization: string | null): string | null {
  if (!authorization || authorization.length > 8192) return null;
  const match = authorization.match(/^Bearer ([A-Za-z0-9._~-]+)$/i);
  return match?.[1] ?? null;
}

function isGeblokkeerd(bannedUntil: string | null | undefined): boolean {
  if (!bannedUntil) return false;
  const tijdstip = Date.parse(bannedUntil);
  return Number.isNaN(tijdstip) || tijdstip > Date.now();
}

function audienceIsAuthenticated(audience: string | string[]): boolean {
  return Array.isArray(audience) ? audience.includes("authenticated") : audience === "authenticated";
}

/**
 * Valideert uitsluitend een OAuth bearer-token dat voor de publieke native
 * shell-client is uitgegeven. Browsercookies worden hier bewust genegeerd:
 * de mobiele API mag niet per ongeluk via een websessie of een andere OAuth-
 * client aanspreekbaar worden. getClaims() valideert handtekening/verval;
 * getUser() bevestigt de actuele gebruiker en maakt een blokkade direct actief.
 */
export async function getCareonShellSession(request: Request): Promise<CareonShellSessionResult> {
  const expectedClientId = process.env.CAREON_SHELL_OAUTH_CLIENT_ID?.trim();
  if (!isSupabaseAuthConfigured() || !expectedClientId) return { status: "misconfigured" };

  const accessToken = parseBearerToken(request.headers.get("authorization"));
  if (!accessToken) return { status: "unauthenticated" };

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });

  const [claimsResult, userResult] = await Promise.all([
    supabase.auth.getClaims(accessToken),
    supabase.auth.getUser(accessToken),
  ]);
  const claims = claimsResult.data?.claims;
  const user = userResult.data.user;
  if (claimsResult.error || userResult.error || !claims || !user || isGeblokkeerd(user.banned_until)) {
    return { status: "unauthenticated" };
  }
  if (
    claims.sub !== user.id ||
    claims.role !== "authenticated" ||
    !audienceIsAuthenticated(claims.aud) ||
    claims.client_id !== expectedClientId
  ) {
    return { status: "wrong-client" };
  }

  type Lidmaatschap = {
    org_id: string;
    role: "org_admin" | "member";
    organizations?: { name?: string | null } | { name?: string | null }[] | null;
  };
  const basisSelect = () =>
    supabase.from("organization_members").select("org_id, role").eq("user_id", user.id).order("created_at").limit(1);
  const [membershipResult, adminResult] = await Promise.all([
    supabase
      .from("organization_members")
      .select("org_id, role, organizations(name)")
      .eq("user_id", user.id)
      .order("created_at")
      .limit(1),
    supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  let memberships = (membershipResult.data ?? []) as Lidmaatschap[];
  if (membershipResult.error) {
    console.error("Careon shell session: membership embed failed", membershipResult.error);
    const fallback = await basisSelect();
    memberships = (fallback.data ?? []) as Lidmaatschap[];
  }
  const membership = memberships[0] ?? null;
  const organization = Array.isArray(membership?.organizations)
    ? membership.organizations[0]
    : membership?.organizations;
  const isSuperadmin = Boolean(adminResult.data);
  if (!membership) return { status: "no-org" };

  return {
    status: "ok",
    session: {
      userId: user.id,
      email: user.email ?? "",
      fullName: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "",
      orgId: membership.org_id,
      orgName: typeof organization?.name === "string" ? organization.name : null,
      orgRole: membership.role,
      isSuperadmin,
      accessToken,
    },
  };
}
