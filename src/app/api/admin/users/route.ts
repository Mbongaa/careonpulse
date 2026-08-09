import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { CAREON_HOSTED_DEMO_EMAIL_DOMAIN, isCareonHostedDemoEmail } from "@/lib/careon-demo-account";
import { CAREON_PASSWORD_HINT, isStrongCareonPassword, normalizeCareonPassword } from "@/lib/careon-password";
import { InvalidJsonBodyError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireSuperadmin } from "@/lib/supabase/session.server";

// Beheer: gebruikers aanmaken en beheren (handoff 13, fase 4; besluit 3 =
// handmatige provisioning, geen e-mailinfra). Service-role na expliciete
// superadmin-check; elke beheeractie wordt geauditeerd (nooit wachtwoorden).
// PATCH dekt de volledige levensloop uit spec §8 — wachtwoord, blokkeren,
// rol promoveren/degraderen, koppelen/ontkoppelen, verwijderen en de
// platformbeheerrol — zodat geen enkele beheerhandeling nog handmatige SQL
// tegen de productiedatabase vereist.

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Effectief permanent; GoTrue kent geen "oneindig" — 100 jaar volstaat.
const BAN_FOREVER = "876600h";

function serviceHeaders(): HeadersInit {
  return {
    apikey: SERVICE_KEY as string,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return await readJsonBodyLimited<Record<string, unknown>>(request, 10_000);
  } catch (error) {
    if (!(error instanceof InvalidJsonBodyError)) {
      console.error("Admin users body read failed", error);
    }
    return null;
  }
}

async function restGet<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: serviceHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

// Rollen komen letterlijk uit de check-constraint van organization_members
// (migratie 0009); een waarde erbuiten wordt door de database geweigerd, dus
// valideren we hem hier al met een duidelijke melding.
const ORG_ROLLEN = ["org_admin", "member"] as const;
type OrgRol = (typeof ORG_ROLLEN)[number];

const BEHEER_ACTIES = [
  "reset_password",
  "ban",
  "unban",
  "set_name",
  "set_email",
  "set_role",
  "add_membership",
  "remove_membership",
  "delete_user",
  "grant_platform_admin",
  "revoke_platform_admin",
] as const;
type BeheerActie = (typeof BEHEER_ACTIES)[number];

function isBeheerActie(value: string): value is BeheerActie {
  return (BEHEER_ACTIES as readonly string[]).includes(value);
}

// Bewust zónder remove_membership: sinds een beheerder zichzelf aan een
// organisatie mag koppelen (proefkoppeling), moet hij die koppeling ook zelf
// ongedaan kunnen maken — de platformrol staat los van lidmaatschappen, dus
// een lockout is dat niet.
const ZELF_FOUTEN: Partial<Record<BeheerActie, string>> = {
  ban: "Je kunt jezelf niet blokkeren.",
  delete_user: "Je kunt jezelf niet verwijderen.",
  revoke_platform_admin: "Je kunt je eigen platformbeheerrol niet intrekken.",
};
const ZELF_UITSLUITEND = new Set<string>(Object.keys(ZELF_FOUTEN));

type MutatieUitkomst = { ok: true } | { error: string; status: number };

