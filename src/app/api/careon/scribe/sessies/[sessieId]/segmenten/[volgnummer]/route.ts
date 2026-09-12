import { NextResponse } from "next/server";

import { SCRIBE_BODY_LIMIETEN, type SegmentPatchBody } from "@/lib/careon-scribe/api-contract";
import {
  eisScribeMachtiging,
  haalSessieRij,
  type ScribeSegmentRij,
  scribeFoutAntwoord,
  scribeRpc,
  segmentVanRij,
} from "@/lib/careon-scribe/scribe.server";
import { isSpreker, SCRIBE_LIMITS } from "@/lib/careon-scribe/types";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireCareonSession } from "@/lib/supabase/session.server";

// Spreker corrigeren of de herkende tekst verbeteren (handoff 20 §5.3, S8/S9).
//
// Twee regels:
//   * De correctie van de behandelaar krijgt `correctie_bron: "behandelaar"`
//     en wordt daarna nooit meer door een AI-correctie overschreven (trigger
//     careon_scribe_segment_bevries bewaakt dat ook in de database).
//   * Raakt de correctie een AL GEANALYSEERD segment, dan is de staat
//     verouderd: `laatste_segment` schuift terug en de werkruimte dwingt een
//     heranalyse af vóór het verslag.

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ sessieId: string; volgnummer: string }> }) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;
  const { sessieId, volgnummer: volgnummerRuw } = await context.params;

  const volgnummer = Number(volgnummerRuw);
  if (!Number.isInteger(volgnummer) || volgnummer < 1 || volgnummer > SCRIBE_LIMITS.segmentenPerSessie) {
    return NextResponse.json({ error: "Onbekend segment." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await readJsonBodyLimited<unknown>(request, SCRIBE_BODY_LIMIETEN.segmenten);
  } catch (error) {
    const status = error instanceof RequestPayloadTooLargeError ? 413 : 400;
    if (!(error instanceof RequestPayloadTooLargeError) && !(error instanceof InvalidJsonBodyError)) {
      console.error("Scribe body read failed", { route: "segmenten/[volgnummer]" });
    }
    return NextResponse.json({ error: status === 413 ? "Payload te groot." : "Ongeldige JSON." }, { status });
  }

  const invoer = (body ?? {}) as SegmentPatchBody;
  const wijziging: Record<string, unknown> = {};
  if (invoer.spreker !== undefined) {
    if (!isSpreker(invoer.spreker)) return NextResponse.json({ error: "Onbekende spreker." }, { status: 400 });
    wijziging.spreker = invoer.spreker;
  }
  if (invoer.tekstGecorrigeerd !== undefined) {
    if (invoer.tekstGecorrigeerd === null) {
      // Herstel origineel (S9): de correctie én haar herkomst verdwijnen.
      wijziging.tekst_gecorrigeerd = null;
      wijziging.correctie_bron = null;
    } else if (
      typeof invoer.tekstGecorrigeerd === "string" &&
      invoer.tekstGecorrigeerd.trim().length > 0 &&
      invoer.tekstGecorrigeerd.length <= SCRIBE_LIMITS.segmentTekst
    ) {
      wijziging.tekst_gecorrigeerd = invoer.tekstGecorrigeerd;
      wijziging.correctie_bron = "behandelaar";
    } else {
      return NextResponse.json({ error: "Ongeldige correctie." }, { status: 400 });
    }
  }
  if (Object.keys(wijziging).length === 0) {
    return NextResponse.json({ error: "Geef een spreker of een correctie mee." }, { status: 400 });
  }

  try {
    const sessieRij = await haalSessieRij(session, sessieId);
    if (!sessieRij) return NextResponse.json({ error: "Dit consult bestaat niet (meer)." }, { status: 404 });
    if (sessieRij.behandelaar_id !== session.userId) {
      return NextResponse.json({ error: "Alleen de eigen behandelaar corrigeert dit transcript." }, { status: 403 });
    }

    const resultaat = await scribeRpc<{
      segment: ScribeSegmentRij;
      verouderd: boolean;
      laatsteSegment: number;
    }>(session, "careon_scribe_segment_corrigeren", {
      p_sessie: sessieId,
      p_volgnummer: volgnummer,
      p_patch: wijziging,
    });
    return NextResponse.json(
      {
        configured: true,
        segment: segmentVanRij(resultaat.segment),
        verouderd: resultaat.verouderd,
        laatsteSegment: resultaat.laatsteSegment,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error, "Segment kon niet worden bijgewerkt.");
  }
}
