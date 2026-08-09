import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import {
  CONTACT_SELECT,
  type ContactRij,
  contactVanRij,
  rijVanContact,
} from "@/lib/careon-facturatie/facturatie.server";
import { FACTURATIE_LIMITS, isFacturatieContact } from "@/lib/careon-facturatie/types";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 50_000;

export async function GET() {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;

  const params = new URLSearchParams({
    select: CONTACT_SELECT,
    org_id: `eq.${session.orgId}`,
    order: "naam.asc",
    limit: String(FACTURATIE_LIMITS.contacten),
  });
  try {
    const response = await fetch(`${POSTGREST_URL}/careon_facturatie_contacten?${params}`, {
      headers: userRestHeaders(session),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("storage-unavailable");
    const rows = (await response.json()) as ContactRij[];
    return NextResponse.json({ configured: true, contacten: rows.map(contactVanRij) });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}

/** Nieuw contact — incl. "Overnemen als contact" vanuit de medewerkerslijst
    (soort "medewerker", bron "medewerker"; handoff 15 §3.4). */
export async function POST(request: Request) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;

  let body: unknown;
  try {
    body = await readJsonBodyLimited<unknown>(request, MAX_BODY_BYTES);
  } catch (error) {
    const status = error instanceof RequestPayloadTooLargeError ? 413 : 400;
    if (!(error instanceof RequestPayloadTooLargeError) && !(error instanceof InvalidJsonBodyError)) {
      console.error("Facturatie body read failed", error);
    }
    return NextResponse.json({ error: status === 413 ? "Payload te groot." : "Ongeldige JSON." }, { status });
  }
  const kandidaat = body && typeof body === "object" ? (body as Record<string, unknown>).contact : null;
  if (!isFacturatieContact(kandidaat)) {
    return NextResponse.json({ error: "Ongeldig contact." }, { status: 400 });
  }

  try {
    const response = await fetch(`${POSTGREST_URL}/careon_facturatie_contacten?select=${CONTACT_SELECT}`, {
      method: "POST",
      headers: userRestHeaders(session, { Prefer: "return=representation" }),
      body: JSON.stringify(rijVanContact(kandidaat, session.orgId as string, session.userId)),
    });
    if (!response.ok) throw new Error("storage-unavailable");
    const rows = (await response.json()) as ContactRij[];
    if (rows.length === 0) throw new Error("storage-unavailable");

    scheduleAuditEvent({
      action: "facturatie.contact.toevoegen",
      resource: "careon_facturatie_contacten",
      resourceId: rows[0].id,
      orgId: session.orgId,
      userId: session.userId,
      detail: { soort: rows[0].soort, bron: rows[0].bron },
    });
    return NextResponse.json({ configured: true, contact: contactVanRij(rows[0]) });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}
