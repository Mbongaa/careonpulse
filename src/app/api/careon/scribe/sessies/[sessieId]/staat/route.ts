import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import {
  SCRIBE_BODY_LIMIETEN,
  STAAT_MUTATIE_ACTIES,
  type StaatFeitInvoer,
  type StaatMutatieActie,
  type StaatPatchBody,
} from "@/lib/careon-scribe/api-contract";
import { rondStaatAf } from "@/lib/careon-scribe/deterministisch";
import { isKlinischeStaat } from "@/lib/careon-scribe/klinische-staat";
import {
  eisScribeMachtiging,
  haalSessieRij,
  haalStaatRij,
  pasStaatMutatieToe,
  SCRIBE_SESSIES_TABEL,
  type ScribeStaatRij,
  scribeFoutAntwoord,
  scribeRpc,
  staatVanRij,
} from "@/lib/careon-scribe/scribe.server";
import { isStaatCategorie, SCRIBE_LIMITS } from "@/lib/careon-scribe/types";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireCareonSession } from "@/lib/supabase/session.server";

// Correctie van de klinische staat door de behandelaar (N6/S7, handoff 20 §7.3).
//
// S7 belooft dat de behandelaar de staat kan corrigeren; zonder deze route was
// dat onwaar: een verkeerd geëxtraheerde allergie of een dosering van "15 mg"
// in plaats van "50 mg" bleef staan tot het consult verdween, en een middel dat
// niemand hardop noemde kreeg je er niet in — terwijl het medicatiepaneel
// intussen "Geen gecontroleerde signalen" meldt.
//
// Drie regels:
//   * ALLEEN DE EIGEN BEHANDELAAR, en alleen zolang het consult `actief` of
//     `afgerond` is. Een goedgekeurd of overgenomen consult ligt vast.
//   * ELKE geraakte rij krijgt `doorBehandelaar: true`. bewaarBehandelaarsfeiten()
//     (scribe.server.ts) tilt zo'n rij door élke latere analysepas heen: een
//     modelantwoord kan een intrekking nooit omkeren en een handmatig feit nooit
//     wegpoetsen.
//   * De regellaag draait opnieuw (rondStaatAf), zodat het amberalarm van een
//     ingetrokken allergie meteen verdwijnt in plaats van bij de volgende
//     analyseronde.
//
// Het auditdetail draagt de categorie en de handeling — nooit de tekst van het
// feit: dat is bijzondere-categoriedata en hoort niet in audit_events (§6/§8).

export const runtime = "nodejs";

function isMutatieActie(waarde: unknown): waarde is StaatMutatieActie {
  return typeof waarde === "string" && (STAAT_MUTATIE_ACTIES as readonly string[]).includes(waarde);
}

function isFeitInvoer(waarde: unknown): waarde is StaatFeitInvoer {
  if (!waarde || typeof waarde !== "object") return false;
  const feit = waarde as Record<string, unknown>;
  if (typeof feit.tekst !== "string" || feit.tekst.trim().length === 0) return false;
  if (feit.tekst.length > SCRIBE_LIMITS.feitTekst) return false;
  const tekstVeld = (naam: string) => feit[naam] === undefined || feit[naam] === null || typeof feit[naam] === "string";
  return (
    tekstVeld("naam") &&
    tekstVeld("dosering") &&
    tekstVeld("gebruik") &&
    tekstVeld("aard") &&
    tekstVeld("categorie") &&
    tekstVeld("omschrijving") &&
    tekstVeld("soort")
  );
}

