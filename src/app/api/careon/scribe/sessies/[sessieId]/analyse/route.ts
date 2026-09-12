import { NextResponse } from "next/server";

import {
  eisScribeMachtiging,
  eisScribeQuota,
  haalSessieRij,
  scribeFoutAntwoord,
  voerScribeAnalyseUit,
} from "@/lib/careon-scribe/scribe.server";
import { requireCareonSession } from "@/lib/supabase/session.server";

// Eén analyseronde over de nog niet verwerkte segmenten (handoff 20 §5.3).
//
// De ronde zelf staat in voerScribeAnalyseUit() (scribe.server.ts), omdat het
// afronden van een consult haar herhaalt tot de staat het transcript heeft
// ingehaald. Zonder live regime levert dezelfde ronde de deterministische
// uitkomst met bron "deterministisch" — de werkruimte toont dat als label.

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

  try {
    const sessieRij = await haalSessieRij(session, sessieId);
    if (!sessieRij) return NextResponse.json({ error: "Dit consult bestaat niet (meer)." }, { status: 404 });
    if (sessieRij.behandelaar_id !== session.userId) {
      return NextResponse.json({ error: "Alleen de eigen behandelaar analyseert dit consult." }, { status: 403 });
    }

    if (sessieRij.status !== "actief" && sessieRij.status !== "afgerond") {
      return NextResponse.json({ error: "Dit consult ligt vast; de analyse kan niet meer wijzigen." }, { status: 409 });
    }
    const ronde = await voerScribeAnalyseUit(session, sessieRij, request.signal);
    return NextResponse.json(
      {
        configured: true,
        staat: ronde.staat,
        bron: ronde.bron,
        versie: ronde.versie,
        laatsteSegment: ronde.laatsteSegment,
        verouderd: false,
        epdLijstBeoordeeld: ronde.epdLijstBeoordeeld,
        sprekers: ronde.sprekers,
        correcties: ronde.correcties,
        taken: ronde.taken,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error, "De analyse kon niet worden uitgevoerd.");
  }
}
