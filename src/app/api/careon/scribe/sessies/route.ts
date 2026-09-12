import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { SCRIBE_PROMPT_VERSION } from "@/lib/careon-scribe/agent.server";
import { SCRIBE_PAGINA_GROOTTE, type SessieAanmakenBody } from "@/lib/careon-scribe/api-contract";
import { legeKlinischeStaat } from "@/lib/careon-scribe/klinische-staat";
import {
  eisScribeMachtiging,
  eisScribeQuota,
  haalBeheerSessieRijen,
  haalScribeInstellingen,
  haalVrijgegevenSessieIds,
  SCRIBE_SESSIES_TABEL,
  type ScribeSessieRij,
  SESSIE_SELECT,
  scribeFoutAntwoord,
  scribeGet,
  scribePost,
  scribeRpc,
  sessieMetadataVoorLijst,
  sessieVanRij,
  sessieVoorLijst,
} from "@/lib/careon-scribe/scribe.server";
import { transcriptieModel, transcriptieProvider } from "@/lib/careon-scribe/transcriptie.server";
import {
  isConsultType,
  isIsoDatum,
  isPatientReferentie,
  isScribeTaal,
  isScribeZoekterm,
  isSessieStatus,
  PATIENT_REFERENTIE_MELDING,
} from "@/lib/careon-scribe/types";
import { magScribeBeheren } from "@/lib/careon-scribe-rol";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireCareonSession } from "@/lib/supabase/session.server";

// Consultlijst en het starten van een consult (handoff 20 §5.3).
//
// De lijst bevat de eigen consulten, de aan de aanvrager vrijgegeven consulten
// en — uitsluitend voor een org_admin — de consulten van collega's ALS
// METADATA ZONDER dossierreferentie en consulttype (S12/V3).
//
// Die weglating is sinds C3/C10 geen serializer-keuze meer maar een grens: de
// select-policy op careon_scribe_sessies geeft een beheerder niets meer, dus
// zijn lijst komt via de SERVICE-ROLE met SESSIE_METADATA_SELECT — een vaste
// kolomlijst waarin patient_referentie en consult_type simpelweg niet staan.
// Zijn eigen en aan hem vrijgegeven consulten leest hij daarnaast gewoon onder
// zijn eigen JWT, mét die velden.
//
// Filters (N16): status, dossierreferentie (zoek) en periode (van/tot). Een
// zoekterm werkt per definitie alleen op de eigen rijen — de beheerdersrijen
// dragen geen referentie en vallen dus buiten elke treffer.

export const runtime = "nodejs";

const MAX_BODY_BYTES = 8 * 1_024;

function isAanmaakBody(value: unknown): value is SessieAanmakenBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.patientReferentie === "string" &&
    isConsultType(body.consultType) &&
    isScribeTaal(body.taal) &&
    body.consentBevestigd === true &&
    typeof body.consentRevisie === "number" &&
    Number.isInteger(body.consentRevisie)
  );
}

