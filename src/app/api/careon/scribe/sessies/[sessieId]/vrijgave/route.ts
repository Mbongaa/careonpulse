import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { SCRIBE_BODY_LIMIETEN, type VrijgaveBody, type VrijgaveIntrekkenBody } from "@/lib/careon-scribe/api-contract";
import {
  eisScribeMachtiging,
  haalBeheerSessieRij,
  haalGemachtigden,
  haalSessieRij,
  SCRIBE_VRIJGAVEN_TABEL,
  scribeDelete,
  scribeFoutAntwoord,
  scribeGet,
  scribeServiceBeschikbaar,
  scribeServiceRpc,
} from "@/lib/careon-scribe/scribe.server";
import { GEANNULEERD_GRONDEN, type GeannuleerdGrond, SCRIBE_LIMITS } from "@/lib/careon-scribe/types";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

// Verslag vrijgeven aan een collega bij offboarding (handoff 20 §5.3, S12) en
// die vrijgave weer intrekken (N11).
//
// De beheerder geeft NOOIT het transcript vrij — alleen het GOEDGEKEURDE
// verslag. De insert loopt via de service-role omdat careon_scribe_vrijgaven
// bewust geen client-insert-policy heeft: vrijgeven is een geauditeerde
// beheerhandeling, geen gewone schrijfactie. Het INTREKKEN loopt wél onder het
// caller-JWT: careon_scribe_vrijgaven_delete staat de beheerder dat toe, en
// §2.3 wil het caller-JWT waar RLS het aankan.
//
// Drie grenzen die de vrijgave een overdracht houden en geen leeskanaal:
//   * niet aan zichzelf (C9) — een beheerder leest zo anders elk verslag van
//     elke collega, geauditeerd maar ongehinderd; de CHECK
//     careon_scribe_vrijgaven_niet_zelf houdt dat ook onder de service-role
//     tegen;
//   * één ontvanger per consult (C9) — "eenmalig aan één aangewezen collega";
//     wie zich vergist, trekt de bestaande vrijgave eerst in;
//   * alleen aan een GEMACHTIGDE collega (C4/C14) — anders ontstaat een
//     vrijgave die de module zelf met 403 blokkeert terwijl RLS haar toestaat.

export const runtime = "nodejs";

const UUID_PATROON = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isGrond(waarde: unknown): waarde is GeannuleerdGrond {
  return typeof waarde === "string" && (GEANNULEERD_GRONDEN as readonly string[]).includes(waarde);
}

async function leesBody(request: Request, route: string): Promise<{ body: unknown } | { denied: NextResponse }> {
  try {
    return { body: await readJsonBodyLimited<unknown>(request, SCRIBE_BODY_LIMIETEN.standaard) };
  } catch (error) {
    if (error instanceof RequestPayloadTooLargeError) {
      return { denied: NextResponse.json({ error: "Payload te groot." }, { status: 413 }) };
    }
    // Een DELETE zonder lichaam is geldig: dan vervallen álle vrijgaven.
    if (error instanceof InvalidJsonBodyError) return { body: {} };
    console.error("Scribe body read failed", { route });
    return { denied: NextResponse.json({ error: "Ongeldige JSON." }, { status: 400 }) };
  }
}

