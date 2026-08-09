import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { magFinancieelZien } from "@/lib/careon-financieel-rol";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import { type CareonSession, requireCareonSession } from "@/lib/supabase/session.server";

// Gedeelde route-fabriek voor de aanvullende-exportopslag (agenda,
// verwijzers, toeslagen, declaraties): zelfde patroon en drempels als
// /api/careon/middelen — sessie-auth (cookie) en PostgREST met het JWT van de
// aanvrager zelf, zodat RLS de org-scheiding afdwingt. 501 zonder
// expliciete demo-modus zodat de client op localStorage terugvalt; ontbrekende
// productieconfiguratie faalt met 503. Append-only jsonb-rijen (nieuwste per
// organisatie wint).

// Aggregaten zijn klein (~300 kB); ruim plafond tegen misbruik van de route.
const MAX_BODY_BYTES = 4_000_000;

async function storageFetch(input: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(input, init);
  } catch (error) {
    console.error("Auxiliary storage request unavailable", error);
    return null;
  }
}

/** Financiële rolregel per aggregaat: "geheel" verbergt de volledige staat
    voor leden (toeslagen/declaraties zijn puur financieel); "redigeer" levert
    leden een genulde variant (agenda is gemengd — planning/no-show blijven). */
export type AuxFinancieelBeleid<T> = { modus: "geheel" } | { modus: "redigeer"; redigeer: (state: T) => T };

/**
 * @param table Basistabel: bron voor POST (insert + idempotentie).
 * @param leesRelatie Optionele leesrelatie voor GET. Nodig sinds migratie 0015:
 *   de financiële aggregaten staan in RLS op slot voor gewone leden, en het
 *   gemengde agenda-aggregaat wordt door hen gelezen via de redigerende view
 *   `careon_agenda_state_public`. Een view is niet insertable, dus lezen en
 *   schrijven moeten uiteen kunnen lopen. Zonder waarde blijft alles de
 *   basistabel gebruiken.
 */
