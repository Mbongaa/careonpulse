import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { isCareonHostedDemoEmail } from "@/lib/careon-demo-account";
import { CAREON_PASSWORD_HINT, isStrongCareonPassword } from "@/lib/careon-password";
import { InvalidJsonBodyError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

// Organisatiebeheer (handoff 13, fase 6): een org_admin beheert accounts
// UITSLUITEND binnen de eigen organisatie — aanmaken, wachtwoord resetten,
// blokkeren/deblokkeren. Zelfde service-role-na-expliciete-rolcheck-patroon
// als /api/admin/users, maar de organisatie komt altijd uit de sessie (nooit
// uit de request) en platformbeheerders zijn geen geldig doelwit.

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
      console.error("Org members body read failed", error);
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

/**
 * Herstel-link voor "wachtwoord zelf instellen" (variant A, geen e-mail-
 * infrastructuur): GoTrue genereert het token, wij bouwen de app-link die de
 * beheerder persoonlijk doorgeeft. Het token verschijnt nooit in audit/logs.
 */
async function maakWachtwoordLink(email: string, request: Request): Promise<string | null> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ type: "recovery", email }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = (await response.json()) as { hashed_token?: string };
  if (!payload.hashed_token) return null;
  const origin =
    request.headers.get("origin") ??
    `${request.headers.get("x-forwarded-proto") ?? "https"}://${request.headers.get("host") ?? ""}`;
  return `${origin}/auth/v1/wachtwoord-instellen?token=${encodeURIComponent(payload.hashed_token)}`;
}

interface AuthUserRecord {
  id: string;
  email?: string;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
}

/**
 * Alle auth-accounts, gepagineerd — de gebruikerslijst is platformbreed, dus
 * één pagina van 200 mist leden zodra het totaal daarboven komt en toont dan
 * stille, foute statussen (e-mail "—", banned=false). Cap van 25 pagina's
 * (5.000 accounts) als bovengrens tegen runaway-loops.
 */
async function listAuthUsersPaged(): Promise<Map<string, AuthUserRecord> | null> {
  const byId = new Map<string, AuthUserRecord>();
  for (let page = 1; page <= 25; page += 1) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: serviceHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    if (!response?.ok) return null;
    const payload = (await response.json()) as { users?: AuthUserRecord[] };
    const users = payload.users ?? [];
    for (const user of users) byId.set(user.id, user);
    // Pas stoppen bij een lége pagina: GoTrue mag per_page stilzwijgend
    // clampen, dus "minder dan gevraagd" is geen betrouwbaar eindsignaal.
    if (users.length === 0) break;
  }
  return byId;
}

/** Lidmaatschap + platformrol van een doelgebruiker binnen deze organisatie. */
async function targetInOrg(
  orgId: string,
  userId: string,
): Promise<{ isMember: boolean; isPlatformAdmin: boolean } | null> {
  const [membership, admin] = await Promise.all([
    restGet<{ user_id: string }[]>(
      `organization_members?org_id=eq.${orgId}&user_id=eq.${encodeURIComponent(userId)}&select=user_id&limit=1`,
    ),
    restGet<{ user_id: string }[]>(`platform_admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id&limit=1`),
  ]);
  if (membership === null || admin === null) return null;
  return { isMember: membership.length > 0, isPlatformAdmin: admin.length > 0 };
}

