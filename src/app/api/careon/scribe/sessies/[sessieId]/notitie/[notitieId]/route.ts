import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { type NotitiePatchBody, SCRIBE_BODY_LIMIETEN } from "@/lib/careon-scribe/api-contract";
import {
  eisScribeMachtiging,
  notitieVanRij,
  SCRIBE_NOTITIES_TABEL,
  type ScribeNotitieRij,
  scribeFoutAntwoord,
  scribeRpc,
} from "@/lib/careon-scribe/scribe.server";
import { isSectieStatus, SCRIBE_LIMITS } from "@/lib/careon-scribe/types";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireCareonSession } from "@/lib/supabase/session.server";

// Verslag bewerken en per sectie goedkeuren (handoff 20 §5.3, S10).
//
// "Alles goedkeuren" raakt UITSLUITEND de niet-★-secties; de beoordelings-
// secties (Analyse/Beoordeling/Evaluatie/Werkhypothese/Overwegingen/
// Risicotaxatie) moeten individueel bewerkt én goedgekeurd worden en komen als
// `overgeslagen` terug, zodat de UI dat kan melden. Zijn álle secties
// goedgekeurd, dan zet de RPC de notitie definitief vast — die controleert
// nogmaals dat elke ★-sectie een niet-lege tekst van de behandelaar draagt en
// schuift het consult in dezelfde transactie mee naar `goedgekeurd` (C12/C34).
//
// N22 — heeft het transcript bekende gaten, dan is de laatste goedkeuring pas
// mogelijk met `ontbrekendeFragmentenBeoordeeld: true`. De ontbrekende minuut
// is precies de plek waar een medicatie-, dosis- of allergie-uitspraak kan
// zitten, en het goedgekeurde verslag gaat het EPD in; die bevestiging en het
// aantal gaten gaan mee in het auditdetail.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function PATCH(request: Request, context: { params: Promise<{ sessieId: string; notitieId: string }> }) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;
  const { sessieId, notitieId } = await context.params;

  let body: unknown;
  try {
    body = await readJsonBodyLimited<unknown>(request, SCRIBE_BODY_LIMIETEN.notitie);
  } catch (error) {
    const status = error instanceof RequestPayloadTooLargeError ? 413 : 400;
    if (!(error instanceof RequestPayloadTooLargeError) && !(error instanceof InvalidJsonBodyError)) {
      console.error("Scribe body read failed", { route: "notitie/[notitieId]" });
    }
    return NextResponse.json({ error: status === 413 ? "Payload te groot." : "Ongeldige JSON." }, { status });
  }
  const invoer = (body ?? {}) as NotitiePatchBody & { ontbrekendeFragmentenBeoordeeld?: unknown };
  const patches = Array.isArray(invoer.secties) ? invoer.secties : [];
  const alleGoedkeuren = invoer.alleGoedkeuren === true;
  const gatenBeoordeeld = invoer.ontbrekendeFragmentenBeoordeeld === true;
  if (patches.length === 0 && !alleGoedkeuren) {
    return NextResponse.json({ error: "Geef secties of `alleGoedkeuren` mee." }, { status: 400 });
  }

  if (!Number.isInteger(invoer.bewerkRevisie) || invoer.bewerkRevisie < 1) {
    return NextResponse.json({ error: "Ververs het verslag; de bewerkrevisie ontbreekt." }, { status: 409 });
  }
  if (
    patches.length > SCRIBE_LIMITS.secties ||
    patches.some(
      (patch) =>
        !patch ||
        typeof patch.id !== "string" ||
        (patch.tekst !== undefined &&
          (typeof patch.tekst !== "string" || patch.tekst.length > SCRIBE_LIMITS.sectieTekst)) ||
        (patch.status !== undefined && !isSectieStatus(patch.status)),
    )
  ) {
    return NextResponse.json({ error: "Ongeldige sectiewijziging." }, { status: 400 });
  }
  try {
    const resultaat = await scribeRpc<{ notitie: ScribeNotitieRij; overgeslagen: string[]; goedgekeurd: boolean }>(
      session,
      "careon_scribe_notitie_bewerken",
      {
        p_notitie: notitieId,
        p_sessie: sessieId,
        p_revisie: invoer.bewerkRevisie,
        p_patches: patches,
        p_alle_goedkeuren: alleGoedkeuren,
        p_gaten_beoordeeld: gatenBeoordeeld,
      },
    );
    if (resultaat.notitie.sessie_id !== sessieId) {
      // IDs are checked before mutation by the RPC as well (p_sessie below).
      throw new Error("Unexpected note session");
    }
    if (resultaat.goedgekeurd) {
      scheduleAuditEvent({
        action: "scribe.notitie.goedgekeurd",
        resource: SCRIBE_NOTITIES_TABEL,
        resourceId: notitieId,
        orgId: session.orgId,
        userId: session.userId,
        detail: {
          sessie: sessieId,
          versie: resultaat.notitie.versie,
          bewerkRevisie: resultaat.notitie.bewerk_revisie,
          secties: Array.isArray(resultaat.notitie.secties) ? resultaat.notitie.secties.length : 0,
          ontbrekendeFragmentenBeoordeeld: gatenBeoordeeld,
        },
      });
    }
    return NextResponse.json(
      {
        configured: true,
        notitie: notitieVanRij(resultaat.notitie),
        overgeslagen: resultaat.overgeslagen,
        goedgekeurd: resultaat.goedgekeurd,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error, "Verslag kon niet worden bijgewerkt.");
  }
}