export function createAuxStateHandlers<T>(
  table: string,
  isValid: (value: unknown) => value is T,
  label: string,
  financieel?: AuxFinancieelBeleid<T>,
  leesRelatie?: string,
) {
  async function GET() {
    const auth = await requireCareonSession();
    if ("denied" in auth) return auth.denied;
    const session: CareonSession = auth.session;

    const params = new URLSearchParams({
      select: "state",
      org_id: `eq.${session.orgId}`,
      order: "saved_at.desc",
      limit: "1",
    });
    // Onvoorwaardelijk uit de leesrelatie: de view geeft financieel-
    // gerechtigden dezelfde volledige staat als de basistabel, dus een
    // rolafhankelijke keuze zou alleen maar twee paden opleveren die kunnen
    // uiteenlopen.
    let response = await storageFetch(`${POSTGREST_URL}/${leesRelatie ?? table}?${params}`, {
      headers: userRestHeaders(session),
      cache: "no-store",
    });
    // Uitrolvangnet: draait deze code vóór migratie 0015, dan bestaat de view
    // nog niet (PostgREST: 404). Terugvallen op de basistabel is dan veilig —
    // de policies van 0010 gelden nog én de redactie hieronder draait toch —
    // en voorkomt dat het agenda-aggregaat stilzwijgend terugvalt op
    // demo-constanten. Ná 0015 wordt deze tak nooit meer geraakt.
    if (leesRelatie && response?.status === 404) {
      console.warn(`Leesrelatie ${leesRelatie} ontbreekt (migratie 0015 nog niet toegepast?); val terug op ${table}.`);
      response = await storageFetch(`${POSTGREST_URL}/${table}?${params}`, {
        headers: userRestHeaders(session),
        cache: "no-store",
      });
    }
    if (!response?.ok) {
      return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
    }
    const rows = (await response.json()) as { state: unknown }[];
    let state = rows[0] && isValid(rows[0].state) ? rows[0].state : null;
    // Blijft staan náást de RLS/view uit 0015: die dekt alleen de gehoste
    // databank, terwijl dezelfde redactieregel ook geldt zonder database (demo
    // en de lokale browseropslag). Twee lagen die hetzelfde nullen kan geen
    // kwaad; één laag missen wel.
    if (state !== null && financieel && !magFinancieelZien(session)) {
      state = financieel.modus === "geheel" ? null : financieel.redigeer(state);
    }
    return NextResponse.json({ configured: true, state });
  }

  async function POST(request: Request) {
    const auth = await requireCareonSession();
    if ("denied" in auth) return auth.denied;
    const session: CareonSession = auth.session;
    // Wie (een deel van) een aggregaat niet mag zien, mag hem ook niet
    // vervangen: een push wint org-breed (nieuwste rij). Voor de gemengde
    // agenda geldt dat evengoed — een lid zou anders zijn geredigeerde
    // (genulde) GET-kopie kunnen terugposten en zo de omzet van de hele
    // organisatie wissen. De lokale import in de eigen browser blijft werken;
    // alleen de centrale vervanging is beheerdersterrein. Een merge-on-write
    // zou de gemengde agenda alsnog kunnen openzetten, maar hoort bij het
    // aggregaat zelf, en de RLS op deze tabellen weigert de schrijfactie toch
    // al op databaseniveau — route en database moeten hetzelfde antwoord geven.
    //
    // `reden` is er voor de client: dit is een rolbesluit, geen mislukte sync.
    // Zonder dat onderscheid toont de importkaart de rode "Centrale opslag
    // mislukt"-melding terwijl er niets kapot is.
    if (financieel && !magFinancieelZien(session)) {
      scheduleAuditEvent({
        action: "state.append_denied",
        resource: table,
        orgId: session.orgId,
        userId: session.userId,
        detail: { reason: "financieel_beheerder" },
      });
      return NextResponse.json(
        {
          error: "Alleen organisatiebeheerders koppelen deze export centraal.",
          reden: "alleen_beheerder",
        },
        { status: 403 },
      );
    }

    let body: { state?: unknown; operationId?: unknown };
    try {
      body = await readJsonBodyLimited<{ state?: unknown; operationId?: unknown }>(request, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof RequestPayloadTooLargeError) {
        return NextResponse.json({ error: `${label} is te groot voor centrale opslag.` }, { status: 413 });
      }
      if (!(error instanceof InvalidJsonBodyError)) {
        console.error(`Auxiliary ${label} body read failed`, error);
      }
      return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
    }
    if (
      typeof body.operationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.operationId) ||
      !isValid(body.state)
    ) {
      return NextResponse.json({ error: `Ongeldige ${label}.` }, { status: 400 });
    }

    // Schrijven gaat altijd naar de basistabel — ook de idempotentie-lookup
    // hieronder. Een view is niet insertable, en de ledenview filtert bovendien
    // op lidmaatschap, dus een lookup daarop zou rijen kunnen missen die er wél
    // zijn en de 409 ten onrechte als storing melden.
    const response = await storageFetch(`${POSTGREST_URL}/${table}`, {
      method: "POST",
      headers: userRestHeaders(session),
      body: JSON.stringify({ org_id: session.orgId, state: body.state, operation_id: body.operationId }),
    });
    if (!response?.ok) {
      if (response?.status === 409) {
        const existing = await storageFetch(
          `${POSTGREST_URL}/${table}?select=id&org_id=eq.${session.orgId}&operation_id=eq.${body.operationId}&limit=1`,
          { headers: userRestHeaders(session), cache: "no-store" },
        );
        if (existing?.ok && ((await existing.json()) as unknown[]).length === 1) {
          return NextResponse.json({ configured: true, idempotent: true });
        }
      }
      return NextResponse.json({ error: `${label} kon niet worden opgeslagen.` }, { status: 502 });
    }
    scheduleAuditEvent({
      action: "state.append",
      resource: table,
      orgId: session.orgId,
      userId: session.userId,
    });
    return NextResponse.json({ configured: true });
  }

  return { GET, POST };
}