export async function GET() {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const orgId = auth.session.orgId as string;

  const [memberships, profiles, platformAdmins, authById] = await Promise.all([
    restGet<{ user_id: string; role: "org_admin" | "member" }[]>(
      `organization_members?org_id=eq.${orgId}&select=user_id,role&order=created_at.asc`,
    ),
    restGet<{ id: string; full_name: string }[]>("profiles?select=id,full_name"),
    restGet<{ user_id: string }[]>("platform_admins?select=user_id"),
    listAuthUsersPaged(),
  ]);
  if (!memberships || !authById) {
    return NextResponse.json({ error: "Ledenlijst kon niet worden opgehaald." }, { status: 502 });
  }
  const nameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));
  const adminIds = new Set((platformAdmins ?? []).map((admin) => admin.user_id));

  const members = memberships.map((membership) => {
    const user = authById.get(membership.user_id);
    return {
      userId: membership.user_id,
      email: user?.email ?? "—",
      name: nameById.get(membership.user_id) ?? "",
      role: membership.role,
      lastSignIn: user?.last_sign_in_at ?? null,
      banned: Boolean(user?.banned_until && new Date(user.banned_until) > new Date()),
      isPlatformAdmin: adminIds.has(membership.user_id),
      isSelf: membership.user_id === auth.session.userId,
    };
  });
  return NextResponse.json({ members }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const orgId = auth.session.orgId as string;

  const body = await readBody(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim().slice(0, 120) : "";
  const role = body?.role === "org_admin" ? "org_admin" : "member";
  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "Ongeldig e-mailadres." }, { status: 400 });
  }
  // Het demodomein is gereserveerd voor het vaste demoaccount.
  if (isCareonHostedDemoEmail(email)) {
    return NextResponse.json({ error: "Dit e-maildomein is gereserveerd." }, { status: 400 });
  }

  // Variant A: account zonder wachtwoord — de gebruiker kiest het zelf via de
  // wachtwoord-link die de beheerder persoonlijk doorgeeft.
  const createResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      email,
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
        action: "org.user.rollback_failed",
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
    action: "org.user.create",
    resource: "auth.users",
    resourceId: created.id,
    orgId,
    userId: auth.session.userId,
    detail: { role, invite: true },
  });
  const inviteLink = await maakWachtwoordLink(email, request);
  return NextResponse.json({ ok: true, id: created.id, inviteLink });
}

export async function PATCH(request: Request) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const orgId = auth.session.orgId as string;

  const body = await readBody(request);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const action = body?.action;
  if (
    !UUID_PATTERN.test(userId) ||
    (action !== "reset_password" && action !== "ban" && action !== "unban" && action !== "invite_link")
  ) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }
  // Jezelf blokkeren is een klassieke lock-out; expliciet weigeren.
  if (action === "ban" && userId === auth.session.userId) {
    return NextResponse.json({ error: "Je kunt jezelf niet blokkeren." }, { status: 400 });
  }

  const target = await targetInOrg(orgId, userId);
  if (!target) {
    return NextResponse.json({ error: "Gebruiker kon niet worden gecontroleerd." }, { status: 502 });
  }
  if (!target.isMember) {
    return NextResponse.json({ error: "Deze gebruiker hoort niet bij uw organisatie." }, { status: 404 });
  }
  // Platformbeheerders vallen buiten organisatiebeheer (anders kan een
  // org_admin de superadmin buitensluiten of diens wachtwoord overnemen).
  if (target.isPlatformAdmin) {
    return NextResponse.json({ error: "Platformbeheerders beheert u niet vanuit de organisatie." }, { status: 403 });
  }

  const targetResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: serviceHeaders(),
    cache: "no-store",
  }).catch(() => null);
  if (!targetResponse?.ok) {
    return NextResponse.json({ error: "Gebruiker kon niet worden gecontroleerd." }, { status: 502 });
  }
  const targetUser = (await targetResponse.json()) as { email?: string | null };
  if (isCareonHostedDemoEmail(targetUser.email) && action !== "unban") {
    return NextResponse.json(
      { error: "Het vaste demoaccount kan niet worden geblokkeerd of gewijzigd." },
      { status: 409 },
    );
  }

  // Nieuwe wachtwoord-link (bijv. verlopen link of vergeten wachtwoord): de
  // gebruiker kiest zelf een nieuw wachtwoord; het token belandt nooit in audit.
  if (action === "invite_link") {
    if (!targetUser.email) {
      return NextResponse.json({ error: "Gebruiker heeft geen e-mailadres." }, { status: 502 });
    }
    const inviteLink = await maakWachtwoordLink(targetUser.email, request);
    if (!inviteLink) {
      return NextResponse.json({ error: "Link genereren mislukte. Probeer het opnieuw." }, { status: 502 });
    }
    scheduleAuditEvent({
      action: "org.user.invite_link",
      resource: "auth.users",
      resourceId: userId,
      orgId,
      userId: auth.session.userId,
    });
    return NextResponse.json({ ok: true, inviteLink });
  }

  let payload: Record<string, unknown>;
  if (action === "reset_password") {
    const password = typeof body?.password === "string" ? body.password : "";
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

  scheduleAuditEvent({
    action: `org.user.${action}`,
    resource: "auth.users",
    resourceId: userId,
    orgId,
    userId: auth.session.userId,
  });
  return NextResponse.json({ ok: true });
}
