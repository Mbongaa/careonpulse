import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import {
  bestaatInBucket,
  downloadUitBucket,
  factuurVanRij,
  haalFactuurRij,
  pdfPadVoor,
  serviceFactuurUpdate,
  storageBeschikbaar,
} from "@/lib/careon-facturatie/facturatie.server";
import { genereerEnArchiveerPdf } from "@/lib/careon-facturatie/pdf-archief.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

export const runtime = "nodejs";

/** Download van de gearchiveerde pdf (service-role ná rolcheck; nooit een
    publieke of signed Storage-URL in de UI — handoff 15 §3.3). */
export async function GET(_request: Request, context: { params: Promise<{ factuurId: string }> }) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;
  const { factuurId } = await context.params;

  try {
    const rij = await haalFactuurRij(session, factuurId);
    if (!rij) {
      return NextResponse.json({ error: "Deze factuur bestaat niet (meer) voor deze organisatie." }, { status: 404 });
    }
    if (!rij.pdf_pad) {
      return NextResponse.json({ error: "Pdf ontbreekt — genereer opnieuw." }, { status: 409 });
    }
    const bytes = await downloadUitBucket(rij.pdf_pad);
    if (!bytes) {
      return NextResponse.json({ error: "Pdf ontbreekt — genereer opnieuw." }, { status: 409 });
    }

    scheduleAuditEvent({
      action: "facturatie.factuur.download",
      resource: "careon_facturatie_facturen",
      resourceId: factuurId,
      orgId: session.orgId,
      userId: session.userId,
      detail: { nummer: rij.nummer },
    });
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${rij.nummer ?? "factuur"}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}

/**
 * Pdf-herstel (handoff 15 §5.5): eerst controleren of het Storage-object al
 * bestaat — sloeg de upload eerder wél aan maar de metadata-update niet, dan
 * alleen de metadata alsnog wegschrijven; anders renderen en uploaden met
 * x-upsert false. Zonder deze check kon de herstelknop nooit meer slagen.
 */
export async function POST(_request: Request, context: { params: Promise<{ factuurId: string }> }) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;
  const { factuurId } = await context.params;

  if (!storageBeschikbaar()) {
    return NextResponse.json({ error: "Authenticatie is niet geconfigureerd." }, { status: 503 });
  }
  try {
    const rij = await haalFactuurRij(session, factuurId);
    if (!rij) {
      return NextResponse.json({ error: "Deze factuur bestaat niet (meer) voor deze organisatie." }, { status: 404 });
    }
    if (rij.status === "concept" || !rij.nummer) {
      return NextResponse.json({ error: "Alleen uitgereikte facturen hebben een archief-pdf." }, { status: 409 });
    }

    const orgId = session.orgId as string;
    const pad = pdfPadVoor(orgId, rij.jaar, rij.nummer);
    let ok: boolean;
    if (await bestaatInBucket(pad)) {
      // Object bestaat al: alleen de ontbrekende metadata herstellen.
      const bytes = await downloadUitBucket(pad);
      ok = bytes !== null;
      if (ok) {
        await serviceFactuurUpdate(orgId, factuurId, {
          pdf_pad: pad,
          pdf_bytes: bytes ? bytes.byteLength : null,
          pdf_gegenereerd_op: new Date().toISOString(),
        });
      }
    } else {
      ok = (await genereerEnArchiveerPdf(orgId, factuurVanRij(rij))).ok;
    }
    if (!ok) {
      return NextResponse.json(
        {
          error:
            "De pdf kon niet worden gegenereerd. De factuur is wel uitgereikt; probeer de pdf opnieuw te genereren.",
        },
        { status: 502 },
      );
    }

    scheduleAuditEvent({
      action: "facturatie.factuur.pdf_herstel",
      resource: "careon_facturatie_facturen",
      resourceId: factuurId,
      orgId: session.orgId,
      userId: session.userId,
      detail: { nummer: rij.nummer },
    });
    const vers = await haalFactuurRij(session, factuurId);
    return NextResponse.json({ configured: true, factuur: vers ? factuurVanRij(vers) : null });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}
