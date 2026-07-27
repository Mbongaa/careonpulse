import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { isCareonHostedDemoEmail } from "@/lib/careon-demo-account";
import { CAREON_PASSWORD_HINT, isStrongCareonPassword } from "@/lib/careon-password";
import { InvalidJsonBodyError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireSuperadmin } from "@/lib/supabase/session.server";

// Beheer: gebruikers aanmaken en beheren (handoff 13, fase 4; besluit 3 =
// handmatige provisioning, geen e-mailinfra). Service-role na expliciete
// superadmin-check; elke beheeractie wordt geauditeerd (nooit wachtwoorden).

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

export async function POST(request: Request) {
  const auth = await requireSuperadmin();
  if ("denied" in auth) return auth.denied;

  const body = await readBody(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim().slice(0, 120) : "";
  const password = typeof body?.password === "string" ? body.password : "";
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
  const action = body?.action;
  if (!UUID_PATTERN.test(userId) || (action !== "reset_password" && action !== "ban" && action !== "unban")) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }
  // Jezelf blokkeren is een klassieke lock-out; expliciet weigeren.
  if (action === "ban" && userId === auth.session.userId) {
    return NextResponse.json({ error: "Je kunt jezelf niet blokkeren." }, { status: 400 });
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
    action: `admin.user.${action}`,
    resource: "auth.users",
    resourceId: userId,
    userId: auth.session.userId,
  });
  return NextResponse.json({ ok: true });
}
