import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import {
  type FactuurRij,
  factuurVanRij,
  haalFactuurRij,
  haalInstellingen,
} from "@/lib/careon-facturatie/facturatie.server";
import { berekenVervaldatum } from "@/lib/careon-facturatie/nummer";
import { genereerEnArchiveerPdf } from "@/lib/careon-facturatie/pdf-archief.server";
import { berekenTotalen } from "@/lib/careon-facturatie/totalen";
import { vindTemplate } from "@/lib/careon-facturatie/types";
import { afzenderUitTemplate, valideerFactuurVoorUitreiking } from "@/lib/careon-facturatie/validatie";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

export const runtime = "nodejs";

const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Definitief maken (handoff 15 §5.5): bevriezen + herrekenen + valideren via
 * het caller-JWT, daarna de atomaire RPC (nummer + statusovergang in één
 * transactie — geen nummergaten, geen verbrande nummers), en pas ná commit de
 * pdf. Faalt de pdf, dan blijft de factuur definitief mét nummer en toont de
 * UI "Pdf opnieuw genereren".
 */
export async function POST(request: Request, context: { params: Promise<{ factuurId: string }> }) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;
  const { factuurId } = await context.params;

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
      return NextResponse.json({ error: "Deze factuur is al uitgereikt." }, { status: 409 });
    }
    const concept = factuurVanRij(rij);
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

    // Stap 1 (caller-JWT, rij is nog concept): snapshots + herrekende totalen
    // bevriezen op de rij, zodat de RPC-overgang exact deze inhoud uitreikt.
    const bevriesParams = new URLSearchParams({
      org_id: `eq.${session.orgId}`,
      id: `eq.${factuurId}`,
      status: "eq.concept",
      select: "id",
    });
    const bevriesResponse = await fetch(`${POSTGREST_URL}/careon_facturatie_facturen?${bevriesParams}`, {
      method: "PATCH",
      headers: userRestHeaders(session, { Prefer: "return=representation" }),
      body: JSON.stringify({
        afzender,
        betaaltermijn_dagen: betaaltermijn,
        subtotaal_cent: totalen.subtotaalCent,
        btw_cent: totalen.btwCent,
        totaal_cent: totalen.totaalCent,
        btw_totalen: totalen.btwTotalen,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!bevriesResponse.ok) throw new Error("storage-unavailable");
    if (((await bevriesResponse.json()) as unknown[]).length === 0) {
      return NextResponse.json({ error: "Deze factuur is al uitgereikt." }, { status: 409 });
    }

    // Stap 2: atomaire RPC — teller + nummer + status in één transactie.
    const reeks = concept.soort === "creditfactuur" ? template.nummering.reeksCredit : template.nummering.reeksFactuur;
    const jaar = Number.parseInt(factuurdatum.slice(0, 4), 10);
    const rpcResponse = await fetch(`${POSTGREST_URL}/rpc/careon_factuur_definitief_maken`, {
      method: "POST",
      headers: userRestHeaders(session),
      body: JSON.stringify({
        p_org: session.orgId,
        p_factuur: factuurId,
        p_reeks: reeks,
        p_jaar: jaar,
        p_start: template.nummering.startVolgnummer,
        p_formaat: template.nummering.formaat,
        p_factuurdatum: factuurdatum,
        p_vervaldatum: vervaldatum,
      }),
    });
    if (!rpcResponse.ok) {
      const tekst = await rpcResponse.text();
      if (tekst.includes("al uitgereikt")) {
        return NextResponse.json({ error: "Deze factuur is al uitgereikt." }, { status: 409 });
      }
      console.error("Facturatie: definitief-RPC faalde", rpcResponse.status, tekst.slice(0, 300));
      throw new Error("storage-unavailable");
    }

    // Stap 3 (ná commit): pdf renderen en archiveren — mislukken laat de
    // factuur definitief mét nummer (geen nummergat, geen rollback).
    const versRij = await haalFactuurRij(session, factuurId);
    if (!versRij) throw new Error("storage-unavailable");
    const definitieveFactuur = factuurVanRij(versRij);
    const pdf = await genereerEnArchiveerPdf(session.orgId as string, definitieveFactuur);

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
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}
