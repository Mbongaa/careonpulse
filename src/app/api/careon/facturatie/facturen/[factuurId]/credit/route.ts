import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import {
  factuurVanRij,
  haalFactuurRij,
  haalInstellingen,
  storageBeschikbaar,
} from "@/lib/careon-facturatie/facturatie.server";
import { berekenVervaldatum } from "@/lib/careon-facturatie/nummer";
import { genereerEnArchiveerPdf } from "@/lib/careon-facturatie/pdf-archief.server";
import { berekenTotalen } from "@/lib/careon-facturatie/totalen";
import type { FactuurRegel } from "@/lib/careon-facturatie/types";
import { isFactuur, vindTemplate } from "@/lib/careon-facturatie/types";
import { FactuurConflictError, reikFactuurAtomairUit } from "@/lib/careon-facturatie/uitreiking.server";
import { afzenderUitTemplate, valideerFactuurVoorUitreiking } from "@/lib/careon-facturatie/validatie";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

const CREDITEERBAAR = new Set(["definitief", "verzonden", "betaald", "gecrediteerd"]);

/**
 * Crediteren (handoff 15 §5.5): nieuwe rij soort creditfactuur in de
 * creditreeks met genegeerde regels en verwijzing naar het origineel. De RPC
 * vergrendelt het origineel en legt credit, nummer en originele status samen
 * vast. Een herhaalde aanvraag geeft dezelfde credit terug.
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
    const origineelRij = await haalFactuurRij(session, factuurId);
    if (!origineelRij) {
      return NextResponse.json({ error: "Deze factuur bestaat niet (meer) voor deze organisatie." }, { status: 404 });
    }
    if (origineelRij.soort !== "factuur" || !CREDITEERBAAR.has(origineelRij.status)) {
      return NextResponse.json({ error: "Alleen een uitgereikte factuur kan worden gecrediteerd." }, { status: 409 });
    }
    if (origineelRij.status === "gecrediteerd") {
      const bestaand = await reikFactuurAtomairUit(session, factuurId, origineelRij.revision, null, null, true);
      const credit = await haalFactuurRij(session, bestaand.factuurId);
      if (!credit) throw new Error("storage-unavailable");
      return NextResponse.json({ configured: true, factuur: factuurVanRij(credit), pdfOntbreekt: !credit.pdf_pad });
    }
    const origineel = factuurVanRij(origineelRij);
    if (!isFactuur(origineel)) {
      return NextResponse.json({ error: "Ongeldige of onvolledige factuur." }, { status: 400 });
    }
    const { instellingen } = await haalInstellingen(session);
    // Creditfactuur volgt het sjabloon van het origineel (zelfde huisstijl).
    const template = vindTemplate(instellingen, origineel.afzender?.templateId);
    const afzender = afzenderUitTemplate(template);

    const creditRegels: FactuurRegel[] = origineel.regels.map((regel) => ({
      ...regel,
      id: randomUUID(),
      aantal: -regel.aantal,
    }));
    const totalen = berekenTotalen(creditRegels);
    const factuurdatum = new Date().toISOString().slice(0, 10);
    const betaaltermijn = origineel.betaaltermijnDagen ?? template.betaling.standaardTermijnDagen;
    const vervaldatum = berekenVervaldatum(factuurdatum, betaaltermijn);

    // Ook een creditfactuur is een uitreiking (art. 35a): dezelfde
    // volledigheidsvalidatie als de definitief-route, vóór er iets wordt
    // geschreven — een sindsdien uitgekleed sjabloon mag geen onwijzigbare,
    // onvolledige creditfactuur opleveren.
    const validatie = valideerFactuurVoorUitreiking(
      {
        factuurdatum,
        prestatieVan: origineel.prestatieVan,
        prestatieTot: origineel.prestatieTot,
        afnemer: origineel.afnemer,
        regels: creditRegels,
        vrijstellingTekst: origineel.vrijstellingTekst,
      },
      afzender,
    );
    if (!validatie.ok) {
      return NextResponse.json(
        { error: "Vul eerst alle wettelijk verplichte factuurgegevens in.", ontbrekend: validatie.ontbrekend },
        { status: 400 },
      );
    }

    const uitreiking = await reikFactuurAtomairUit(
      session,
      factuurId,
      origineelRij.revision,
      {
        ...origineel,
        ...totalen,
        afzender,
        regels: creditRegels,
        factuurdatum,
        vervaldatum,
        betaaltermijnDagen: betaaltermijn,
        opmerking: `Creditering van factuur ${origineel.nummer ?? ""}`.trim(),
      },
      template,
      true,
    );
    const creditId = uitreiking.factuurId;

    const versCreditRij = await haalFactuurRij(session, creditId);
    if (!versCreditRij) throw new Error("storage-unavailable");
    const credit = factuurVanRij(versCreditRij);
    const pdf = uitreiking.alreadyIssued
      ? { ok: Boolean(versCreditRij.pdf_pad) }
      : await genereerEnArchiveerPdf(session.orgId as string, credit);

    scheduleAuditEvent({
      action: "facturatie.factuur.credit",
      resource: "careon_facturatie_facturen",
      resourceId: creditId,
      orgId: session.orgId,
      userId: session.userId,
      detail: { origineel: origineel.nummer, nummer: credit.nummer, totaalCent: credit.totaalCent, pdf: pdf.ok },
    });
    const naPdf = pdf.ok ? await haalFactuurRij(session, creditId) : versCreditRij;
    return NextResponse.json({
      configured: true,
      factuur: factuurVanRij(naPdf ?? versCreditRij),
      pdfOntbreekt: !pdf.ok,
    });
  } catch (error) {
    if (error instanceof FactuurConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}
