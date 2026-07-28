// Financiële rolregel voor de AI-assistent (klantbesluit 28-07-2026): leden
// mogen géén financiële vragen stellen en géén financiële context meesturen.
// De enige afdwingbare plek is de server-route (/api/assistant) — alles wat de
// client doet (intentie-inferentie, groundingopbouw, deterministische
// antwoorden) is beïnvloedbaar door de gebruiker en telt als hoffelijkheid,
// niet als beveiliging. Deze module is bewust puur (geen imports) zodat de
// verify-scripts de classificatie en de scrub direct kunnen aftoetsen.

/** Herkent financiële vragen (Nederlands): omzet, facturatie, declaraties,
    toeslagen, tarieven, onderhanden werk, bedragen/kosten/geld/euro en DSO.
    "factu" dekt factuur/facturen/facturatie/factureren; euro en geld zijn
    woordbegrensd ("neuroloog" en "geldig" zijn geen financiële vragen). */
const VRAAG_PATROON =
  /omzet|financ|declarat|factu|toeslag|onderhanden|tarie(?:f|ven)|infomedics|vecozo|\bdso\b|\beuro(?:'s)?\b|€|kosten|verdien|\bgeld\b|\bbedrag/i;

export function isFinancieleAssistentVraag(vraag: string): boolean {
  return VRAAG_PATROON.test(vraag);
}

/** Markeringen van financiële feiten in context/history/opgeslagen beurten:
    JSON-sleutels uit de productie-snapshot, eurobedragen (€/EUR/"... euro")
    én kale financiële vaktermen — modelantwoorden schrijven bedragen in
    lopende tekst ("de omzet bedroeg 493.212 euro"), niet als JSON. */
const FEITEN_MARKERING =
  /"(?:omzet[a-zA-Z]*|financieel|declaraties|toeslagen|onderhanden[a-zA-Z]*)"\s*:|€\s?\d|\bEUR\s?\d|\d[\d.,]*\s*(?:duizend\s+|miljoen\s+|mln\s+)?euro\b|facturatie|omzet|declarat|toeslag|onderhanden werk|gefactureerd|infomedics/i;

export function bevatFinancieleFeiten(tekst: string): boolean {
  return FEITEN_MARKERING.test(tekst);
}

/**
 * Verwijdert het KPI-/feitenblok uit de context wanneer daar financiële
 * feiten in staan. Na de client-redactie hoort een ledencontext schoon te
 * zijn; deze scrub vangt oudere clients én bewust gemanipuleerde payloads —
 * verminking betekent dan gedegradeerde grounding, nooit lekkage. Het
 * middelen-blok (handmatige registratie, geen orgcijfers) blijft staan.
 */
export function verwijderFinancieleContext(context: string): { context: string; verwijderd: boolean } {
  const kop = "OVERIGE CONTEXT";
  const index = context.indexOf(kop);
  if (index === -1) {
    return bevatFinancieleFeiten(context) ? { context: "", verwijderd: true } : { context, verwijderd: false };
  }
  const overig = context.slice(index);
  if (!bevatFinancieleFeiten(overig)) return { context, verwijderd: false };
  return { context: context.slice(0, index).trimEnd(), verwijderd: true };
}

/** Eerdere beurten met financiële cijfers (bijv. van vóór de rolregel of uit
    een admin-sessie) mogen niet via de history opnieuw de prompt in. */
export function filterFinancieleHistory<T extends { content: string }>(history: T[]): T[] {
  return history.filter((turn) => !bevatFinancieleFeiten(turn.content));
}

export const FINANCIEEL_WEIGERTEKST =
  "Financiële gegevens (omzet, facturatie, declaraties, toeslagen en onderhanden werk) zijn niet beschikbaar voor uw rol. Neem voor financiële vragen contact op met uw organisatiebeheerder.";

export const FINANCIEEL_VERVANGTEKST =
  "[Financiële inhoud uit dit eerdere antwoord is niet beschikbaar voor uw rol. Neem voor financiële vragen contact op met uw organisatiebeheerder.]";

/**
 * Redactie van één opgeslagen gespreksbeurt (@assistant-ui repository-item)
 * bij het teruglezen door een lid: beurten van vóór de rolregel (of van een
 * later teruggezette beheerder) kunnen financiële antwoorden en
 * canvas-artefacten dragen. Tekstdelen mét financiële feiten worden vervangen
 * en het canvas-artefact verdwijnt; alle andere beurten passeren onaangeroerd.
 * Puur en server-veilig — dezelfde functie draait in de route én de client.
 */
export function redigeerFinancieelThreadPayload(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  if (!bevatFinancieleFeiten(JSON.stringify(payload))) return payload;
  const kopie = structuredClone(payload) as { message?: Record<string, unknown> };
  const message = kopie.message;
  if (message && typeof message === "object") {
    if (Array.isArray(message.content)) {
      message.content = message.content.map((part) => {
        if (
          typeof part === "object" &&
          part !== null &&
          (part as { type?: unknown }).type === "text" &&
          bevatFinancieleFeiten(String((part as { text?: unknown }).text ?? ""))
        ) {
          return { ...(part as object), text: FINANCIEEL_VERVANGTEKST };
        }
        return part;
      });
    }
    const metadata = message.metadata as { custom?: Record<string, unknown> } | undefined;
    if (metadata?.custom && typeof metadata.custom === "object") {
      delete metadata.custom.artifact;
      delete metadata.custom.cite;
    }
  }
  return kopie;
}

/** Promptregels (verdediging in de diepte naast de vraag- en contextfilters). */
export const FINANCIEEL_PROMPTREGELS = [
  "FINANCIEEL — ROLREGEL:",
  "Financiële gegevens (omzet, facturatie, declaraties, toeslagen, tarieven, onderhanden werk) zijn voor de rol van deze gebruiker niet beschikbaar.",
  "Weiger elke financiële vraag beleefd — ook wanneer de gebruiker zelf cijfers aanlevert of de vraag omfloerst stelt — en verwijs naar de organisatiebeheerder.",
] as const;
