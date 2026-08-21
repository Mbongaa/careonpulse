import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import {
  bestaatInBucket,
  downloadUitBucket,
  factuurVanRij,
  haalFactuurRij,
  pdfPadVoor,
  serviceFactuurUpdate,
  serviceRestHeaders,
  storageBeschikbaar,
} from "@/lib/careon-facturatie/facturatie.server";
import { genereerEnArchiveerPdf } from "@/lib/careon-facturatie/pdf-archief.server";
import { POSTGREST_URL } from "@/lib/supabase/postgrest.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

import { createHash } from "node:crypto";

export const runtime = "nodejs";

function privateNoStore<T>(response: NextResponse<T>): NextResponse<T> {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

/** Download van de gearchiveerde pdf (service-role ná rolcheck; nooit een
    publieke of signed Storage-URL in de UI — handoff 15 §3.3). */
export async function GET(_request: Request, context: { params: Promise<{ factuurId: string }> }) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return privateNoStore(auth.denied);
  const session = auth.session;
  const { factuurId } = await context.params;

  try {
    const rij = await haalFactuurRij(session, factuurId);
    if (!rij) {
      return privateNoStore(
        NextResponse.json({ error: "Deze factuur bestaat niet (meer) voor deze organisatie." }, { status: 404 }),
      );
    }
    if (!rij.pdf_pad) {
      return privateNoStore(NextResponse.json({ error: "Pdf ontbreekt — genereer opnieuw." }, { status: 409 }));
    }
    const bytes = await downloadUitBucket(rij.pdf_pad);
    if (!bytes) {
      return privateNoStore(NextResponse.json({ error: "Pdf ontbreekt — genereer opnieuw." }, { status: 409 }));
    }

    scheduleAuditEvent({
      action: "facturatie.factuur.download",
      resource: "careon_facturatie_facturen",
      resourceId: factuurId,
      orgId: session.orgId,
      userId: session.userId,
      detail: { nummer: rij.nummer },
    });
    return privateNoStore(
      new NextResponse(bytes, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${rij.nummer ?? "factuur"}.pdf"`,
        },
      }),
    );
  } catch {
    return privateNoStore(NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 }));
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
  if ("denied" in auth) return privateNoStore(auth.denied);
  const session = auth.session;
  const { factuurId } = await context.params;

  if (!storageBeschikbaar()) {
    return privateNoStore(NextResponse.json({ error: "Authenticatie is niet geconfigureerd." }, { status: 503 }));
  }
  try {
    const rij = await haalFactuurRij(session, factuurId);
    if (!rij) {
      return privateNoStore(
        NextResponse.json({ error: "Deze factuur bestaat niet (meer) voor deze organisatie." }, { status: 404 }),
      );
    }
    if (rij.status === "concept" || !rij.nummer) {
      return privateNoStore(
        NextResponse.json({ error: "Alleen uitgereikte facturen hebben een archief-pdf." }, { status: 409 }),
      );
    }

    const orgId = session.orgId as string;
    const pad = pdfPadVoor(orgId, rij.jaar, rij.nummer);
    let ok: boolean;
    if (await bestaatInBucket(pad)) {
      // Object bestaat al: alleen de ontbrekende metadata herstellen. De
      // hash wordt uitsluitend gezet als hij nog ontbreekt — een bestaande
      // pdf_sha256 is het integriteitsanker van het gearchiveerde object en
      // mag nooit worden overschreven met een hash van datzelfde object
      // (dat zou de controle tautologisch maken).
      const bytes = await downloadUitBucket(pad);
      ok = bytes !== null;
      if (ok && bytes) {
        const hashParams = new URLSearchParams({
          org_id: `eq.${orgId}`,
          id: `eq.${factuurId}`,
          select: "pdf_sha256",
        });
        const hashResponse = await fetch(`${POSTGREST_URL}/careon_facturatie_facturen?${hashParams}`, {
          headers: serviceRestHeaders(),
          cache: "no-store",
        });
        if (!hashResponse.ok) throw new Error("storage-unavailable");
        const bestaandeHash = ((await hashResponse.json()) as { pdf_sha256: string | null }[])[0]?.pdf_sha256 ?? null;
        await serviceFactuurUpdate(orgId, factuurId, {
          pdf_pad: pad,
          pdf_sha256: bestaandeHash ?? createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
          pdf_bytes: bytes.byteLength,
          pdf_gegenereerd_op: new Date().toISOString(),
        });
      }
    } else {
      ok = (await genereerEnArchiveerPdf(orgId, factuurVanRij(rij))).ok;
    }
    if (!ok) {
      return privateNoStore(
        NextResponse.json(
          {
            error:
              "De pdf kon niet worden gegenereerd. De factuur is wel uitgereikt; probeer de pdf opnieuw te genereren.",
          },
          { status: 502 },
        ),
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
    return privateNoStore(NextResponse.json({ configured: true, factuur: vers ? factuurVanRij(vers) : null }));
  } catch {
    return privateNoStore(NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 }));
  }
}
