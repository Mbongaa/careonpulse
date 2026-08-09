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
  /** Naam van die organisatie — de bron voor alle klantnaam-weergave. */
  orgName: string | null;
  orgRole: "org_admin" | "member" | null;
  isSuperadmin: boolean;
  /** JWT van de aanvrager — voor PostgREST-calls onder diens eigen RLS. */
  accessToken: string;
}

/**
 * Een blokkade moet direct gelden — de beheerpagina belooft dat letterlijk —
 * maar GoTrue accepteert een reeds uitgegeven access token tot het verloopt en
 * kent geen beheerdersendpoint om andermans sessies in te trekken (de
 * upstream OpenAPI van supabase/auth heeft geen enkel /admin/…/sessions-pad).
 * Daarom controleert de app het zelf. `banned_until` zit al in het /user-
 * antwoord dat hieronder toch wordt opgehaald, dus dit kost geen extra
 * round trip. Een onleesbare waarde geldt als geblokkeerd (fail closed).
 */
function isGeblokkeerd(bannedUntil: string | null | undefined): boolean {
  if (!bannedUntil) return false;
  const tijdstip = Date.parse(bannedUntil);
  return Number.isNaN(tijdstip) || tijdstip > Date.now();
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
  // Geblokkeerd telt als niet-ingelogd: elke route valt zo terug op 401 en de
  // guard stuurt naar het inlogscherm, waar GoTrue de blokkade zelf afdwingt.
  // Bewust geen eigen status — dat zou de 501/503/401/403-contracten van
  // requireCareonSession/requireOrgAdmin/requireSuperadmin openbreken.
  if (isGeblokkeerd(user.banned_until)) return { status: "unauthenticated" };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { status: "unauthenticated" };

  type Lidmaatschap = {
    org_id: string;
    role: "org_admin" | "member";
    // PostgREST levert een embedded to-one relatie als object; oudere
    // clientversies gaven een array — beide vormen worden hier gelezen.
    organizations?: { name?: string | null } | { name?: string | null }[] | null;
  };
  // Expliciet op user_id filteren, niet op RLS vertrouwen: de policy
  // organization_members_own_select laat een platformbeheerder álle rijen zien
  // (0009), dus zonder dit filter pakt `limit(1)` voor een beheerder zónder
  // eigen lidmaatschap het oudste lidmaatschap van een wíllekeurige andere
  // gebruiker — en presenteert die organisatie als de zijne.
  const basisSelect = () =>
    supabase.from("organization_members").select("org_id, role").eq("user_id", user.id).order("created_at").limit(1);
  const [membershipResult, adminResult] = await Promise.all([
    // De naam komt uit dezelfde query mee (organizations_member_select laat een
    // lid zijn eigen organisatie lezen): zonder naam in de sessie kan geen
    // enkel scherm de klant van de aanvrager tonen en blijft de productcopy
    // vastzitten op de eerste klant.
    supabase
      .from("organization_members")
      .select("org_id, role, organizations(name)")
      .eq("user_id", user.id)
      .order("created_at")
      .limit(1),
    supabase.from("platform_admins").select("user_id").maybeSingle(),
  ]);
  // Een naam-lookup mag nooit een autorisatie-uitkomst bepalen: als de embed
  // faalt (schema-cache na een migratie, gewijzigde grants) zou het lege
  // resultaat anders als "geen organisatie" gelden — 403 op elke dataroute én
  // een terugval op de fail-open demoweergave. Bij twijfel dus opnieuw lezen
  // zonder embed en de naam laten vervallen.
  let memberships = (membershipResult.data ?? []) as Lidmaatschap[];
  if (membershipResult.error) {
    console.error("Careon session: membership embed failed", membershipResult.error);
    const fallback = await basisSelect();
    memberships = (fallback.data ?? []) as Lidmaatschap[];
  }
  const membership = memberships.length > 0 ? memberships[0] : null;
  const organisatie = Array.isArray(membership?.organizations)
    ? membership?.organizations[0]
    : membership?.organizations;
  const isSuperadmin = Boolean(adminResult.data);
  if (!membership && !isSuperadmin) return { status: "no-org" };

  return {
    status: "ok",
    session: {
      userId: user.id,
      email: user.email ?? "",
      fullName: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "",
      orgId: membership ? membership.org_id : null,
      orgName: typeof organisatie?.name === "string" ? organisatie.name : null,
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
 * Facturatiepagina's (server components): het rolpredicaat afdwingen op de
 * databoundary zelf — layout en pagina renderen parallel, dus alleen een
 * layout-gate volstaat niet. Demo/misconfigured vallen door naar de client
 * (die draait dan op het lokale demo-pad, handoff 15 B12). Een superadmin
 * zónder org-lidmaatschap kan de module niet gebruiken (elke dataroute eist
 * een organisatie) en hoort op /admin.
 */
export async function requireFacturatiePage(): Promise<CareonSessionResult> {
  const { magFacturatieZien } = await import("@/lib/careon-facturatie-rol");
  const result = await getCareonSession();
  if (result.status === "ok" && !magFacturatieZien(result.session)) {
    redirect(result.session.isSuperadmin && !result.session.orgId ? "/admin" : "/dashboard/directiecockpit");
  }
  return result;
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
