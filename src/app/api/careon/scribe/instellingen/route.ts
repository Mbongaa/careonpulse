import { NextResponse } from "next/server";

import { ASSISTANT_MODEL, authenticatedActorHash } from "@/lib/careon-assistant/runtime.server";
import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { SCRIBE_PROMPT_VERSION, scribeAgentLive } from "@/lib/careon-scribe/agent.server";
import { type InstellingenOpslaanBody, SCRIBE_BODY_LIMIETEN } from "@/lib/careon-scribe/api-contract";
import {
  eisScribeMachtiging,
  haalScribeInstellingen,
  SCRIBE_INSTELLINGEN_TABEL,
  scribeFoutAntwoord,
  scribeGet,
  scribePost,
} from "@/lib/careon-scribe/scribe.server";
import { scribeLive, transcriptieModel, transcriptieProvider } from "@/lib/careon-scribe/transcriptie.server";
import { activatieVoorwaardenOntbrekend, isConsenttekst, isScribeInstellingen } from "@/lib/careon-scribe/types";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireCareonSession, requireOrgAdmin } from "@/lib/supabase/session.server";

// Scribe-instellingen per organisatie (handoff 20 §5.3/§7.5).
//
// Append-only snapshot (patroon hr/facturatie): elke opslag is een nieuwe
// revisie met conflictdetectie op `baseRevision` en idempotentie op
// `operationId`. De revisie is óók het bewijsanker van de toestemmingstekst
// (S13): een consult bevriest de revisie die de cliënt te horen kreeg.
//
// GET vraagt geen BEHEERROL: elke gemachtigde behandelaar leest de
// toestemmingstekst, het standaardformaat en de aan/uit-stand — anders kan hij
// geen consult starten. De machtigingscontrole van §2.3 geldt wel, net als op
// elke andere scribe-route; de RLS-select op careon_scribe_instellingen is
// daaronder bewust rolblind (elk organisatielid). PUT is beheer.

export const runtime = "nodejs";

const UUID_PATROON = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Read-only providerbeeld — nooit sleutels, alleen namen en schakelaars. */
function providerStatus() {
  return {
    live: scribeLive(),
    transcriptieProvider: transcriptieProvider(),
    transcriptieModel: transcriptieModel(),
    notitieModel: scribeAgentLive() ? ASSISTANT_MODEL : null,
    promptVersie: SCRIBE_PROMPT_VERSION,
    analyseLive: scribeAgentLive(),
  };
}

function isOpslaanBody(value: unknown): value is InstellingenOpslaanBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    isScribeInstellingen(body.state) &&
    Number.isInteger(body.baseRevision) &&
    (body.baseRevision as number) >= 0 &&
    typeof body.operationId === "string" &&
    UUID_PATROON.test(body.operationId)
  );
}

