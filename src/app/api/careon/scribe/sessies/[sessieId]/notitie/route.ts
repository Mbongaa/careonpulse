import { NextResponse } from "next/server";

import { authenticatedActorHash } from "@/lib/careon-assistant/runtime.server";
import { citaatSegmenten, gatSegmentenVan, genereerVerslag } from "@/lib/careon-scribe/agent.server";
import { type NotitieGenereerBody, SCRIBE_BODY_LIMIETEN } from "@/lib/careon-scribe/api-contract";
import {
  eisScribeMachtiging,
  eisScribeQuota,
  haalScribeInstellingen,
  haalSegmentRijen,
  haalSessieRij,
  haalStaatRij,
  notitieVanRij,
  type ScribeNotitieRij,
  scribeFoutAntwoord,
  scribeRpc,
  segmentVanRij,
  staatVanRij,
} from "@/lib/careon-scribe/scribe.server";
import { isConsultType } from "@/lib/careon-scribe/types";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireCareonSession } from "@/lib/supabase/session.server";

// Concept-verslag genereren (handoff 20 §5.3).
//
// Voorwaarden (S8/S10): het consult is afgerond, de staat heeft het transcript
// ingehaald en is niet verouderd. Beoordelingssecties (★) worden hier NOOIT
// machinaal gevuld — genereerVerslag() zet daar hoogstens de door de
// behandelaar zelf uitgesproken overwegingen neer.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ sessieId: string }> }) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;
  const { sessieId } = await context.params;

  const quota = await eisScribeQuota(session);
  if (quota) return quota;

  let body: unknown = {};
  try {
    body = await readJsonBodyLimited<unknown>(request, SCRIBE_BODY_LIMIETEN.standaard);
  } catch (error) {
    if (error instanceof RequestPayloadTooLargeError) {
      return NextResponse.json({ error: "Payload te groot." }, { status: 413 });
    }
    // Een lege body is geldig: dan geldt het consulttype als verslagformaat.
    if (!(error instanceof InvalidJsonBodyError)) {
      console.error("Scribe body read failed", { route: "notitie" });
      return NextResponse.json({ error: "Ongeldige JSON." }, { status: 400 });
    }
  }
  const invoer = (body ?? {}) as NotitieGenereerBody;

  try {
    const sessieRij = await haalSessieRij(session, sessieId);
    if (!sessieRij) return NextResponse.json({ error: "Dit consult bestaat niet (meer)." }, { status: 404 });
    if (sessieRij.behandelaar_id !== session.userId) {
      return NextResponse.json({ error: "Alleen de eigen behandelaar stelt dit verslag op." }, { status: 403 });
    }
    if (sessieRij.status !== "afgerond") {
      return NextResponse.json({ error: "Rond het consult eerst af; daarna stelt u het verslag op." }, { status: 409 });
    }

    const staatRij = await haalStaatRij(session, sessieId);
    if (!staatRij) {
      return NextResponse.json({ error: "Er is nog geen analyse voor dit consult." }, { status: 409 });
    }
    const staatEnvelop = staatVanRij(staatRij);
    if (staatEnvelop.verouderd || staatEnvelop.laatsteSegment < sessieRij.segment_teller) {
      return NextResponse.json(
        { error: "De analyse loopt achter op het transcript. Analyseer eerst opnieuw." },
        { status: 409 },
      );
    }

    const formaat = isConsultType(invoer.formaat) ? invoer.formaat : sessieRij.consult_type;
    const segmenten = (await haalSegmentRijen(session, sessieId)).map(segmentVanRij);
    // N19 — de organisatie beslist of het verslag door een externe verwerker mag
    // worden opgesteld. Staat `aiAnalyseAan` uit, dan levert genereerVerslag()
    // de deterministische opzet en verlaat er geen citaat het platform.
    const { instellingen } = await haalScribeInstellingen(session);
    const uitkomst = await genereerVerslag({
      staat: staatEnvelop.staat,
      citaten: citaatSegmenten(staatEnvelop.staat, segmenten),
      gatSegmenten: gatSegmentenVan(segmenten),
      consultType: formaat,
      taal: sessieRij.taal,
      actorHash: authenticatedActorHash(session.userId),
      orgId: sessieRij.org_id,
      userId: session.userId,
      aiToegestaan: instellingen.aiAnalyseAan,
      signal: request.signal,
    });

    const rij = await scribeRpc<ScribeNotitieRij>(session, "careon_scribe_notitie_maken", {
      p_sessie: sessieId,
      p_staat_versie: staatEnvelop.versie,
      p_formaat: formaat,
      p_secties: uitkomst.secties,
      p_bron: uitkomst.bron,
      p_model: uitkomst.model,
    });

    return NextResponse.json(
      { configured: true, notitie: notitieVanRij(rij), bron: uitkomst.bron },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error, "Verslag kon niet worden opgesteld.");
  }
}
