import { NextResponse } from "next/server";

import { eersteOrgAfhankelijkheid, organizationById } from "@/lib/careon-admin/admin.server";
import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { InvalidJsonBodyError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireSuperadmin } from "@/lib/supabase/session.server";

// Beheer: organisaties aanmaken, hernoemen en (alleen als ze leeg zijn)
// verwijderen (handoff 13, fase 4). Service-role na expliciete
// superadmin-check; elke beheeractie wordt geauditeerd.

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function serviceHeaders(extra?: HeadersInit): HeadersInit {
  return {
    apikey: SERVICE_KEY as string,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

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
    headers: serviceHeaders({ Prefer: "return=representation" }),
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

/**
 * Hernoemen (spec §8). De naam mag altijd; de slug alleen expliciet, want hij
 * is uniek en wordt in migraties en seeds als sleutel gebruikt — een stille
 * slugwijziging breekt die verwijzingen. Wie hem niet meestuurt, houdt hem.
 */
export async function PATCH(request: Request) {
  const auth = await requireSuperadmin();
  if ("denied" in auth) return auth.denied;

  let body: { id?: unknown; name?: unknown; slug?: unknown };
  try {
    body = await readJsonBodyLimited<{ id?: unknown; name?: unknown; slug?: unknown }>(request, 10_000);
  } catch (error) {
    if (!(error instanceof InvalidJsonBodyError)) {
      console.error("Admin organizations body read failed", error);
    }
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!UUID_PATTERN.test(id) || name === "" || name.length > 120) {
    return NextResponse.json({ error: "Ongeldige naam." }, { status: 400 });
  }
  if (slug !== "" && !SLUG_PATTERN.test(slug)) {
    return NextResponse.json({ error: "Ongeldige slug." }, { status: 400 });
  }

  const patch: Record<string, string> = slug === "" ? { name } : { name, slug };
  const response = await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${id}`, {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  }).catch(() => null);
  if (!response?.ok) {
    if (response?.status === 409) {
      return NextResponse.json({ error: "Deze slug bestaat al." }, { status: 409 });
    }
    return NextResponse.json({ error: "Organisatie kon niet worden bijgewerkt." }, { status: 502 });
  }
  const updated = (await response.json()) as { id: string }[];
  if (updated.length === 0) {
    return NextResponse.json({ error: "Organisatie niet gevonden." }, { status: 404 });
  }

  scheduleAuditEvent({
    action: "admin.org.rename",
    resource: "organizations",
    resourceId: id,
    orgId: id,
    userId: auth.session.userId,
    detail: patch,
  });
  return NextResponse.json({ ok: true });
}

/**
 * Een per ongeluk aangemaakte organisatie opruimen. Bewust alleen als er niets
 * aan hangt: registraties, imports en gesprekken verwijzen zonder cascade naar
 * organizations, dus een gevulde organisatie verwijderen zou klantdata mee
 * moeten nemen; lidmaatschappen cascaderen wél (0009) en zouden dus zonder deze
 * controle stil verdwijnen. Deactiveren bestaat niet — organizations kent geen
 * statuskolom.
 */
export async function DELETE(request: Request) {
  const auth = await requireSuperadmin();
  if ("denied" in auth) return auth.denied;

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const organisaties = await organizationById(id);
  if (!organisaties.ok) {
    return NextResponse.json({ error: "Organisatie kon niet worden gecontroleerd." }, { status: 502 });
  }
  const organisatie = organisaties.data[0];
  if (!organisatie) {
    return NextResponse.json({ error: "Organisatie niet gevonden." }, { status: 404 });
  }

  const afhankelijkheid = await eersteOrgAfhankelijkheid(id);
  if (!afhankelijkheid.ok) {
    return NextResponse.json({ error: "Organisatie kon niet worden gecontroleerd." }, { status: 502 });
  }
  if (afhankelijkheid.data) {
    return NextResponse.json(
      {
        error: `Er hangt nog data aan deze organisatie (${afhankelijkheid.data}); verwijderen kan alleen als ze leeg is.`,
      },
      { status: 409 },
    );
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${id}`, {
    method: "DELETE",
    headers: serviceHeaders({ Prefer: "return=representation" }),
  }).catch(() => null);
  if (!response?.ok) {
    // 409 = sleutelconflict: er verwijst dan tóch nog een rij zonder cascade
    // naar deze organisatie (registraties, gesprekken, telemetrie —
    // lidmaatschappen cascaderen en vangt alleen de pre-check hierboven).
    // Dat is geen storing maar een blokkade — zeg dat, met de vervolgstap.
    if (response?.status === 409) {
      return NextResponse.json(
        { error: "Er hangt nog data aan deze organisatie; ruim die eerst op en probeer het opnieuw." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Organisatie kon niet worden verwijderd." }, { status: 502 });
  }
  // Net als bij PATCH: een lege representation betekent dat de rij al weg was
  // (bijvoorbeeld door een andere beheerder) — geen valse succesmelding geven.
  const verwijderd = (await response.json().catch(() => [])) as { id: string }[];
  if (verwijderd.length === 0) {
    return NextResponse.json({ error: "Organisatie niet gevonden." }, { status: 404 });
  }

  scheduleAuditEvent({
    action: "admin.org.delete",
    resource: "organizations",
    resourceId: id,
    // Zonder orgId: de organisatie bestaat niet meer, en audit_events.org_id
    // verwijst naar organizations — de rij zou zichzelf leegzetten.
    userId: auth.session.userId,
    detail: { name: organisatie.name, slug: organisatie.slug },
  });
  return NextResponse.json({ ok: true });
}