export async function GET() {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;

  try {
    const { instellingen, revision } = await haalScribeInstellingen(auth.session);
    return NextResponse.json(
      { configured: true, instellingen, revision, providerStatus: providerStatus() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error);
  }
}

export async function PUT(request: Request) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;

  let body: unknown;
  try {
    body = await readJsonBodyLimited<unknown>(request, SCRIBE_BODY_LIMIETEN.instellingen);
  } catch (error) {
    const status = error instanceof RequestPayloadTooLargeError ? 413 : 400;
    if (!(error instanceof RequestPayloadTooLargeError) && !(error instanceof InvalidJsonBodyError)) {
      console.error("Scribe body read failed", { route: "instellingen" });
    }
    return NextResponse.json({ error: status === 413 ? "Payload te groot." : "Ongeldige JSON." }, { status });
  }
  if (!isOpslaanBody(body)) {
    return NextResponse.json({ error: "Ongeldige of onvolledige instellingen." }, { status: 400 });
  }
  // N21 — de go-live-checklist staat in het product, niet alleen in een
  // document: `ingeschakeld: true` mag pas als de DPIA-datum, de eigenaar, de
  // verwerkersovereenkomst en de goedkeuringsdatum van de toestemmingstekst
  // zijn vastgelegd. Het SQL-predicaat app.scribe_ingeschakeld toetst dezelfde
  // voorwaarden, zodat de poort ook onder PostgREST dichtblijft.
  const ontbrekend = body.state.ingeschakeld ? activatieVoorwaardenOntbrekend(body.state) : [];
  if (ontbrekend.length > 0) {
    return NextResponse.json(
      {
        error: `Leg eerst de activatievoorwaarden vast: ${ontbrekend.join("; ")}.`,
        ontbrekend,
      },
      { status: 400 },
    );
  }
  // N10 — de vastgelegde toestemmingstekst moet de vier verplichte elementen
  // dragen; de organisatie kiest de formulering, niet welke elementen mogen
  // ontbreken.
  const consent = isConsenttekst(body.state.consenttekst);
  if (!consent.ok) {
    return NextResponse.json(
      {
        error: `De toestemmingstekst mist: ${consent.ontbrekend.join("; ")}.`,
        ontbrekend: consent.ontbrekend,
      },
      { status: 400 },
    );
  }

  try {
    // Idempotentie: dezelfde operatie nogmaals → bestaande revisie terug.
    const opParams = new URLSearchParams({
      select: "revision",
      org_id: `eq.${session.orgId}`,
      operation_id: `eq.${body.operationId}`,
      limit: "1",
    });
    const bestaande = await scribeGet<{ revision: number }[]>(session, SCRIBE_INSTELLINGEN_TABEL, opParams);
    if (Array.isArray(bestaande) && bestaande.length > 0) {
      return NextResponse.json({ configured: true, revision: bestaande[0].revision, idempotent: true });
    }

    const { instellingen: huidig, revision: huidigeRevisie } = await haalScribeInstellingen(session);
    if (body.baseRevision !== huidigeRevisie) {
      return NextResponse.json(
        { error: "De centrale instellingen zijn intussen gewijzigd.", revision: huidigeRevisie, instellingen: huidig },
        { status: 409 },
      );
    }

    const revision = huidigeRevisie + 1;
    await scribePost(
      session,
      SCRIBE_INSTELLINGEN_TABEL,
      {
        org_id: session.orgId,
        state: body.state,
        revision,
        base_revision: body.baseRevision,
        operation_id: body.operationId,
        change_source: "manual",
        // Metadata-only samenvatting: schakelaars en termijnen, nooit de tekst.
        change_summary: {
          ingeschakeld: body.state.ingeschakeld,
          standaardFormaat: body.state.standaardFormaat,
          transcriptRetentieDagen: body.state.transcriptRetentieDagen,
          notitieRetentieDagen: body.state.notitieRetentieDagen,
          transcriptWissenBijOvername: body.state.transcriptWissenBijOvername,
          aiAnalyseAan: body.state.aiAnalyseAan,
          transcriptieAan: body.state.transcriptieAan,
          consenttekstGewijzigd: huidig.consenttekst !== body.state.consenttekst,
        },
        actor_hash: authenticatedActorHash(session.userId),
      },
      "return=minimal",
    );

    scheduleAuditEvent({
      action: "scribe.instellingen.gewijzigd",
      resource: SCRIBE_INSTELLINGEN_TABEL,
      orgId: session.orgId,
      userId: session.userId,
      detail: {
        revision,
        ingeschakeld: body.state.ingeschakeld,
        consenttekstGewijzigd: huidig.consenttekst !== body.state.consenttekst,
        // N19 — welke externe verwerking de organisatie aan heeft staan is
        // precies wat een FG achteraf wil kunnen zien.
        aiAnalyseAan: body.state.aiAnalyseAan,
        transcriptieAan: body.state.transcriptieAan,
        dpiaVastgesteld: body.state.dpiaVastgesteldOp !== null,
        verwerkersovereenkomstBevestigd: body.state.verwerkersovereenkomstBevestigd,
      },
    });

    return NextResponse.json({ configured: true, revision }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return scribeFoutAntwoord(error, "Instellingen konden niet worden opgeslagen.");
  }
}
