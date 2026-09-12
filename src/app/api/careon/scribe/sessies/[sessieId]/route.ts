import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import type { SessiePatchBody, SessieVerwijderBody } from "@/lib/careon-scribe/api-contract";
import {
  eisScribeMachtiging,
  eisScribeQuota,
  haalBeheerSessieRij,
  haalLaatsteNotitieRij,
  haalScribeInstellingen,
  haalSegmentRijen,
  haalSessieRij,
  haalStaatRij,
  haalTaakRijen,
  haalVrijgegevenSessieIds,
  leesRolVoor,
  notitieVanRij,
  SCRIBE_SESSIES_TABEL,
  SCRIBE_VRIJGAVEN_TABEL,
  type ScribeSessieRij,
  SESSIE_SELECT,
  scribeFoutAntwoord,
  scribeGet,
  scribePatch,
  scribeRpc,
  scribeServiceRpc,
  segmentVanRij,
  sessieMetadataVoorLijst,
  sessieVanRij,
  staatVanRij,
  taakVanRij,
  telGoedgekeurdeNotities,
  voerScribeAnalyseUit,
} from "@/lib/careon-scribe/scribe.server";
import {
  GEANNULEERD_GRONDEN,
  type GeannuleerdGrond,
  isPatientReferentie,
  isSessieStatus,
  PATIENT_REFERENTIE_MELDING,
} from "@/lib/careon-scribe/types";
import { magScribeBeheren } from "@/lib/careon-scribe-rol";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireCareonSession, requireOrgAdmin } from "@/lib/supabase/session.server";

// Eén consult: lezen, statusovergang, referentiecorrectie en verwijderen
// (handoff 20 §5.3).
//
// Leesrollen (S12): de eigen behandelaar ziet alles; een vrijgave-ontvanger
// uitsluitend de sessie plus het GOEDGEKEURDE verslag (nooit het transcript);
// een org_admin uitsluitend metadata zonder dossierreferentie en consulttype —
// en die metadata komt sinds C3/C10 uit een service-role-lezing met een vaste
// kolomlijst, niet meer uit zijn eigen JWT: RLS werkt op rijen, niet op
// kolommen, dus een policytak voor de beheerder gaf hem beide velden alsnog.

export const runtime = "nodejs";
// Dit is de zwaarste route van de module: het afronden haalt eerst de analyse
// in. De lus hieronder bewaakt zelf de klok (ANALYSE_BUDGET_MS) en stopt ruim
// vóór deze grens, zodat het consult nooit half geanalyseerd in `actief` blijft
// hangen omdat de functie werd afgekapt (C7).
export const maxDuration = 60;

const MAX_BODY_BYTES = 8 * 1_024;
/** Het afronden haalt de analyse in; meer dan zes rondes is een vastloper. */
const MAX_ANALYSE_RONDES = 6;
/**
 * Wandkloklimiet voor de inhaalrondes (C7). Ruim binnen maxDuration, zodat de
 * statusovergang zelf altijd nog past: het afronden is belangrijker dan de
 * laatste analyseronde, en een niet-uitgevoerde RPC kost de behandelaar zijn
 * hele werkkopie.
 */
const ANALYSE_BUDGET_MS = 40_000;

const AUDIT_PER_STATUS: Record<string, string> = {
  afgerond: "scribe.sessie.afgerond",
  goedgekeurd: "scribe.sessie.goedgekeurd",
  overgenomen: "scribe.sessie.overgenomen",
  geannuleerd: "scribe.sessie.geannuleerd",
};

/** Grond uit de vaste enum (N11) — nooit een vrije toelichting met inhoud. */
function isGrond(waarde: unknown): waarde is GeannuleerdGrond {
  return typeof waarde === "string" && (GEANNULEERD_GRONDEN as readonly string[]).includes(waarde);
}

async function leesBody(request: Request): Promise<{ body: unknown } | { denied: NextResponse }> {
  try {
    return { body: await readJsonBodyLimited<unknown>(request, MAX_BODY_BYTES) };
  } catch (error) {
    if (error instanceof RequestPayloadTooLargeError) {
      return { denied: NextResponse.json({ error: "Payload te groot." }, { status: 413 }) };
    }
    if (error instanceof InvalidJsonBodyError) {
      // Een DELETE zonder body is geldig: dat is de niet-geforceerde variant.
      return { body: {} };
    }
    console.error("Scribe body read failed", { route: "sessies/[sessieId]" });
    return { denied: NextResponse.json({ error: "Ongeldige JSON." }, { status: 400 }) };
  }
}

