import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import {
  FACTUUR_SELECT,
  type FactuurRij,
  factuurVanRij,
  haalFactuurRij,
  haalInstellingen,
  serviceFactuurUpdate,
  storageBeschikbaar,
} from "@/lib/careon-facturatie/facturatie.server";
import { berekenVervaldatum } from "@/lib/careon-facturatie/nummer";
import { genereerEnArchiveerPdf } from "@/lib/careon-facturatie/pdf-archief.server";
import { berekenTotalen } from "@/lib/careon-facturatie/totalen";
import type { FactuurRegel } from "@/lib/careon-facturatie/types";
import { afzenderUitInstellingen } from "@/lib/careon-facturatie/validatie";
import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

const CREDITEERBAAR = new Set(["definitief", "verzonden", "betaald"]);

/**
 * Crediteren (handoff 15 §5.5): nieuwe rij soort creditfactuur in de
 * creditreeks met genegeerde regels en verwijzing naar het origineel, direct
 * uitgereikt via dezelfde atomaire RPC; het origineel gaat daarna — via de
 * service-role, de inhoud is bevroren — naar status "gecrediteerd".
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
    const origineel = factuurVanRij(origineelRij);
    const { instellingen } = await haalInstellingen(session);
    const afzender = afzenderUitInstellingen(instellingen);

    const creditRegels: FactuurRegel[] = origineel.regels.map((regel) => ({
      ...regel,
      id: randomUUID(),
      aantal: -regel.aantal,
    }));
    const totalen = berekenTotalen(creditRegels);
    const factuurdatum = new Date().toISOString().slice(0, 10);
    const betaaltermijn = origineel.betaaltermijnDagen ?? instellingen.betaling.standaardTermijnDagen;
    const vervaldatum = berekenVervaldatum(factuurdatum, betaaltermijn);
    const jaar = Number.parseInt(factuurdatum.slice(0, 4), 10);

    // Creditrij aanmaken als concept (caller-JWT — de insert-policy staat
    // alleen concepten toe) met bevroren snapshots van het origineel.
    const insertResponse = await fetch(`${POSTGREST_URL}/careon_facturatie_facturen?select=${FACTUUR_SELECT}`, {
      method: "POST",
      headers: userRestHeaders(session, { Prefer: "return=representation" }),
      body: JSON.stringify({
        org_id: session.orgId,
        status: "concept",
        soort: "creditfactuur",
        reeks: instellingen.nummering.reeksCredit,
        jaar,
        gecrediteerde_factuur_id: factuurId,
        contact_id: origineel.contactId,
        afnemer: origineel.afnemer,
        afzender,
        uw_kenmerk: origineel.uwKenmerk ?? null,
        order_referentie: origineel.orderReferentie ?? null,
        regels: creditRegels,
        btw_totalen: totalen.btwTotalen,
        vrijstelling_tekst: origineel.vrijstellingTekst ?? null,
        subtotaal_cent: totalen.subtotaalCent,
        btw_cent: totalen.btwCent,
        totaal_cent: totalen.totaalCent,
        betaaltermijn_dagen: betaaltermijn,
        opmerking: `Creditering van factuur ${origineel.nummer ?? ""}`.trim(),
        created_by: session.userId,
      }),
    });
    if (!insertResponse.ok) throw new Error("storage-unavailable");
    const inserted = (await insertResponse.json()) as FactuurRij[];
    if (inserted.length === 0) throw new Error("storage-unavailable");
    const creditId = inserted[0].id;

    // Direct uitreiken via de atomaire RPC (creditreeks).
    const rpcResponse = await fetch(`${POSTGREST_URL}/rpc/careon_factuur_definitief_maken`, {
      method: "POST",
      headers: userRestHeaders(session),
      body: JSON.stringify({
        p_org: session.orgId,
        p_factuur: creditId,
        p_reeks: instellingen.nummering.reeksCredit,
        p_jaar: jaar,
        p_start: instellingen.nummering.startVolgnummer,
        p_formaat: instellingen.nummering.formaat,
        p_factuurdatum: factuurdatum,
        p_vervaldatum: vervaldatum,
      }),
    });
    if (!rpcResponse.ok) {
      console.error("Facturatie: credit-RPC faalde", rpcResponse.status, (await rpcResponse.text()).slice(0, 300));
      throw new Error("storage-unavailable");
    }

    // Origineel markeren als gecrediteerd (administratief veld, service-role).
    await serviceFactuurUpdate(session.orgId as string, factuurId, { status: "gecrediteerd" });

    const versCreditRij = await haalFactuurRij(session, creditId);
    if (!versCreditRij) throw new Error("storage-unavailable");
    const credit = factuurVanRij(versCreditRij);
    const pdf = await genereerEnArchiveerPdf(session.orgId as string, credit);

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
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}