export async function PATCH(request: Request, context: { params: Promise<{ sessieId: string }> }) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;
  const { sessieId } = await context.params;

  let body: unknown;
  try {
    body = await readJsonBodyLimited<unknown>(request, SCRIBE_BODY_LIMIETEN.standaard);
  } catch (error) {
    const status = error instanceof RequestPayloadTooLargeError ? 413 : 400;
    if (!(error instanceof RequestPayloadTooLargeError) && !(error instanceof InvalidJsonBodyError)) {
      console.error("Scribe body read failed", { route: "sessies/[sessieId]/staat" });
    }
    return NextResponse.json({ error: status === 413 ? "Payload te groot." : "Ongeldige JSON." }, { status });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Ongeldige correctie." }, { status: 400 });
  }
  const invoer = body as StaatPatchBody;
  if (!Number.isInteger(invoer.versie) || invoer.versie < 0) {
    return NextResponse.json({ error: "Ongeldige versie." }, { status: 400 });
  }
  const epdBevestiging = "epdLijstBeoordeeld" in invoer && invoer.epdLijstBeoordeeld === true;
  if (epdBevestiging && Object.keys(invoer).some((key) => key !== "versie" && key !== "epdLijstBeoordeeld")) {
    return NextResponse.json({ error: "Bevestig de EPD-lijst afzonderlijk na de correcties." }, { status: 400 });
  }
  if (!epdBevestiging && (!("categorie" in invoer) || !isStaatCategorie(invoer.categorie))) {
    return NextResponse.json({ error: "Onbekende categorie." }, { status: 400 });
  }
  if (!epdBevestiging && (!("actie" in invoer) || !isMutatieActie(invoer.actie))) {
    return NextResponse.json({ error: "Onbekende actie." }, { status: 400 });
  }
  if (!epdBevestiging && (!("feit" in invoer) || !isFeitInvoer(invoer.feit))) {
    return NextResponse.json({ error: "Vul de tekst van het feit in." }, { status: 400 });
  }

  try {
    const sessieRij = await haalSessieRij(session, sessieId);
    if (!sessieRij) return NextResponse.json({ error: "Dit consult bestaat niet (meer)." }, { status: 404 });
    if (sessieRij.behandelaar_id !== session.userId) {
      return NextResponse.json({ error: "Alleen de eigen behandelaar corrigeert dit consult." }, { status: 403 });
    }
    if (sessieRij.status !== "actief" && sessieRij.status !== "afgerond") {
      return NextResponse.json(
        { error: "Dit consult ligt vast; de analyse is niet meer te wijzigen." },
        { status: 409 },
      );
    }

    const staatRij = await haalStaatRij(session, sessieId);
    if (!staatRij) return NextResponse.json({ error: "Er is nog geen analyse voor dit consult." }, { status: 409 });
    const huidig = staatVanRij(staatRij);
    if (huidig.versie !== invoer.versie) {
      return NextResponse.json(
        { error: "De analyse is intussen bijgewerkt — open het consult opnieuw.", versie: huidig.versie },
        { status: 409 },
      );
    }

    const feitMutatie = "categorie" in invoer ? invoer : null;
    const gemuteerd = feitMutatie
      ? pasStaatMutatieToe(huidig.staat, feitMutatie.categorie, feitMutatie.actie, feitMutatie.feit)
      : huidig.staat;
    if (!gemuteerd) {
      return NextResponse.json({ error: "Dit feit staat niet (meer) in de analyse." }, { status: 409 });
    }
    // De regellaag opnieuw: een ingetrokken allergie mag geen amberalarm meer
    // geven, en een toegevoegd middel moet er juist meteen een kunnen opleveren.
    const nieuweStaat = rondStaatAf(gemuteerd);
    if (!isKlinischeStaat(nieuweStaat)) {
      return NextResponse.json({ error: "De correctie levert een ongeldige analyse op." }, { status: 400 });
    }

    let epdBeoordeeld: boolean | null = null;
    if (epdBevestiging) epdBeoordeeld = true;
    else if (feitMutatie && ["medicatie", "allergieen"].includes(feitMutatie.categorie)) epdBeoordeeld = false;
    const bijgewerkt = await scribeRpc<ScribeStaatRij>(session, "careon_scribe_staat_bewaren", {
      p_sessie: sessieId,
      p_versie: huidig.versie,
      p_staat: nieuweStaat,
      p_epd_beoordeeld: epdBeoordeeld,
    });
    const definitief = staatVanRij(bijgewerkt);

    scheduleAuditEvent({
      action: "scribe.staat.gewijzigd",
      resource: SCRIBE_SESSIES_TABEL,
      resourceId: sessieId,
      orgId: session.orgId,
      userId: session.userId,
      // Metadata-only: welke categorie en welke handeling — nooit het feit zelf.
      detail: {
        sessie: sessieId,
        categorie: feitMutatie?.categorie ?? "epd",
        actie: feitMutatie?.actie ?? "beoordeeld",
        versie: definitief.versie,
      },
    });

    return NextResponse.json(
      {
        configured: true,
        staat: definitief.staat,
        versie: definitief.versie,
        laatsteSegment: definitief.laatsteSegment,
        verouderd: definitief.verouderd,
        epdLijstBeoordeeld: definitief.epdLijstBeoordeeld,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error, "De correctie kon niet worden opgeslagen.");
  }
}