export async function GET(_request: Request, context: { params: Promise<{ sessieId: string }> }) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;
  const { sessieId } = await context.params;

  try {
    const rij = await haalSessieRij(session, sessieId);
    if (!rij) {
      // Geen eigen en geen vrijgegeven consult. Een beheerder mag de METADATA
      // alsnog zien; die komt via de service-role met SESSIE_METADATA_SELECT,
      // dus zonder dossierreferentie en consulttype (C3/C10, S12/V3).
      if (!magScribeBeheren(session)) {
        return NextResponse.json({ error: "Dit consult bestaat niet (meer)." }, { status: 404 });
      }
      const metadata = await haalBeheerSessieRij(session.orgId as string, sessieId);
      if (!metadata) return NextResponse.json({ error: "Dit consult bestaat niet (meer)." }, { status: 404 });
      const { instellingen } = await haalScribeInstellingen(session);
      return NextResponse.json(
        {
          configured: true,
          sessie: sessieMetadataVoorLijst(metadata),
          segmenten: [],
          staat: null,
          notitie: null,
          taken: [],
          rol: "beheerder",
          vrijgaveReden: null,
          instellingen,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const vrijgegeven = await haalVrijgegevenSessieIds(session);
    const rol = leesRolVoor(session, rij, vrijgegeven);
    if (!rol || rol === "beheerder") {
      return NextResponse.json({ error: "Geen toegang tot dit consult." }, { status: 403 });
    }

    const { instellingen } = await haalScribeInstellingen(session);

    if (rol === "vrijgave") {
      const notitieRij = await haalLaatsteNotitieRij(session, sessieId, true);
      // De banner "Aan u vrijgegeven omdat …" heeft de reden nodig; die staat
      // in careon_scribe_vrijgaven en is voor de ontvanger leesbaar
      // (aan_user_id = auth.uid()). Zonder deze regel bleef het veld altijd
      // leeg en toonde de UI een reden die nooit aankwam.
      const redenParams = new URLSearchParams({
        select: "reden",
        sessie_id: `eq.${sessieId}`,
        org_id: `eq.${session.orgId}`,
        aan_user_id: `eq.${session.userId}`,
        limit: "1",
      });
      const redenRijen = await scribeGet<{ reden: string | null }[]>(session, SCRIBE_VRIJGAVEN_TABEL, redenParams);
      const vrijgaveReden = Array.isArray(redenRijen) && redenRijen.length > 0 ? redenRijen[0].reden : null;
      scheduleAuditEvent({
        action: "scribe.transcript.read",
        resource: SCRIBE_SESSIES_TABEL,
        resourceId: sessieId,
        orgId: session.orgId,
        userId: session.userId,
        detail: { rol, segmenten: 0, verslag: notitieRij ? 1 : 0 },
      });
      return NextResponse.json(
        {
          configured: true,
          sessie: sessieVanRij(rij, false, true),
          segmenten: [],
          staat: null,
          notitie: notitieRij ? notitieVanRij(notitieRij) : null,
          taken: [],
          rol,
          vrijgaveReden,
          instellingen,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const [segmentRijen, staatRij, notitieRij, taakRijen] = await Promise.all([
      haalSegmentRijen(session, sessieId),
      haalStaatRij(session, sessieId),
      haalLaatsteNotitieRij(session, sessieId),
      haalTaakRijen(session, sessieId),
    ]);

    scheduleAuditEvent({
      action: "scribe.transcript.read",
      resource: SCRIBE_SESSIES_TABEL,
      resourceId: sessieId,
      orgId: session.orgId,
      userId: session.userId,
      // Metadata-only: aantallen, nooit tekst.
      detail: { rol, segmenten: segmentRijen.length, verslag: notitieRij ? 1 : 0 },
    });

    return NextResponse.json(
      {
        configured: true,
        sessie: sessieVanRij(rij, true, false),
        segmenten: segmentRijen.map(segmentVanRij),
        staat: staatRij ? staatVanRij(staatRij) : null,
        notitie: notitieRij ? notitieVanRij(notitieRij) : null,
        taken: taakRijen.map(taakVanRij),
        rol,
        vrijgaveReden: null,
        instellingen,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ sessieId: string }> }) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;
  const { sessieId } = await context.params;

  const gelezen = await leesBody(request);
  if ("denied" in gelezen) return gelezen.denied;
  const body = (gelezen.body ?? {}) as SessiePatchBody;
  const wilStatus = body.status !== undefined;
  const wilReferentie = body.patientReferentie !== undefined;
  if (!wilStatus && !wilReferentie) {
    return NextResponse.json({ error: "Geef een status of een dossierreferentie mee." }, { status: 400 });
  }
  if (wilStatus && !isSessieStatus(body.status)) {
    return NextResponse.json({ error: "Onbekende status." }, { status: 400 });
  }
  // N11 — annuleren wist de werkkopie; waaróm dat gebeurt hoort in de audit.
  // De grond komt uit een vaste enum, zodat er nooit een vrije toelichting met
  // consultinhoud in audit_events belandt.
  const grond = isGrond(body.grond) ? body.grond : null;
  if (body.status === "geannuleerd" && grond === null) {
    return NextResponse.json(
      {
        error:
          "Geef aan waarom dit consult vervalt (toestemming ingetrokken, verkeerd dossier, technisch onbruikbaar of overig).",
      },
      { status: 400 },
    );
  }

  try {
    let rij = await haalSessieRij(session, sessieId);
    if (!rij) return NextResponse.json({ error: "Dit consult bestaat niet (meer)." }, { status: 404 });
    if (rij.behandelaar_id !== session.userId) {
      return NextResponse.json({ error: "Alleen de eigen behandelaar wijzigt dit consult." }, { status: 403 });
    }

    if (wilReferentie) {
      const referentie = String(body.patientReferentie).trim();
      if (!isPatientReferentie(referentie)) {
        return NextResponse.json({ error: PATIENT_REFERENTIE_MELDING }, { status: 400 });
      }
      const params = new URLSearchParams({
        select: SESSIE_SELECT,
        id: `eq.${sessieId}`,
        org_id: `eq.${session.orgId}`,
      });
      const bijgewerkt = await scribePatch<ScribeSessieRij[]>(session, SCRIBE_SESSIES_TABEL, params, {
        patient_referentie: referentie,
        updated_at: new Date().toISOString(),
      });
      if (Array.isArray(bijgewerkt) && bijgewerkt.length > 0) rij = bijgewerkt[0];
    }

    let analyseRondes = 0;
    if (wilStatus && body.status !== undefined) {
      // Vóór het afronden moet de staat het transcript hebben ingehaald: het
      // verslag mag nooit op een half geanalyseerd consult rusten.
      if (body.status === "afgerond") {
        const staatRij = await haalStaatRij(session, sessieId);
        let laatste = staatRij ? staatRij.laatste_segment : 0;
        if (laatste < rij.segment_teller) {
          // Dit pad roept de provider aan; dezelfde quota-scope als /analyse en
          // /audio, anders is het afronden een gratis achterdeur (C7).
          const quota = await eisScribeQuota(session);
          if (quota) return quota;
        }
        const uiterlijk = Date.now() + ANALYSE_BUDGET_MS;
        while (laatste < rij.segment_teller && analyseRondes < MAX_ANALYSE_RONDES && Date.now() < uiterlijk) {
          const ronde = await voerScribeAnalyseUit(session, rij, request.signal);
          analyseRondes += 1;
          if (ronde.verwerkt === 0) break;
          // C35 — de lus mag nooit doorlopen op een ronde die niets bewaarde of
          // die geen voortgang boekte; anders draait ze zes keer op dezelfde
          // segmenten en betaalt elke ronde opnieuw de modelaanroep.
          if (!ronde.bewaard || ronde.laatsteSegment <= laatste) break;
          laatste = ronde.laatsteSegment;
        }
      }
      // Idempotent: de status staat al zo. Gebeurt sinds C12/C34 bij het
      // goedkeuren, waar de RPC van het verslag het consult zelf al meeschoof;
      // een tweede aanroep zou anders met "overgang niet toegestaan" falen.
      if (rij.status !== body.status) {
        const uitkomst = await scribeRpc<ScribeSessieRij | null>(session, "careon_scribe_status_zetten", {
          p_sessie: sessieId,
          p_status: body.status,
        });
        if (uitkomst) rij = uitkomst;
        const actie = AUDIT_PER_STATUS[body.status];
        if (actie) {
          scheduleAuditEvent({
            action: actie,
            resource: SCRIBE_SESSIES_TABEL,
            resourceId: sessieId,
            orgId: session.orgId,
            userId: session.userId,
            detail: { status: body.status, segmenten: rij.segment_teller, analyseRondes, grond },
          });
        }
      }
    }

    return NextResponse.json(
      { configured: true, sessie: sessieVanRij(rij, true, false), analyseRondes },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error, "Consult kon niet worden bijgewerkt.");
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ sessieId: string }> }) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;
  const { sessieId } = await context.params;

  const gelezen = await leesBody(request);
  if ("denied" in gelezen) return gelezen.denied;
  const body = (gelezen.body ?? {}) as SessieVerwijderBody;

  const grond = isGrond(body.grond) ? body.grond : null;

  try {
    const eigenRij = await haalSessieRij(session, sessieId);
    const eigenaar = eigenRij !== null && eigenRij.behandelaar_id === session.userId;
    if (!eigenaar) {
      // Andermans consult verwijderen is beheer, geen lidmaatschapsrecht.
      const beheer = await requireOrgAdmin();
      if ("denied" in beheer) return beheer.denied;
      // N11 — ook een beheerdersverwijdering draagt een grond uit de vaste
      // enum; anders staat er straks alleen "verwijderd" in het logboek.
      if (grond === null) {
        return NextResponse.json(
          {
            error:
              "Geef aan waarom dit consult wordt verwijderd (toestemming ingetrokken, " +
              "verkeerd dossier, technisch onbruikbaar of overig).",
          },
          { status: 400 },
        );
      }
    }
    // Een beheerder leest de rij niet meer onder zijn eigen JWT (C3/C10); de
    // metadata die deze route nodig heeft (status, segmentteller) komt via de
    // service-role, zonder dossierreferentie en consulttype.
    const rij = eigenRij ?? (await haalBeheerSessieRij(session.orgId as string, sessieId));
    if (!rij) return NextResponse.json({ error: "Dit consult bestaat niet (meer)." }, { status: 404 });

    // Guard (§5.3): een goedgekeurd verslag dat nog niet is overgenomen, is het
    // enige exemplaar dat de behandelaar nog naar het EPD moet overzetten.
    //
    // C12/C34 — dit mag niet op de sessiestatus alléén rusten. Een beheerder
    // leest de verslagen van collega's niet, dus telt hij ze metadata-only via
    // de service-role (`select=id`, nooit `secties`). Faalt die telling of is
    // er geen service-role, dan geldt het consult als BESCHERMD: fail closed,
    // want de fout is onherstelbaar.
    const notitieRij = eigenaar ? await haalLaatsteNotitieRij(session, sessieId, true) : null;
    const telling = eigenaar ? null : await telGoedgekeurdeNotities(session.orgId as string, sessieId);
    const onbekend = !eigenaar && telling === null;
    const eigenVersies = notitieRij ? 1 : 0;
    const goedgekeurdeVersies = eigenaar ? eigenVersies : (telling ?? 0);
    const beschermd =
      rij.status !== "overgenomen" && (rij.status === "goedgekeurd" || goedgekeurdeVersies > 0 || onbekend);
    const geforceerd = body.forceer === true;
    const reden = typeof body.reden === "string" ? body.reden.trim() : "";
    if (beschermd && !(geforceerd && reden.length > 0)) {
      return NextResponse.json(
        {
          error:
            "Dit consult heeft een goedgekeurd verslag dat nog niet is overgenomen in het EPD. " +
            "Bevestig het verwijderen met een reden.",
        },
        { status: 409 },
      );
    }

    // Cascade ruimt segmenten, staat, notities, taken en vrijgaven op.
    const verwijderd = await scribeServiceRpc<{
      verwijderd: boolean;
      id: string;
      segmenten: number;
      notities: number;
      rol: "eigenaar" | "beheerder";
    }>("careon_scribe_sessie_verwijderen", {
      p_org: session.orgId,
      p_sessie: sessieId,
      p_actor: session.userId,
      p_forceer: geforceerd,
      p_reden: reden,
      p_grond: grond,
    });
    if (!verwijderd.verwijderd || verwijderd.id !== sessieId) {
      return NextResponse.json({ error: "De verwijdering kon niet worden bevestigd." }, { status: 502 });
    }

    scheduleAuditEvent({
      action: "scribe.sessie.verwijderd",
      resource: SCRIBE_SESSIES_TABEL,
      resourceId: sessieId,
      orgId: session.orgId,
      userId: session.userId,
      detail: {
        rol: verwijderd.rol,
        segmenten: verwijderd.segmenten,
        notities: verwijderd.notities,
        geforceerd,
        redenLengte: reden.length,
        grond,
      },
    });

    return NextResponse.json(
      {
        configured: true,
        verwijderd: true,
        segmenten: verwijderd.segmenten,
        notities: verwijderd.notities,
        rol: verwijderd.rol,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error, "Consult kon niet worden verwijderd.");
  }
}
