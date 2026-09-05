import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import {
  type FactuurRij,
  factuurVanRij,
  haalFactuurRij,
  haalInstellingen,
  storageBeschikbaar,
} from "@/lib/careon-facturatie/facturatie.server";
import { berekenVervaldatum } from "@/lib/careon-facturatie/nummer";
import { genereerEnArchiveerPdf } from "@/lib/careon-facturatie/pdf-archief.server";
import { berekenTotalen } from "@/lib/careon-facturatie/totalen";
import { isFactuur, vindTemplate } from "@/lib/careon-facturatie/types";
import { FactuurConflictError, reikFactuurAtomairUit } from "@/lib/careon-facturatie/uitreiking.server";
import { afzenderUitTemplate, valideerFactuurVoorUitreiking } from "@/lib/careon-facturatie/validatie";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

export const runtime = "nodejs";

const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Definitief maken (handoff 15 §5.5): herrekenen en valideren, daarna de
 * service-only RPC die revisiecontrole, inhoud en nummer samen vastlegt.
 * Geen concept-write kan tussen het bevriezen en de uitreiking komen. De route heeft
 * requireOrgAdmin() al afgedwongen en de RPC herbevestigt actor + organisatie.
 * Pas ná commit volgt de pdf. Faalt die, dan blijft de factuur definitief mét
 * nummer en toont de UI "Pdf opnieuw genereren".
 */
export async function POST(request: Request, context: { params: Promise<{ factuurId: string }> }) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;
  const { factuurId } = await context.params;
  if (!storageBeschikbaar()) {
    return NextResponse.json({ error: "Authenticatie is niet geconfigureerd." }, { status: 503 });
  }

  let body: unknown = {};
  try {
    body = await readJsonBodyLimited<unknown>(request, 10_000);
  } catch (error) {
    if (error instanceof RequestPayloadTooLargeError) {
      return NextResponse.json({ error: "Payload te groot." }, { status: 413 });
    }
    if (!(error instanceof InvalidJsonBodyError)) console.error("Facturatie body read failed", error);
    // Lege body is toegestaan: factuurdatum valt dan op vandaag.
  }
  const gewensteDatum =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).factuurdatum === "string"
      ? ((body as Record<string, unknown>).factuurdatum as string)
      : null;
  if (gewensteDatum !== null && !ISO_DATUM.test(gewensteDatum)) {
    return NextResponse.json({ error: "Ongeldige factuurdatum." }, { status: 400 });
  }

  try {
    const rij = await haalFactuurRij(session, factuurId);
    if (!rij) {
      return NextResponse.json({ error: "Deze factuur bestaat niet (meer) voor deze organisatie." }, { status: 404 });
    }
    if (rij.status !== "concept") {
      return NextResponse.json({ configured: true, factuur: factuurVanRij(rij), pdfOntbreekt: !rij.pdf_pad });
    }
    const concept = factuurVanRij(rij);
    if (!isFactuur(concept)) {
      return NextResponse.json({ error: "Ongeldige of onvolledige factuur." }, { status: 400 });
    }
    const { instellingen } = await haalInstellingen(session);
    // Sjabloonkeuze van het concept (afzender-snapshot draagt het id); de
    // snapshot zelf wordt hier opnieuw uit het sjabloon herleid — nooit uit
    // client-inhoud.
    const template = vindTemplate(instellingen, concept.afzender?.templateId);
    if (template.afzender.statutaireNaam.trim().length === 0) {
      return NextResponse.json(
        { error: "Vul eerst uw bedrijfsgegevens in bij Facturatie-instellingen." },
        { status: 400 },
      );
    }

    const afzender = afzenderUitTemplate(template);
    const factuurdatum = gewensteDatum ?? new Date().toISOString().slice(0, 10);
    const betaaltermijn = concept.betaaltermijnDagen ?? template.betaling.standaardTermijnDagen;
    const vervaldatum = berekenVervaldatum(factuurdatum, betaaltermijn);
    const totalen = berekenTotalen(concept.regels);

    const validatie = valideerFactuurVoorUitreiking({ ...concept, factuurdatum }, afzender);
    if (!validatie.ok) {
      return NextResponse.json(
        { error: "Vul eerst alle wettelijk verplichte factuurgegevens in.", ontbrekend: validatie.ontbrekend },
        { status: 400 },
      );
    }

    const uitreiking = await reikFactuurAtomairUit(
      session,
      factuurId,
      rij.revision,
      {
        ...concept,
        ...totalen,
        afzender,
        factuurdatum,
        vervaldatum,
        betaaltermijnDagen: betaaltermijn,
      },
      template,
    );

    // Stap 3 (ná commit): pdf renderen en archiveren — mislukken laat de
    // factuur definitief mét nummer (geen nummergat, geen rollback).
    const versRij = await haalFactuurRij(session, factuurId);
    if (!versRij) throw new Error("storage-unavailable");
    const definitieveFactuur = factuurVanRij(versRij);
    const pdf = uitreiking.alreadyIssued
      ? { ok: Boolean(versRij.pdf_pad) }
      : await genereerEnArchiveerPdf(session.orgId as string, definitieveFactuur);

    scheduleAuditEvent({
      action: "facturatie.factuur.definitief",
      resource: "careon_facturatie_facturen",
      resourceId: factuurId,
      orgId: session.orgId,
      userId: session.userId,
      detail: {
        nummer: definitieveFactuur.nummer,
        totaalCent: definitieveFactuur.totaalCent,
        regels: definitieveFactuur.regels.length,
        pdf: pdf.ok,
      },
    });
    const naPdf = pdf.ok ? await haalFactuurRij(session, factuurId) : versRij;
    return NextResponse.json({
      configured: true,
      factuur: factuurVanRij((naPdf ?? versRij) as FactuurRij),
      pdfOntbreekt: !pdf.ok,
      ...(pdf.ok
        ? {}
        : {
            melding:
              "De pdf kon niet worden gegenereerd. De factuur is wel uitgereikt; probeer de pdf opnieuw te genereren.",
          }),
    });
  } catch (error) {
    if (error instanceof FactuurConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}
