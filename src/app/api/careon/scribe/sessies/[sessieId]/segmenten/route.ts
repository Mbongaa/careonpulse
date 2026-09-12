import { NextResponse } from "next/server";

import { SCRIBE_BODY_LIMIETEN, type SegmentBody } from "@/lib/careon-scribe/api-contract";
import {
  eisScribeMachtiging,
  eisScribeQuota,
  haalSessieRij,
  type ScribeSegmentRij,
  scribeFoutAntwoord,
  scribeRpc,
  segmentVanRij,
} from "@/lib/careon-scribe/scribe.server";
import { isSpreker, SCRIBE_LIMITS } from "@/lib/careon-scribe/types";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireCareonSession } from "@/lib/supabase/session.server";

// Handmatige transcriptregel of gatsegment (handoff 20 §5.3).
//
// `handmatig` is wat de behandelaar zelf intypt wanneer de transcriptie uit
// staat of hapert; `systeem` is het gatsegment dat de opnamehook plaatst
// wanneer de wachtrij volloopt — dat gat blijft zichtbaar in transcript,
// verslag en teller in plaats van stil te verdwijnen.

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ sessieId: string }> }) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;
  const { sessieId } = await context.params;

  const quota = await eisScribeQuota(session);
  if (quota) return quota;

  let body: unknown;
  try {
    body = await readJsonBodyLimited<unknown>(request, SCRIBE_BODY_LIMIETEN.segmenten);
  } catch (error) {
    const status = error instanceof RequestPayloadTooLargeError ? 413 : 400;
    if (!(error instanceof RequestPayloadTooLargeError) && !(error instanceof InvalidJsonBodyError)) {
      console.error("Scribe body read failed", { route: "segmenten" });
    }
    return NextResponse.json({ error: status === 413 ? "Payload te groot." : "Ongeldige JSON." }, { status });
  }

  const invoer = (body ?? {}) as SegmentBody;
  const tekst = typeof invoer.tekst === "string" ? invoer.tekst.trim() : "";
  if (tekst.length === 0 || tekst.length > SCRIBE_LIMITS.segmentTekst) {
    return NextResponse.json({ error: "Voer een tekstregel in (maximaal 4.000 tekens)." }, { status: 400 });
  }
  const fragmentId = invoer.fragmentId ?? null;
  if (
    fragmentId !== null &&
    (typeof fragmentId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fragmentId))
  ) {
    return NextResponse.json({ error: "Ongeldig fragmentkenmerk." }, { status: 400 });
  }
  const bron = invoer.bron === "systeem" ? "systeem" : "handmatig";
  const spreker = isSpreker(invoer.spreker) ? invoer.spreker : "onbekend";
  const duurMs =
    typeof invoer.duurMs === "number" && Number.isFinite(invoer.duurMs)
      ? Math.min(3_600_000, Math.max(0, Math.round(invoer.duurMs)))
      : 0;

  try {
    const sessieRij = await haalSessieRij(session, sessieId);
    if (!sessieRij) return NextResponse.json({ error: "Dit consult bestaat niet (meer)." }, { status: 404 });
    if (sessieRij.behandelaar_id !== session.userId) {
      return NextResponse.json({ error: "Alleen de eigen behandelaar voert dit consult." }, { status: 403 });
    }

    const ingevoegd = await scribeRpc<ScribeSegmentRij[]>(session, "careon_scribe_voeg_segmenten_toe", {
      p_sessie: sessieId,
      p_fragment_id: fragmentId,
      p_segmenten: [{ spreker, tekst, bron }],
      p_duur_ms: duurMs,
      p_ontbrekend: bron === "systeem",
    });
    const rijen = Array.isArray(ingevoegd) ? ingevoegd.map(segmentVanRij) : [];
    const versSessie = await haalSessieRij(session, sessieId);

    return NextResponse.json(
      {
        configured: true,
        segmenten: rijen,
        segmentTeller: versSessie?.segment_teller ?? sessieRij.segment_teller + rijen.length,
        ontbrekendeFragmenten: versSessie?.ontbrekende_fragmenten ?? sessieRij.ontbrekende_fragmenten,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error, "Regel kon niet worden toegevoegd.");
  }
}
