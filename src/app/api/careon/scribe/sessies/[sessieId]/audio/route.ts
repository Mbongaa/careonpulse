import { NextResponse } from "next/server";

import {
  SCRIBE_AUDIO_MIMES,
  SCRIBE_FRAGMENT_DUUR_HEADER,
  SCRIBE_FRAGMENT_GRENZEN,
  SCRIBE_FRAGMENT_ID_HEADER,
  SCRIBE_FRAGMENT_OFFSET_HEADER,
  SCRIBE_FRAGMENT_OVERLAP_HEADER,
  SCRIBE_MAX_AUDIO_BYTES,
} from "@/lib/careon-scribe/api-contract";
import { staartVan, verwijderOverlap } from "@/lib/careon-scribe/overlap";
import {
  eisScribeMachtiging,
  eisScribeQuota,
  haalScribeInstellingen,
  haalSessieRij,
  SCRIBE_SEGMENTEN_TABEL,
  type ScribeSegmentRij,
  SEGMENT_SELECT,
  scribeFoutAntwoord,
  scribeGet,
  scribeRpc,
  segmentVanRij,
} from "@/lib/careon-scribe/scribe.server";
import {
  plaatsTranscriptieSegmenten,
  transcribeer,
  transcriptieModel,
  transcriptieProvider,
} from "@/lib/careon-scribe/transcriptie.server";
import { SCRIBE_LIMITS } from "@/lib/careon-scribe/types";
import { requireCareonSession } from "@/lib/supabase/session.server";

// Eén audiofragment → segmenten (handoff 20 §5.3/§8).
//
// CAREON BEWAART GEEN AUDIO (S5). De bytes komen binnen, gaan naar de
// transcriptieprovider en worden losgelaten: geen Storage, geen tijdelijk
// bestand, geen bytes in de database en nooit audio of herkende tekst in een
// logregel.
//
// Vaste volgorde (§8): sessiegate → 409/503 → quota (gebruiker + organisatie)
// → pas dán het lichaam lezen. Zo kost een geweigerde aanvraag nooit bandbreedte
// of geheugen, en kan een gecompromitteerd account het budget niet leegtrekken
// door grote fragmenten te blijven sturen.
//
// De 503-poort heeft twee sloten (N19): het PLATFORM moet een provider hebben
// (CAREON_SCRIBE_LIVE + sleutel/Vertex-configuratie) én de ORGANISATIE moet
// externe transcriptie hebben aangezet. Een organisatie waarvan de DPIA alleen
// de deterministische laag dekt, werkt met handmatige invoer — er verlaat dan
// geen fragment het platform.

export const runtime = "nodejs";
export const maxDuration = 60;

function klem(waarde: string | null, grens: { min: number; max: number }, standaard: number): number {
  const getal = Number(waarde);
  if (!Number.isFinite(getal)) return standaard;
  return Math.min(grens.max, Math.max(grens.min, Math.round(getal)));
}

const UUID_PATROON = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Content-Type ná het strippen van parameters (`; codecs=…`). */
function kaleMime(waarde: string | null): string {
  return (waarde ?? "").split(";")[0].trim().toLowerCase();
}

function mmss(ms: number): string {
  const totaal = Math.max(0, Math.round(ms / 1_000));
  const minuten = Math.floor(totaal / 60);
  const seconden = totaal % 60;
  return `${String(minuten).padStart(2, "0")}:${String(seconden).padStart(2, "0")}`;
}

/** Gelimiteerd binair lezen: overschrijding breekt de stroom direct af. */
async function leesAudioBegrensd(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const delen: Uint8Array[] = [];
  let omvang = 0;
  let deel = await reader.read();
  while (!deel.done) {
    if (deel.value) {
      omvang += deel.value.byteLength;
      if (omvang > maxBytes) {
        await reader.cancel();
        return null;
      }
      delen.push(deel.value);
    }
    deel = await reader.read();
  }
  const bytes = new Uint8Array(omvang);
  let positie = 0;
  for (const stuk of delen) {
    bytes.set(stuk, positie);
    positie += stuk.byteLength;
  }
  return bytes;
}

