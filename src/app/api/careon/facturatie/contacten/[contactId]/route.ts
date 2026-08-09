import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import {
  CONTACT_SELECT,
  type ContactRij,
  contactVanRij,
  rijVanContact,
} from "@/lib/careon-facturatie/facturatie.server";
import { isFacturatieContact } from "@/lib/careon-facturatie/types";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ contactId: string }> }) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;
  const { contactId } = await context.params;

  let body: unknown;
  try {
    body = await readJsonBodyLimited<unknown>(request, 50_000);
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
    const params = new URLSearchParams({
      org_id: `eq.${session.orgId}`,
      id: `eq.${contactId}`,
      select: CONTACT_SELECT,
    });
    const rij = rijVanContact(kandidaat, session.orgId as string);
    // created_by en org_id niet herschrijven bij een update.
    const { org_id: _org, created_by: _cb, ...patch } = rij;
    const response = await fetch(`${POSTGREST_URL}/careon_facturatie_contacten?${params}`, {
      method: "PATCH",
      headers: userRestHeaders(session, { Prefer: "return=representation" }),
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error("storage-unavailable");
    const rows = (await response.json()) as ContactRij[];
    if (rows.length === 0) {
      return NextResponse.json({ error: "Dit contact bestaat niet (meer) voor deze organisatie." }, { status: 404 });
    }
    scheduleAuditEvent({
      action: "facturatie.contact.wijzig",
      resource: "careon_facturatie_contacten",
      resourceId: contactId,
      orgId: session.orgId,
      userId: session.userId,
      detail: { soort: rows[0].soort, archief: rows[0].archief },
    });
    return NextResponse.json({ configured: true, contact: contactVanRij(rows[0]) });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}

/** Hard verwijderen kan alleen zolang geen factuur naar het contact wijst
    (FK on delete restrict); anders archiveert de client (archief=true). */
export async function DELETE(_request: Request, context: { params: Promise<{ contactId: string }> }) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;
  const { contactId } = await context.params;

  try {
    const params = new URLSearchParams({
      org_id: `eq.${session.orgId}`,
      id: `eq.${contactId}`,
    });
    const response = await fetch(`${POSTGREST_URL}/careon_facturatie_contacten?${params}`, {
      method: "DELETE",
      headers: userRestHeaders(session),
    });
    if (response.status === 409) {
      // FK-restrict: er verwijzen facturen naar dit contact.
      return NextResponse.json(
        { error: "Dit contact staat op een factuur en kan alleen worden gearchiveerd.", archiveerbaar: true },
        { status: 409 },
      );
    }
    if (!response.ok) throw new Error("storage-unavailable");

    scheduleAuditEvent({
      action: "facturatie.contact.verwijder",
      resource: "careon_facturatie_contacten",
      resourceId: contactId,
      orgId: session.orgId,
      userId: session.userId,
    });
    return NextResponse.json({ configured: true });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}