/** Lidmaatschap toevoegen, van rol veranderen of verwijderen. */
async function muteerLidmaatschap(
  actie: "set_role" | "add_membership" | "remove_membership",
  userId: string,
  orgId: string,
  rol: OrgRol,
  memberships: { org_id: string; role: OrgRol }[],
): Promise<MutatieUitkomst> {
  const bestaat = memberships.some((membership) => membership.org_id === orgId);
  const scope = `organization_members?org_id=eq.${orgId}&user_id=eq.${userId}`;

  if (actie === "add_membership") {
    if (bestaat) {
      return { error: "Deze gebruiker is al lid van die organisatie.", status: 409 };
    }
    const organisaties = await restGet<{ id: string }[]>(`organizations?id=eq.${orgId}&select=id&limit=1`);
    if (!organisaties) return { error: "Organisatie kon niet worden gecontroleerd.", status: 502 };
    if (organisaties.length !== 1) return { error: "De gekozen organisatie bestaat niet.", status: 400 };
    const response = await fetch(`${SUPABASE_URL}/rest/v1/organization_members`, {
      method: "POST",
      headers: { ...serviceHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({ org_id: orgId, user_id: userId, role: rol }),
    }).catch(() => null);
    return response?.ok ? { ok: true } : { error: "Koppelen mislukt.", status: 502 };
  }

  if (!bestaat) {
    return { error: "Deze gebruiker is geen lid van die organisatie.", status: 404 };
  }
  if (actie === "set_role") {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${scope}`, {
      method: "PATCH",
      headers: { ...serviceHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({ role: rol }),
    }).catch(() => null);
    return response?.ok ? { ok: true } : { error: "Rol wijzigen mislukt.", status: 502 };
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${scope}`, {
    method: "DELETE",
    headers: { ...serviceHeaders(), Prefer: "return=minimal" },
  }).catch(() => null);
  return response?.ok ? { ok: true } : { error: "Ontkoppelen mislukt.", status: 502 };
}

/**
 * Weergavenaam staat op twee plekken: `profiles.full_name` (de beheerlijsten)
 * en `user_metadata.full_name` (de zijbalk en de sessie). Ze worden hier
 * samen geschreven — los bijwerken laat ze uit elkaar lopen, en dan toont het
 * ene scherm een andere naam dan het andere.
 */
async function muteerNaam(userId: string, naam: string): Promise<MutatieUitkomst> {
  const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: serviceHeaders(),
    body: JSON.stringify({ user_metadata: { full_name: naam } }),
  }).catch(() => null);
  if (!authResponse?.ok) return { error: "Naam wijzigen mislukt.", status: 502 };

  const profileResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: { ...serviceHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({ full_name: naam }),
  }).catch(() => null);
  const bijgewerkt = profileResponse?.ok ? ((await profileResponse.json().catch(() => [])) as unknown[]) : null;
  if (!bijgewerkt || bijgewerkt.length === 0) {
    // Halve schrijfactie: het account draagt de nieuwe naam, het profiel niet.
    // Zonder auditrij zou die divergentie (beheerlijst toont oud, zijbalk toont
    // nieuw) nergens meer te herleiden zijn.
    scheduleAuditEvent({
      action: "admin.user.set_name_partial",
      resource: "profiles",
      resourceId: userId,
      detail: { reason: bijgewerkt ? "profile_row_missing" : "profile_patch_failed" },
    });
    return { error: "Naam is in het account gewijzigd, maar het profiel bijwerken mislukte.", status: 502 };
  }
  return { ok: true };
}

/**
 * Het e-mailadres is tevens de inlognaam. `email_confirm` blijft aan: er is
 * geen mailinfrastructuur, dus een bevestigingsmail zou het account
 * onbereikbaar maken.
 */
async function muteerEmail(userId: string, email: string): Promise<MutatieUitkomst> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: serviceHeaders(),
    body: JSON.stringify({ email, email_confirm: true }),
  }).catch(() => null);
  if (response?.ok) return { ok: true };
  if (response?.status === 422 || response?.status === 409) {
    return { error: "Dit e-mailadres is al in gebruik.", status: 409 };
  }
  return { error: "E-mailadres wijzigen mislukt.", status: 502 };
}

/** Platformbeheer is een rij in platform_admins, geen kolom op een profiel. */
async function muteerPlatformrol(
  actie: "grant_platform_admin" | "revoke_platform_admin",
  userId: string,
): Promise<MutatieUitkomst> {
  if (actie === "grant_platform_admin") {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/platform_admins`, {
      method: "POST",
      headers: { ...serviceHeaders(), Prefer: "return=minimal,resolution=ignore-duplicates" },
      body: JSON.stringify({ user_id: userId }),
    }).catch(() => null);
    return response?.ok ? { ok: true } : { error: "Platformrol toekennen mislukt.", status: 502 };
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/platform_admins?user_id=eq.${userId}`, {
    method: "DELETE",
    headers: { ...serviceHeaders(), Prefer: "return=minimal" },
  }).catch(() => null);
  return response?.ok ? { ok: true } : { error: "Platformrol intrekken mislukt.", status: 502 };
}