export async function POST(request: Request, context: { params: Promise<{ sessieId: string }> }) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;
  const orgId = session.orgId ?? "";
  const { sessieId } = await context.params;

  const gelezen = await leesBody(request, "vrijgave");
  if ("denied" in gelezen) return gelezen.denied;
  const invoer = (gelezen.body ?? {}) as VrijgaveBody;
  const aanUserId = typeof invoer.aanUserId === "string" ? invoer.aanUserId : "";
  const reden = typeof invoer.reden === "string" ? invoer.reden.trim() : "";
  if (!UUID_PATROON.test(aanUserId)) {
    return NextResponse.json({ error: "Kies een collega uit uw organisatie." }, { status: 400 });
  }
  if (reden.length === 0 || reden.length > SCRIBE_LIMITS.vrijgaveReden) {
    return NextResponse.json({ error: "Geef een reden op (maximaal 300 tekens)." }, { status: 400 });
  }
  // C9 — vóór elke service-role-lezing: een geweigerde aanvraag kost niets.
  if (aanUserId === session.userId) {
    return NextResponse.json(
      { error: "Wijs een andere collega aan; een beheerder geeft een verslag niet aan zichzelf vrij." },
      { status: 409 },
    );
  }
  if (!scribeServiceBeschikbaar()) {
    return NextResponse.json({ error: "Vrijgeven is niet beschikbaar op deze omgeving." }, { status: 503 });
  }

  try {
    // De beheerder leest het consult van een collega niet onder zijn eigen JWT
    // (C3/C10); de metadata komt via de service-role, zonder dossierreferentie.
    const rij = (await haalSessieRij(session, sessieId)) ?? (await haalBeheerSessieRij(orgId, sessieId));
    if (!rij) return NextResponse.json({ error: "Dit consult bestaat niet (meer)." }, { status: 404 });
    // Alleen een vastgesteld verslag mag over: een concept is geen document.
    if (rij.status !== "goedgekeurd" && rij.status !== "overgenomen") {
      return NextResponse.json({ error: "Alleen een goedgekeurd verslag kan worden vrijgegeven." }, { status: 409 });
    }
    if (aanUserId === rij.behandelaar_id) {
      return NextResponse.json({ error: "Dit consult is al van deze behandelaar." }, { status: 409 });
    }

    // C4/C14 — dezelfde bron als de keuzelijst in de vrijgave-dialoog, zodat
    // client en server niet uit elkaar kunnen lopen: een niet-gemachtigde
    // ontvanger krijgt van élke leesroute 403, terwijl RLS hem het verslag wél
    // zou geven. Die tegenspraak mag niet ontstaan.
    const leden = await haalGemachtigden(orgId);
    if (!leden) {
      return NextResponse.json({ error: "Collega kon niet worden gecontroleerd." }, { status: 502 });
    }
    const ontvanger = leden.find((lid) => lid.userId === aanUserId);
    if (!ontvanger) {
      return NextResponse.json({ error: "Deze gebruiker hoort niet bij uw organisatie." }, { status: 404 });
    }
    if (!ontvanger.gemachtigd) {
      return NextResponse.json(
        {
          error:
            "Deze collega is nog niet gemachtigd voor Careon AI. " +
            "Machtig hem of haar eerst bij Instellingen → Gemachtigde behandelaren.",
        },
        { status: 409 },
      );
    }

    // Parent lock + unique session release enforce the recipient bound even
    // when two administrators submit different recipients simultaneously.
    const vrijgave = await scribeServiceRpc<{
      id: string;
      sessie_id: string;
      aan_user_id: string;
      door_user_id: string;
      reden: string;
      created_at: string;
    }>("careon_scribe_vrijgeven", {
      p_org: orgId,
      p_sessie: sessieId,
      p_actor: session.userId,
      p_ontvanger: aanUserId,
      p_reden: reden,
    });

    scheduleAuditEvent({
      action: "scribe.sessie.vrijgegeven",
      resource: SCRIBE_VRIJGAVEN_TABEL,
      resourceId: vrijgave.id,
      orgId: session.orgId,
      userId: session.userId,
      // Metadata-only: wie, aan wie, en hoe lang de reden was — nooit de tekst.
      detail: { sessie: sessieId, aanUserId, redenLengte: reden.length },
    });

    return NextResponse.json(
      {
        configured: true,
        vrijgave: {
          id: vrijgave.id,
          sessieId: vrijgave.sessie_id,
          aanUserId: vrijgave.aan_user_id,
          doorUserId: vrijgave.door_user_id ?? session.userId,
          reden: vrijgave.reden ?? reden,
          createdAt: vrijgave.created_at,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error, "Vrijgeven is niet gelukt.");
  }
}

/**
 * Vrijgave intrekken (N11). Zonder deze weg is een vrijgave onherroepelijk: de
 * unieke sleutel (sessie_id, aan_user_id) maakt een vergissing definitief,
 * terwijl S12 juist een uitzondering beschrijft en geen permanente toekenning.
 * Zonder `aanUserId` vervallen álle vrijgaven van dit consult.
 */
export async function DELETE(request: Request, context: { params: Promise<{ sessieId: string }> }) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;
  const orgId = session.orgId ?? "";
  const { sessieId } = await context.params;

  const gelezen = await leesBody(request, "vrijgave-delete");
  if ("denied" in gelezen) return gelezen.denied;
  const invoer = (gelezen.body ?? {}) as VrijgaveIntrekkenBody;
  const aanUserId = typeof invoer.aanUserId === "string" ? invoer.aanUserId : "";
  if (aanUserId.length > 0 && !UUID_PATROON.test(aanUserId)) {
    return NextResponse.json({ error: "Kies een collega uit uw organisatie." }, { status: 400 });
  }
  const grond = isGrond(invoer.grond) ? invoer.grond : null;

  try {
    const params = new URLSearchParams({ sessie_id: `eq.${sessieId}`, org_id: `eq.${orgId}` });
    if (aanUserId.length > 0) params.set("aan_user_id", `eq.${aanUserId}`);
    // Onder het caller-JWT: careon_scribe_vrijgaven_delete eist
    // app.mag_scribe_beheren, dus RLS blijft hier de grens (§2.3).
    const telParams = new URLSearchParams(params);
    telParams.set("select", "id");
    telParams.set("limit", "100");
    const bestaande = await scribeGet<{ id: string }[]>(session, SCRIBE_VRIJGAVEN_TABEL, telParams);
    const aantal = Array.isArray(bestaande) ? bestaande.length : 0;
    if (aantal === 0) {
      return NextResponse.json({ error: "Er is geen vrijgave om in te trekken." }, { status: 404 });
    }
    await scribeDelete(session, SCRIBE_VRIJGAVEN_TABEL, params);

    scheduleAuditEvent({
      action: "scribe.sessie.vrijgave.ingetrokken",
      resource: SCRIBE_VRIJGAVEN_TABEL,
      resourceId: sessieId,
      orgId: session.orgId,
      userId: session.userId,
      // Metadata-only: aan wie, hoeveel rijen, en de grond uit de vaste enum.
      detail: { sessie: sessieId, aanUserId: aanUserId.length > 0 ? aanUserId : null, aantal, grond },
    });

    return NextResponse.json(
      { configured: true, ingetrokken: true, aantal },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error, "Vrijgave kon niet worden ingetrokken.");
  }
}
