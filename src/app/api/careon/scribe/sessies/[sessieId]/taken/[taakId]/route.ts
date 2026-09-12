import { NextResponse } from "next/server";

import { SCRIBE_BODY_LIMIETEN, type TaakPatchBody } from "@/lib/careon-scribe/api-contract";
import {
  eisScribeMachtiging,
  type ScribeTaakRij,
  scribeFoutAntwoord,
  scribeRpc,
  taakVanRij,
} from "@/lib/careon-scribe/scribe.server";
import { isTaakStatus } from "@/lib/careon-scribe/types";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireCareonSession } from "@/lib/supabase/session.server";

// Vervolgactie goedkeuren, afwijzen of afronden (handoff 20 §5.3).
//
// Taken zijn voorstellen: de behandelaar beslist. Er is bewust geen koppeling
// naar agenda of YAAZ (fase 2, §10) — een goedgekeurde taak is documentatie,
// geen automatisch uitgevoerde opdracht.

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ sessieId: string; taakId: string }> }) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;
  const { sessieId, taakId } = await context.params;

  let body: unknown;
  try {
    body = await readJsonBodyLimited<unknown>(request, SCRIBE_BODY_LIMIETEN.standaard);
  } catch (error) {
    const status = error instanceof RequestPayloadTooLargeError ? 413 : 400;
    if (!(error instanceof RequestPayloadTooLargeError) && !(error instanceof InvalidJsonBodyError)) {
      console.error("Scribe body read failed", { route: "taken/[taakId]" });
    }
    return NextResponse.json({ error: status === 413 ? "Payload te groot." : "Ongeldige JSON." }, { status });
  }
  const invoer = (body ?? {}) as TaakPatchBody;
  if (!isTaakStatus(invoer.status)) {
    return NextResponse.json({ error: "Onbekende taakstatus." }, { status: 400 });
  }

  try {
    const bijgewerkt = await scribeRpc<ScribeTaakRij>(session, "careon_scribe_taak_bijwerken", {
      p_sessie: sessieId,
      p_taak: taakId,
      p_status: invoer.status,
    });
    return NextResponse.json(
      { configured: true, taak: taakVanRij(bijgewerkt) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error, "Vervolgactie kon niet worden bijgewerkt.");
  }
}