export async function GET(request: Request) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");
  const paginaRuw = Number(url.searchParams.get("pagina") ?? "1");
  const pagina = Number.isInteger(paginaRuw) && paginaRuw >= 1 ? Math.min(paginaRuw, 400) : 1;
  const zoekRuw = url.searchParams.get("zoek");
  const zoek = zoekRuw !== null && isScribeZoekterm(zoekRuw) ? zoekRuw.trim() : null;
  const van = isIsoDatum(url.searchParams.get("van")) ? (url.searchParams.get("van") as string) : null;
  const tot = isIsoDatum(url.searchParams.get("tot")) ? (url.searchParams.get("tot") as string) : null;
  if (zoekRuw !== null && zoek === null) {
    return NextResponse.json({ error: PATIENT_REFERENTIE_MELDING }, { status: 400 });
  }
  // Een zoekterm raakt uitsluitend de dossierreferentie, en die staat alleen op
  // de eigen (en vrijgegeven) consulten: de beheerderslijst kent hem niet, dus
  // zoeken schakelt bewust terug naar het eigenaarspad (N16).
  const beheerder = magScribeBeheren(session) && zoek === null;

  try {
    const [{ instellingen }, vrijgegeven] = await Promise.all([
      haalScribeInstellingen(session),
      haalVrijgegevenSessieIds(session),
    ]);

    const params = new URLSearchParams({
      order: "created_at.desc",
      limit: String(SCRIBE_PAGINA_GROOTTE + 1),
      offset: String((pagina - 1) * SCRIBE_PAGINA_GROOTTE),
    });
    if (statusFilter && statusFilter !== "alle" && isSessieStatus(statusFilter)) {
      params.set("status", `eq.${statusFilter}`);
    }
    if (van) params.set("created_at", `gte.${van}`);
    // `created_at` twee keer zetten kan niet in één URLSearchParams-sleutel;
    // de bovengrens gaat daarom als losse `and`-filter mee (PostgREST ANDt de
    // parameters op het hoogste niveau).
    if (tot) params.append("and", `(created_at.lte.${tot}T23:59:59.999Z)`);

    const nu = new Date();
    let zichtbaar: ReturnType<typeof sessieVoorLijst>[] = [];
    let meer = false;

    if (beheerder) {
      // Metadata van de héle organisatie via de service-role (C3/C10).
      const metadataRijen = await haalBeheerSessieRijen(session.orgId as string, params);
      if (!metadataRijen) {
        return NextResponse.json({ error: "Consulten konden niet worden opgehaald." }, { status: 502 });
      }
      meer = metadataRijen.length > SCRIBE_PAGINA_GROOTTE;
      const paginaRijen = metadataRijen.slice(0, SCRIBE_PAGINA_GROOTTE);
      // Eigen en vrijgegeven consulten van deze beheerder mag hij WEL volledig
      // zien; die haalt hij onder zijn eigen JWT op, met dossierreferentie.
      const eigenIds = paginaRijen
        .filter((rij) => rij.behandelaar_id === session.userId || vrijgegeven.has(rij.id))
        .map((rij) => rij.id);
      const volledig = new Map<string, ScribeSessieRij>();
      if (eigenIds.length > 0) {
        const eigenParams = new URLSearchParams({
          select: SESSIE_SELECT,
          org_id: `eq.${session.orgId}`,
          id: `in.(${eigenIds.join(",")})`,
          limit: String(SCRIBE_PAGINA_GROOTTE),
        });
        const eigenRijen = await scribeGet<ScribeSessieRij[]>(session, SCRIBE_SESSIES_TABEL, eigenParams);
        for (const rij of Array.isArray(eigenRijen) ? eigenRijen : []) volledig.set(rij.id, rij);
      }
      zichtbaar = paginaRijen.map((rij) => {
        const eigenRij = volledig.get(rij.id);
        if (!eigenRij) return sessieMetadataVoorLijst(rij, nu);
        return sessieVoorLijst(eigenRij, eigenRij.behandelaar_id === session.userId, vrijgegeven.has(rij.id), nu);
      });
    } else {
      params.set("select", SESSIE_SELECT);
      params.set("org_id", `eq.${session.orgId}`);
      const ids = [...vrijgegeven];
      params.set(
        "or",
        ids.length > 0
          ? `(behandelaar_id.eq.${session.userId},id.in.(${ids.join(",")}))`
          : `(behandelaar_id.eq.${session.userId})`,
      );
      // Deelreferentie; de validator laat geen komma, haakje of BSN-vorm door,
      // dus deze waarde kan het filter niet openbreken.
      if (zoek) params.set("patient_referentie", `ilike.*${zoek}*`);
      const rijen = await scribeGet<ScribeSessieRij[]>(session, SCRIBE_SESSIES_TABEL, params);
      const gevonden = Array.isArray(rijen) ? rijen : [];
      meer = gevonden.length > SCRIBE_PAGINA_GROOTTE;
      zichtbaar = gevonden
        .slice(0, SCRIBE_PAGINA_GROOTTE)
        .map((rij) => sessieVoorLijst(rij, rij.behandelaar_id === session.userId, vrijgegeven.has(rij.id), nu));
    }

    return NextResponse.json(
      {
        configured: true,
        sessies: zichtbaar,
        pagina,
        meer,
        ingeschakeld: instellingen.ingeschakeld,
        gemachtigd: true,
        beheerder: magScribeBeheren(session),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;

  const quota = await eisScribeQuota(session);
  if (quota) return quota;

  let body: unknown;
  try {
    body = await readJsonBodyLimited<unknown>(request, MAX_BODY_BYTES);
  } catch (error) {
    const status = error instanceof RequestPayloadTooLargeError ? 413 : 400;
    if (!(error instanceof RequestPayloadTooLargeError) && !(error instanceof InvalidJsonBodyError)) {
      console.error("Scribe body read failed", { route: "sessies" });
    }
    return NextResponse.json({ error: status === 413 ? "Payload te groot." : "Ongeldige JSON." }, { status });
  }
  if (!isAanmaakBody(body)) {
    return NextResponse.json(
      { error: "Bevestig de toestemmingsverklaring en vul een geldig consulttype en taal in." },
      { status: 400 },
    );
  }
  const referentie = body.patientReferentie.trim();
  if (!isPatientReferentie(referentie)) {
    return NextResponse.json({ error: PATIENT_REFERENTIE_MELDING }, { status: 400 });
  }

  try {
    const { instellingen, revision } = await haalScribeInstellingen(session);
    if (!instellingen.ingeschakeld || revision === 0) {
      return NextResponse.json(
        { error: "Careon AI is niet ingeschakeld voor uw organisatie. Vraag uw beheerder om activatie." },
        { status: 403 },
      );
    }
    // De toestemmingstekst wordt bevroren mét haar revisie (S13). Wijzigde de
    // beheerder de tekst terwijl het formulier openstond, dan hoorde de cliënt
    // een andere tekst dan er zou worden vastgelegd — dus 409.
    if (body.consentRevisie !== revision) {
      return NextResponse.json(
        {
          error: "De toestemmingstekst is intussen gewijzigd. Ververs de pagina en lees de nieuwe tekst voor.",
          revision,
        },
        { status: 409 },
      );
    }

    const provider = transcriptieProvider();
    const ingevoegd = await scribePost<ScribeSessieRij[]>(session, `${SCRIBE_SESSIES_TABEL}?select=${SESSIE_SELECT}`, {
      org_id: session.orgId,
      behandelaar_id: session.userId,
      status: "actief",
      patient_referentie: referentie,
      consult_type: body.consultType,
      taal: body.taal,
      consent_bevestigd_op: new Date().toISOString(),
      consent_revisie: revision,
      transcriptie_provider: provider ?? "handmatig",
      transcriptie_model: transcriptieModel(),
      prompt_versie: SCRIBE_PROMPT_VERSION,
    });
    const rij = Array.isArray(ingevoegd) && ingevoegd.length > 0 ? ingevoegd[0] : null;
    if (!rij) return NextResponse.json({ error: "Consult kon niet worden gestart." }, { status: 502 });

    // Lege staat-rij meteen aanmaken: de werkruimte leest hem bij het openen,
    // en de analyseroute hoeft daardoor nooit een rij te "ontdekken".
    await scribeRpc(session, "careon_scribe_staat_bewaren", {
      p_sessie: rij.id,
      p_versie: 0,
      p_staat: legeKlinischeStaat(),
    });

    scheduleAuditEvent({
      action: "scribe.sessie.start",
      resource: SCRIBE_SESSIES_TABEL,
      resourceId: rij.id,
      orgId: session.orgId,
      userId: session.userId,
      // Metadata-only: nooit de dossierreferentie of de consultinhoud.
      detail: { consultType: rij.consult_type, taal: rij.taal, consentRevisie: revision },
    });

    return NextResponse.json(
      { configured: true, sessie: sessieVanRij(rij, true, false) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error, "Consult kon niet worden gestart.");
  }
}