export async function POST(request: Request) {
  const auth = await requireSuperadmin();
  if ("denied" in auth) return auth.denied;

  const body = await readBody(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim().slice(0, 120) : "";
  const password = normalizeCareonPassword(typeof body?.password === "string" ? body.password : "");
  const orgId = typeof body?.orgId === "string" ? body.orgId : "";
  const role = body?.role === "org_admin" ? "org_admin" : "member";
  if (!EMAIL_PATTERN.test(email) || !isStrongCareonPassword(password) || !UUID_PATTERN.test(orgId)) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const orgResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/organizations?id=eq.${encodeURIComponent(orgId)}&select=id&limit=1`,
    { headers: serviceHeaders(), cache: "no-store" },
  ).catch(() => null);
  if (!orgResponse?.ok) {
    return NextResponse.json({ error: "Organisatie kon niet worden gecontroleerd." }, { status: 502 });
  }
  const organizations = (await orgResponse.json()) as { id: string }[];
  if (organizations.length !== 1) {
    return NextResponse.json({ error: "De gekozen organisatie bestaat niet." }, { status: 400 });
  }

  const createResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    }),
  }).catch(() => null);
  if (!createResponse?.ok) {
    if (createResponse?.status === 422) {
      return NextResponse.json({ error: "Dit e-mailadres bestaat al." }, { status: 409 });
    }
    return NextResponse.json({ error: "Gebruiker kon niet worden aangemaakt." }, { status: 502 });
  }
  const created = (await createResponse.json()) as { id: string };

  const membershipResponse = await fetch(`${SUPABASE_URL}/rest/v1/organization_members`, {
    method: "POST",
    headers: { ...serviceHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ org_id: orgId, user_id: created.id, role }),
  }).catch(() => null);
  if (!membershipResponse?.ok) {
    const cleanupResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${created.id}`, {
      method: "DELETE",
      headers: serviceHeaders(),
    }).catch(() => null);
    if (!cleanupResponse?.ok) {
      scheduleAuditEvent({
        action: "admin.user.rollback_failed",
        resource: "auth.users",
        resourceId: created.id,
        orgId,
        userId: auth.session.userId,
        detail: { reason: "membership_insert_failed" },
      });
      return NextResponse.json(
        { error: "Gebruiker aangemaakt, maar koppeling en automatisch terugdraaien mislukten." },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "Organisatiekoppeling mislukte; de nieuwe gebruiker is automatisch teruggedraaid." },
      { status: 502 },
    );
  }

  scheduleAuditEvent({
    action: "admin.user.create",
    resource: "auth.users",
    resourceId: created.id,
    orgId,
    userId: auth.session.userId,
    detail: { role },
  });
  return NextResponse.json({ ok: true, id: created.id });
}

