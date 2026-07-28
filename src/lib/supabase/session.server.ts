import { cache } from "react";

import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { isCareonDemoMode, isSupabaseAuthConfigured } from "./config";
import { supabaseServer } from "./server";

// Sessiecontext voor route handlers: wie is de aanvrager, bij welke organisatie
// hoort die, en is die platformbeheerder. De membership-query loopt via de
// eigen sessie van de gebruiker (RLS: alleen eigen rijen zichtbaar), dus dit
// lekt nooit andermans lidmaatschappen.

export interface CareonSession {
  userId: string;
  email: string;
  /** Weergavenaam uit de accountmetadata; leeg wanneer niet ingevuld. */
  fullName: string;
  /** Eerste (en in de praktijk enige) organisatie van de gebruiker. */
  orgId: string | null;
  orgRole: "org_admin" | "member" | null;
  isSuperadmin: boolean;
  /** JWT van de aanvrager — voor PostgREST-calls onder diens eigen RLS. */
  accessToken: string;
}

export type CareonSessionResult =
  | { status: "ok"; session: CareonSession }
  /** Expliciete demo-modus: routes antwoorden 501 → browseropslag. */
  | { status: "demo" }
  | { status: "misconfigured" }
  | { status: "unauthenticated" }
  /** Wel ingelogd, maar geen organisatie en geen platformrol. */
  | { status: "no-org" };

// React cache(): binnen één request delen layout, pagina en sessieroute
// dezelfde resolutie — de rolregel liet dit anders 2-4× per navigatie draaien.
export const getCareonSession = cache(async (): Promise<CareonSessionResult> => {
  if (isCareonDemoMode()) return { status: "demo" };
  if (!isSupabaseAuthConfigured()) return { status: "misconfigured" };
  const supabase = await supabaseServer();
  if (!supabase) return { status: "misconfigured" };

  // getUser() valideert de sessie bij de Auth-server; getSession() levert
  // daarna het access token uit de cookie voor PostgREST-calls.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "unauthenticated" };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { status: "unauthenticated" };

  const [membershipResult, adminResult] = await Promise.all([
    supabase.from("organization_members").select("org_id, role").order("created_at").limit(1),
    supabase.from("platform_admins").select("user_id").maybeSingle(),
  ]);
  const memberships = (membershipResult.data ?? []) as { org_id: string; role: "org_admin" | "member" }[];
  const membership = memberships.length > 0 ? memberships[0] : null;
  const isSuperadmin = Boolean(adminResult.data);
  if (!membership && !isSuperadmin) return { status: "no-org" };

  return {
    status: "ok",
    session: {
      userId: user.id,
      email: user.email ?? "",
      fullName: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "",
      orgId: membership ? membership.org_id : null,
      orgRole: membership ? membership.role : null,
      isSuperadmin,
      accessToken: session.access_token,
    },
  };
});

/** Beheer-routes: alleen platformbeheerders (403 voor iedereen anders). */
export async function requireSuperadmin(): Promise<{ session: CareonSession } | { denied: NextResponse }> {
  const result = await getCareonSession();
  if (result.status === "demo") {
    return { denied: NextResponse.json({ configured: false, demo: true }, { status: 501 }) };
  }
  if (result.status === "misconfigured") {
    return { denied: NextResponse.json({ error: "Authenticatie is niet geconfigureerd." }, { status: 503 }) };
  }
  if (result.status !== "ok" || !result.session.isSuperadmin) {
    return { denied: NextResponse.json({ error: "Alleen voor platformbeheer." }, { status: 403 }) };
  }
  return { session: result.session };
}

/**
 * Beheerpagina's (server components): superadmin afdwingen op de databoundary
 * zelf — layout en pagina renderen parallel, dus de layout-redirect alleen
 * volstaat niet voordat service-role-reads draaien.
 */
export async function requireSuperadminPage(): Promise<CareonSession> {
  const result = await getCareonSession();
  if (result.status !== "ok" || !result.session.isSuperadmin) {
    redirect("/dashboard/directiecockpit");
  }
  return result.session;
}

/**
 * Organisatiebeheer-routes: org_admin binnen de eigen organisatie (een
 * superadmin mét org-lidmaatschap telt ook). Gewone leden krijgen 403 —
 * beheer is een rol, geen lidmaatschapsrecht. Cross-org beheer blijft
 * exclusief bij requireSuperadmin (admin-routes).
 */
export async function requireOrgAdmin(): Promise<{ session: CareonSession } | { denied: NextResponse }> {
  const result = await requireCareonSession();
  if ("denied" in result) return result;
  if (result.session.orgRole !== "org_admin" && !result.session.isSuperadmin) {
    return { denied: NextResponse.json({ error: "Alleen voor organisatiebeheerders." }, { status: 403 }) };
  }
  return result;
}

/**
 * Standaardbeslissing voor data-routes: 501 uitsluitend in expliciete demo,
 * 503 bij configuratiefouten, 401 zonder sessie en 403 zonder organisatie.
 * Ook een superadmin heeft hier een org-lidmaatschap nodig — datatoegang is
 * altijd "binnen een organisatie"; cross-org lezen hoort bij de admin-routes.
 */
export async function requireCareonSession(): Promise<{ session: CareonSession } | { denied: NextResponse }> {
  const result = await getCareonSession();
  if (result.status === "demo") {
    return { denied: NextResponse.json({ configured: false, demo: true }, { status: 501 }) };
  }
  if (result.status === "misconfigured") {
    return { denied: NextResponse.json({ error: "Authenticatie is niet geconfigureerd." }, { status: 503 }) };
  }
  if (result.status === "unauthenticated") {
    return { denied: NextResponse.json({ error: "Niet ingelogd." }, { status: 401 }) };
  }
  if (result.status === "no-org" || !result.session.orgId) {
    return { denied: NextResponse.json({ error: "Geen organisatie gekoppeld aan dit account." }, { status: 403 }) };
  }
  return { session: result.session };
}
