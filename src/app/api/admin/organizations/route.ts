import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { InvalidJsonBodyError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireSuperadmin } from "@/lib/supabase/session.server";

// Beheer: organisaties aanmaken (handoff 13, fase 4). Service-role na
// expliciete superadmin-check; elke beheeractie wordt geauditeerd.

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export async function POST(request: Request) {
  const auth = await requireSuperadmin();
  if ("denied" in auth) return auth.denied;

  let body: { name?: unknown; slug?: unknown };
  try {
    body = await readJsonBodyLimited<{ name?: unknown; slug?: unknown }>(request, 10_000);
  } catch (error) {
    if (!(error instanceof InvalidJsonBodyError)) {
      console.error("Admin organizations body read failed", error);
    }
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (name === "" || name.length > 120 || !SLUG_PATTERN.test(slug)) {
    return NextResponse.json({ error: "Ongeldige naam of slug." }, { status: 400 });
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/organizations`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY as string,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ name, slug }),
  }).catch(() => null);
  if (!response?.ok) {
    if (response?.status === 409) {
      return NextResponse.json({ error: "Deze slug bestaat al." }, { status: 409 });
    }
    return NextResponse.json({ error: "Organisatie kon niet worden aangemaakt." }, { status: 502 });
  }
  const rows = (await response.json()) as { id: string }[];
  const organizationId = rows.length > 0 ? rows[0].id : null;

  scheduleAuditEvent({
    action: "admin.org.create",
    resource: "organizations",
    resourceId: organizationId ?? undefined,
    orgId: organizationId,
    userId: auth.session.userId,
    detail: { name, slug },
  });
  return NextResponse.json({ ok: true, id: organizationId });
}