export async function PATCH(request: Request) {
  const auth = await requireSuperadmin();
  if ("denied" in auth) return auth.denied;

  const body = await readBody(request);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const action = typeof body?.action === "string" ? body.action : "";
  if (!UUID_PATTERN.test(userId) || !isBeheerActie(action)) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }
  // Jezelf blokkeren is een klassieke lock-out; dezelfde klasse fout is jezelf
  // verwijderen, degraderen of je platformrol intrekken — allemaal weigeren.
  if (userId === auth.session.userId && ZELF_UITSLUITEND.has(action)) {
    return NextResponse.json(
      { error: ZELF_FOUTEN[action] ?? "Deze actie kun je niet op je eigen account uitvoeren." },
      { status: 400 },
    );
  }
  const rol = typeof body?.role === "string" ? body.role : "";
  const orgId = typeof body?.orgId === "string" ? body.orgId : "";
  if (action === "set_role" || action === "add_membership") {
    if (!ORG_ROLLEN.includes(rol as OrgRol) || !UUID_PATTERN.test(orgId)) {
      return NextResponse.json({ error: "Kies een geldige organisatie en rol." }, { status: 400 });
    }
    // Jezelf degraderen zou de eigen beheerroute dichtzetten. Alleen bij
    // set_role: een nieuw lidmaatschap als gewoon lid verlaagt niets — de
    // platformrol staat los van organisatierollen, en deze guard weigerde
    // eerder een superadmin die zichzelf ergens als "Gebruiker" koppelde, met
    // een melding over een degradatie die niet plaatsvond.
    if (action === "set_role" && userId === auth.session.userId && rol === "member") {
      return NextResponse.json({ error: "Je kunt je eigen organisatierol niet verlagen." }, { status: 400 });
    }
  }
  if (action === "remove_membership" && !UUID_PATTERN.test(orgId)) {
    return NextResponse.json({ error: "Kies een geldige organisatie." }, { status: 400 });
  }
  const nieuwEmail = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (action === "set_email") {
    if (!EMAIL_PATTERN.test(nieuwEmail)) {
      return NextResponse.json({ error: "Ongeldig e-mailadres." }, { status: 400 });
    }
    // Hetzelfde voorbehoud als bij aanmaken (/api/org/members): het demodomein
    // is gereserveerd. De inlogroute vult een kale gebruikersnaam aan tot dit
    // domein, en het vaste demoadres omzeilt bovendien de financiële rolregel —
    // een account daarheen hernoemen zou beide stilzwijgend meegeven.
    if (nieuwEmail.endsWith(`@${CAREON_HOSTED_DEMO_EMAIL_DOMAIN}`)) {
      return NextResponse.json({ error: "Dit e-maildomein is gereserveerd." }, { status: 409 });
    }
  }
  if (action === "set_name" && (typeof body?.fullName !== "string" || body.fullName.trim() === "")) {
    return NextResponse.json({ error: "Vul een naam in." }, { status: 400 });
  }

  const targetResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: serviceHeaders(),
    cache: "no-store",
  }).catch(() => null);
  if (!targetResponse?.ok) {
    return NextResponse.json({ error: "Gebruiker kon niet worden gecontroleerd." }, { status: 502 });
  }
  const target = (await targetResponse.json()) as { email?: string | null };
  if (isCareonHostedDemoEmail(target.email) && action !== "unban") {
    return NextResponse.json(
      { error: "Het vaste demoaccount kan niet worden geblokkeerd of gewijzigd." },
      { status: 409 },
    );
  }

  // Organisatiecontext voor de auditrij: expliciet meegegeven, anders het
  // enige lidmaatschap (bij meerdere is "de" organisatie betekenisloos).
  const memberships = await restGet<{ org_id: string; role: OrgRol }[]>(
    `organization_members?user_id=eq.${userId}&select=org_id,role`,
  );
  if (!memberships) {
    return NextResponse.json({ error: "Lidmaatschappen konden niet worden gelezen." }, { status: 502 });
  }
  const enigLidmaatschap = memberships.length === 1 ? memberships[0].org_id : null;
  const auditOrgId = UUID_PATTERN.test(orgId) ? orgId : enigLidmaatschap;

  if (action === "set_role" || action === "add_membership" || action === "remove_membership") {
    const uitkomst = await muteerLidmaatschap(action, userId, orgId, rol as OrgRol, memberships);
    if ("error" in uitkomst) {
      return NextResponse.json({ error: uitkomst.error }, { status: uitkomst.status });
    }
    scheduleAuditEvent({
      action: `admin.user.${action}`,
      resource: "organization_members",
      resourceId: userId,
      orgId,
      userId: auth.session.userId,
      detail: action === "remove_membership" ? {} : { role: rol },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "set_name" || action === "set_email") {
    const uitkomst =
      action === "set_name"
        ? await muteerNaam(userId, typeof body?.fullName === "string" ? body.fullName.trim().slice(0, 120) : "")
        : await muteerEmail(userId, nieuwEmail);
    if ("error" in uitkomst) {
      return NextResponse.json({ error: uitkomst.error }, { status: uitkomst.status });
    }
    scheduleAuditEvent({
      action: `admin.user.${action}`,
      resource: "auth.users",
      resourceId: userId,
      orgId: auditOrgId,
      userId: auth.session.userId,
      // Het oude adres hoort in de auditrij: na de wijziging is de rij anders
      // niet meer te herleiden tot het account zoals het toen heette.
      detail: action === "set_email" ? { vorigEmail: target.email ?? null, email: nieuwEmail } : {},
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "grant_platform_admin" || action === "revoke_platform_admin") {
    const uitkomst = await muteerPlatformrol(action, userId);
    if ("error" in uitkomst) {
      return NextResponse.json({ error: uitkomst.error }, { status: uitkomst.status });
    }
    scheduleAuditEvent({
      action: `admin.platform_admin.${action === "grant_platform_admin" ? "grant" : "revoke"}`,
      resource: "platform_admins",
      resourceId: userId,
      orgId: auditOrgId,
      userId: auth.session.userId,
    });
    return NextResponse.json({ ok: true });
  }

  // Blokkeren raakt een platformbeheerder net zo hard als verwijderen: die
  // accounts zijn de reservesleutel van het platform, en één misklik kan de
  // collega uitsluiten die de lockout-verzekering vormt. Zelfde volgorde als
  // bij verwijderen: eerst de platformrol intrekken.
  if (action === "ban" || action === "delete_user") {
    const platformAdmins = await restGet<{ user_id: string }[]>(
      `platform_admins?user_id=eq.${userId}&select=user_id&limit=1`,
    );
    if (!platformAdmins) {
      return NextResponse.json({ error: "Platformrol kon niet worden gecontroleerd." }, { status: 502 });
    }
    if (platformAdmins.length > 0) {
      return NextResponse.json(
        {
          error:
            action === "ban"
              ? "Trek eerst de platformbeheerrol in voordat je dit account blokkeert."
              : "Trek eerst de platformbeheerrol in voordat je dit account verwijdert.",
        },
        { status: 409 },
      );
    }
  }

  if (action === "delete_user") {
    const deleteResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: serviceHeaders(),
    }).catch(() => null);
    if (!deleteResponse?.ok) {
      return NextResponse.json({ error: "Verwijderen mislukt." }, { status: 502 });
    }
    scheduleAuditEvent({
      action: "admin.user.delete",
      resource: "auth.users",
      resourceId: userId,
      orgId: auditOrgId,
      userId: auth.session.userId,
      // Het e-mailadres hoort hier in de auditrij zelf: het account is weg, dus
      // het resource_id valt daarna nergens meer terug te vertalen en de rij
      // blijft anders voorgoed een kale UUID. Andere beheeracties laten hun doel
      // bestaan en zijn wél via de gebruikerslijst te herleiden.
      detail: { email: target.email ?? null, memberships: memberships.length },
    });
    return NextResponse.json({ ok: true });
  }

  let payload: Record<string, unknown>;
  if (action === "reset_password") {
    const password = normalizeCareonPassword(typeof body?.password === "string" ? body.password : "");
    if (!isStrongCareonPassword(password)) {
      return NextResponse.json({ error: CAREON_PASSWORD_HINT }, { status: 400 });
    }
    payload = { password };
  } else {
    payload = { ban_duration: action === "ban" ? BAN_FOREVER : "none" };
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: serviceHeaders(),
    body: JSON.stringify(payload),
  }).catch(() => null);
  if (!response?.ok) {
    return NextResponse.json({ error: "Actie mislukt." }, { status: 502 });
  }
  // Hier wordt bewust niets ingetrokken: de GoTrue-beheer-API kent geen pad om
  // andermans sessies te beëindigen. `admin.signOut()` in @supabase/auth-js
  // POST't naar /logout met het JWT van de gebruiker zélf, en de admin-routes
  // gaan niet verder dan /admin/users/{id} (+ /factors) — een DELETE op
  // /admin/users/{id}/sessions zou een 404 zijn. Een blokkade geldt daarom via
  // de sessielaag: getCareonSession leest `banned_until` uit het /user-antwoord
  // dat het toch al ophaalt en behandelt de sessie als niet-ingelogd, dus de
  // toegang valt bij de eerstvolgende aanvraag dicht. Bij reset_password blijft
  // een al uitgegeven access token geldig tot zijn vervaltijd; blokkeer het
  // account als de toegang direct dicht moet.

  scheduleAuditEvent({
    action: `admin.user.${action}`,
    resource: "auth.users",
    resourceId: userId,
    orgId: auditOrgId,
    userId: auth.session.userId,
  });
  return NextResponse.json({ ok: true });
}