export async function POST(request: Request, context: { params: Promise<{ sessieId: string }> }) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;
  const { sessieId } = await context.params;

  const fragmentId = (request.headers.get(SCRIBE_FRAGMENT_ID_HEADER) ?? "").trim();
  if (!UUID_PATROON.test(fragmentId)) {
    return NextResponse.json({ error: "Ongeldig fragmentkenmerk." }, { status: 400 });
  }
  const offsetMs = klem(request.headers.get(SCRIBE_FRAGMENT_OFFSET_HEADER), SCRIBE_FRAGMENT_GRENZEN.offsetMs, 0);
  const duurMs = klem(request.headers.get(SCRIBE_FRAGMENT_DUUR_HEADER), SCRIBE_FRAGMENT_GRENZEN.duurMs, 8_000);
  const overlapMs = klem(request.headers.get(SCRIBE_FRAGMENT_OVERLAP_HEADER), SCRIBE_FRAGMENT_GRENZEN.overlapMs, 0);

  const mime = kaleMime(request.headers.get("content-type"));
  if (!(SCRIBE_AUDIO_MIMES as readonly string[]).includes(mime)) {
    return NextResponse.json({ error: "Dit audioformaat wordt niet ondersteund." }, { status: 415 });
  }
  const gemeldeOmvang = Number(request.headers.get("content-length"));
  if (Number.isFinite(gemeldeOmvang) && gemeldeOmvang > SCRIBE_MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Fragment te groot." }, { status: 413 });
  }

  let sessieRij: Awaited<ReturnType<typeof haalSessieRij>>;
  try {
    sessieRij = await haalSessieRij(session, sessieId);
  } catch (error) {
    return scribeFoutAntwoord(error);
  }
  if (!sessieRij) return NextResponse.json({ error: "Dit consult bestaat niet (meer)." }, { status: 404 });
  if (sessieRij.behandelaar_id !== session.userId) {
    return NextResponse.json({ error: "Alleen de eigen behandelaar voert dit consult." }, { status: 403 });
  }
  // Het afrondingsvenster zelf bewaakt de RPC; hier valt alles af wat evident
  // geen fragmenten meer aanneemt.
  if (sessieRij.status !== "actief" && sessieRij.status !== "afgerond") {
    return NextResponse.json({ error: "Dit consult neemt geen nieuwe fragmenten meer aan." }, { status: 409 });
  }

  let instellingen: Awaited<ReturnType<typeof haalScribeInstellingen>>["instellingen"];
  try {
    ({ instellingen } = await haalScribeInstellingen(session));
  } catch (error) {
    return scribeFoutAntwoord(error);
  }
  if (!instellingen.transcriptieAan) {
    return NextResponse.json(
      {
        error:
          "Automatische transcriptie staat uit voor uw organisatie. Uw beheerder zet haar aan bij " +
          "Instellingen → Externe verwerking; typ het gesprek zolang handmatig in.",
        code: "transcriptie_uitgeschakeld",
        provider: null,
      },
      { status: 503 },
    );
  }

  const provider = transcriptieProvider();
  if (!provider) {
    return NextResponse.json(
      {
        error: "Transcriptie is nog niet geactiveerd voor dit platform.",
        code: "transcriptie_uitgeschakeld",
        provider: null,
      },
      { status: 503 },
    );
  }

  const quota = await eisScribeQuota(session);
  if (quota) return quota;

  const audio = await leesAudioBegrensd(request, SCRIBE_MAX_AUDIO_BYTES);
  if (!audio) return NextResponse.json({ error: "Fragment te groot." }, { status: 413 });
  if (audio.byteLength === 0) return NextResponse.json({ error: "Leeg fragment." }, { status: 400 });

  try {
    // Staart van het transcript als herkenningscontext én als vergelijkings-
    // materiaal voor de overlapontdubbeling op de fragmentgrens.
    const staartParams = new URLSearchParams({
      select: SEGMENT_SELECT,
      sessie_id: `eq.${sessieId}`,
      org_id: `eq.${session.orgId}`,
      order: "volgnummer.desc",
      limit: "3",
    });
    const staartRijen = await scribeGet<ScribeSegmentRij[]>(session, SCRIBE_SEGMENTEN_TABEL, staartParams);
    const vorige = (Array.isArray(staartRijen) ? staartRijen : []).map(segmentVanRij).reverse();
    const contextTekst = vorige.map((segment) => segment.tekstGecorrigeerd ?? segment.tekst).join(" ");
    const vorigeStaart = staartVan(contextTekst);

    let resultaat: Awaited<ReturnType<typeof transcribeer>> | null = null;
    try {
      resultaat = await transcribeer({ audio, mime, taal: sessieRij.taal, contextTekst }, request.signal);
    } catch (error) {
      // Alleen de providernaam en het foutbericht van de adapter (statuscode);
      // nooit het fragment of de herkende tekst.
      console.error("Scribe transcriptie mislukt", {
        provider,
        melding: error instanceof Error ? error.message : "onbekend",
      });
    }

    const segmenten = (resultaat?.segmenten ?? [])
      .map((segment, index) => ({
        ...segment,
        tekst: index === 0 ? verwijderOverlap(vorigeStaart, segment.tekst) : segment.tekst,
      }))
      .filter((segment) => segment.tekst.trim().length > 0);

    if (!resultaat || segmenten.length === 0) {
      if (resultaat && segmenten.length === 0) {
        // Stilte of volledige overlap: geen segment, geen gat.
        return NextResponse.json(
          {
            configured: true,
            segmenten: [],
            provider,
            model: resultaat.model,
            ontbrekend: false,
            segmentTeller: sessieRij.segment_teller,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      // Providerfout ná de retries: leg een plaatshouder vast zodat het gat
      // zichtbaar blijft in transcript, verslag en teller (§4.5).
      const plaatshouder = await scribeRpc<ScribeSegmentRij[]>(session, "careon_scribe_voeg_segmenten_toe", {
        p_sessie: sessieId,
        p_fragment_id: fragmentId,
        p_segmenten: [
          {
            spreker: "onbekend",
            tekst: `[fragment niet getranscribeerd — ${mmss(offsetMs)}, transcriptiedienst niet bereikbaar]`,
            beginMs: offsetMs,
            eindMs: offsetMs + duurMs,
            bron: "systeem",
          },
        ],
        p_duur_ms: duurMs,
        p_ontbrekend: true,
      });
      const rijen = Array.isArray(plaatshouder) ? plaatshouder.map(segmentVanRij) : [];
      return NextResponse.json(
        {
          configured: true,
          segmenten: rijen,
          provider,
          model: transcriptieModel(),
          ontbrekend: true,
          segmentTeller: sessieRij.segment_teller + rijen.length,
          error: "Dit fragment kon niet worden getranscribeerd.",
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const ingevoegd = await scribeRpc<ScribeSegmentRij[]>(session, "careon_scribe_voeg_segmenten_toe", {
      p_sessie: sessieId,
      p_fragment_id: fragmentId,
      p_segmenten: plaatsTranscriptieSegmenten(segmenten, offsetMs, duurMs, overlapMs).map((segment) => ({
        spreker: segment.spreker,
        tekst: segment.tekst.slice(0, SCRIBE_LIMITS.segmentTekst),
        beginMs: segment.beginMs,
        eindMs: segment.eindMs,
        bron: "live",
      })),
      p_duur_ms: duurMs,
      p_ontbrekend: false,
    });
    const rijen = Array.isArray(ingevoegd) ? ingevoegd.map(segmentVanRij) : [];

    // De teller is DB-werk (nooit lezen-en-schrijven in applicatiecode); na de
    // RPC vragen we hem één keer op zodat de client niet hoeft te pollen.
    const versSessie = await haalSessieRij(session, sessieId);
    return NextResponse.json(
      {
        configured: true,
        segmenten: rijen,
        provider,
        model: resultaat.model,
        ontbrekend: false,
        segmentTeller: versSessie?.segment_teller ?? sessieRij.segment_teller + rijen.length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error, "Fragment kon niet worden verwerkt.");
  }
}
