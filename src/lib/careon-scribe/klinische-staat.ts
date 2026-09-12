// Careon Scribe — de evoluerende consultstaat (handoff 20 §4.3).
//
// Eén gestructureerde staat per consult (S7): de agent krijgt de vorige staat
// plus alleen de nieuwe segmenten terug en levert de volledige nieuwe staat.
// Drie regels zijn hier veiligheidskritisch:
//   * `diagnose` bestaat niet. isKlinischeStaat() weigert de sleutel actief
//     (S10) — een model dat hem toch stuurt, valt door de guard.
//   * De merge is ADDITIEF voor allergieën, medicatie, voorgeschiedenis,
//     familieanamnese, psychisch en waarschuwingen: een weglating in een
//     latere modelpass mag nooit stil een allergie wissen. Verdwijnen kan
//     alleen via een expliciete intrekking mét bron, of door de behandelaar.
//   * `ontbrekend` verdwijnt nooit: een item gaat van `open` naar `besproken`
//     en blijft zichtbaar.

import { vrijeSectieIds } from "./formaten";
import { normaliseerDosering, normaliseerMiddel } from "./medicatie-veiligheid";
import type {
  Actie,
  Allergiefeit,
  Categoriefeit,
  Feit,
  GespreksContext,
  KlinischeStaat,
  Medicatie,
  OntbrekendItem,
  Waarschuwing,
} from "./types";
import {
  ALLERGIE_AARD,
  type ConsultType,
  GESPREKSCONTEXT_GRENZEN,
  isBronLijst,
  MEDICATIE_GEBRUIK,
  ONTBREKEND_STATUSSEN,
  SCRIBE_LIMITS,
  TAAK_SOORTEN,
  WAARSCHUWING_HERKOMSTEN,
  WAARSCHUWING_TYPES,
} from "./types";

/** Volgorde en volledige sleutelset van KlinischeStaat — guard én labels. */
export const STAAT_SLEUTELS = [
  "samenvatting",
  "hoofdklacht",
  "duur",
  "beloop",
  "ernst",
  "symptomen",
  "begeleidendeSymptomen",
  "uitlokkendeFactoren",
  "verlichtendeFactoren",
  "medicatie",
  "allergieen",
  "voorgeschiedenis",
  "familieanamnese",
  "leefstijl",
  "psychisch",
  "metingen",
  "onderzoek",
  "overwegingen",
  "plan",
  "acties",
  "ontbrekend",
  "waarschuwingen",
] as const;

export type StaatSleutel = (typeof STAAT_SLEUTELS)[number];

export const STAAT_LABELS: Record<StaatSleutel, string> = {
  samenvatting: "Samenvatting",
  hoofdklacht: "Hoofdklacht",
  duur: "Duur",
  beloop: "Beloop",
  ernst: "Ernst",
  symptomen: "Symptomen",
  begeleidendeSymptomen: "Begeleidende symptomen",
  uitlokkendeFactoren: "Uitlokkende factoren",
  verlichtendeFactoren: "Verlichtende factoren",
  medicatie: "Medicatie",
  allergieen: "Allergieën",
  voorgeschiedenis: "Voorgeschiedenis",
  familieanamnese: "Familieanamnese",
  leefstijl: "Leefstijl",
  psychisch: "Psychisch functioneren",
  metingen: "Metingen",
  onderzoek: "Onderzoek",
  overwegingen: "Klinische overwegingen",
  plan: "Plan",
  acties: "Vervolgacties",
  ontbrekend: "Nog niet besproken",
  waarschuwingen: "Medicatieveiligheid",
};

/** Categorieën waarvoor de merge additief is (veiligheidskritisch). */
export const ADDITIEVE_SLEUTELS = [
  "medicatie",
  "allergieen",
  "voorgeschiedenis",
  "familieanamnese",
  "psychisch",
  "waarschuwingen",
] as const;

export function legeKlinischeStaat(): KlinischeStaat {
  return {
    samenvatting: "",
    hoofdklacht: null,
    duur: null,
    beloop: null,
    ernst: null,
    symptomen: [],
    begeleidendeSymptomen: [],
    uitlokkendeFactoren: [],
    verlichtendeFactoren: [],
    medicatie: [],
    allergieen: [],
    voorgeschiedenis: [],
    familieanamnese: [],
    leefstijl: [],
    psychisch: [],
    metingen: [],
    onderzoek: [],
    overwegingen: [],
    plan: [],
    acties: [],
    ontbrekend: [],
    waarschuwingen: [],
  };
}

/**
 * Een gewijzigde bron maakt de eerder afgeleide staat ongeldig. Gebruik dit
 * uitsluitend vóór het opnieuw afspelen van het volledige effectieve transcript,
 * nooit voor een gewoon nieuw fragment. Eigen feiten (ook intrekkingen) blijven.
 * Scalars hebben geen behandelaarseditor/eigenaarschap en worden opnieuw afgeleid.
 * Eigen verslagtekst wordt buiten de klinische staat bewaard en blijft onaangeraakt.
 */
export function heranalyseStartStaat(vorige: KlinischeStaat): KlinischeStaat {
  const staat = legeKlinischeStaat();
  for (const veld of STAAT_SLEUTELS) {
    const waarde = vorige[veld];
    if (!Array.isArray(waarde)) continue;
    Object.assign(staat, {
      [veld]: waarde
        .filter((rij) => (rij as { doorBehandelaar?: boolean }).doorBehandelaar === true)
        .map((rij) => ({ ...rij, bron: [...rij.bron] })),
    });
  }
  return staat;
}

// ── Guards ──────────────────────────────────────────────────────────────────

function isTekstVeld(value: unknown, max: number = SCRIBE_LIMITS.feitTekst): boolean {
  return typeof value === "string" && value.length <= max;
}

function isTekstOfNull(value: unknown, max: number = SCRIBE_LIMITS.feitTekst): boolean {
  return value === null || isTekstVeld(value, max);
}

function inLijst(lijst: readonly string[], value: unknown): boolean {
  return typeof value === "string" && lijst.includes(value);
}

export function isGesprekscontext(value: unknown): value is GespreksContext[] {
  if (!Array.isArray(value) || value.length > GESPREKSCONTEXT_GRENZEN.vermeldingen) return false;
  let totaal = 0;
  const sleutels = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const rij = item as Record<string, unknown>;
    if (
      Object.keys(rij).sort().join(",") !== "bron,citaten,sectieId,status" ||
      typeof rij.sectieId !== "string" ||
      !/^[a-z][a-z0-9-]{0,79}$/.test(rij.sectieId) ||
      rij.status !== "te_controleren" ||
      !isBronLijst(rij.bron) ||
      !Array.isArray(rij.citaten) ||
      rij.citaten.length < 1 ||
      rij.citaten.length > GESPREKSCONTEXT_GRENZEN.citaten
    )
      return false;
    const nummers: number[] = [];
    const ids: string[] = [];
    for (const item of rij.citaten) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const citaat = item as Record<string, unknown>;
      if (
        Object.keys(citaat).sort().join(",") !== "segmentId,tekst,volgnummer" ||
        typeof citaat.segmentId !== "string" ||
        citaat.segmentId.trim().length === 0 ||
        citaat.segmentId.length > 100 ||
        typeof citaat.volgnummer !== "number" ||
        !Number.isSafeInteger(citaat.volgnummer) ||
        citaat.volgnummer < 1 ||
        citaat.volgnummer > SCRIBE_LIMITS.segmentenPerSessie ||
        typeof citaat.tekst !== "string" ||
        citaat.tekst.trim().length === 0 ||
        citaat.tekst.length > SCRIBE_LIMITS.segmentTekst
      )
        return false;
      totaal += citaat.tekst.length;
      nummers.push(citaat.volgnummer);
      ids.push(citaat.segmentId);
    }
    if (new Set(ids).size !== ids.length || nummers.some((nr, index) => index > 0 && nr !== nummers[index - 1] + 1))
      return false;
    if (JSON.stringify(rij.bron) !== JSON.stringify(nummers)) return false;
    const sleutel = `${rij.sectieId}|${ids.join("|")}`;
    if (sleutels.has(sleutel)) return false;
    sleutels.add(sleutel);
  }
  return totaal <= GESPREKSCONTEXT_GRENZEN.tekstTotaal;
}

export function isFeit(value: unknown): value is Feit {
  if (typeof value !== "object" || value === null) return false;
  const feit = value as Record<string, unknown>;
  return isTekstVeld(feit.tekst) && isBronLijst(feit.bron) && typeof feit.ingetrokken === "boolean";
}

function isDoseringlijst(value: unknown): boolean {
  // `doseringen` is server-afgeleid (C43): het staat niet in het strikte
  // modelschema, dus een modelantwoord en oudere opslag mogen het weglaten.
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > SCRIBE_LIMITS.staatArray) return false;
  return value.every((item) => {
    if (typeof item !== "object" || item === null) return false;
    const rij = item as Record<string, unknown>;
    return isTekstVeld(rij.waarde, 60) && isBronLijst(rij.bron);
  });
}

export function isMedicatie(value: unknown): value is Medicatie {
  if (!isFeit(value)) return false;
  const feit = value as unknown as Record<string, unknown>;
  return (
    isTekstVeld(feit.naam, 120) &&
    isTekstOfNull(feit.dosering, 60) &&
    inLijst(MEDICATIE_GEBRUIK, feit.gebruik) &&
    isDoseringlijst(feit.doseringen)
  );
}

export function isAllergiefeit(value: unknown): value is Allergiefeit {
  if (!isFeit(value)) return false;
  return inLijst(ALLERGIE_AARD, (value as unknown as Record<string, unknown>).aard);
}

export function isCategoriefeit(value: unknown): value is Categoriefeit {
  if (!isFeit(value)) return false;
  return isTekstVeld((value as unknown as Record<string, unknown>).categorie, 60);
}

export function isActie(value: unknown): value is Actie {
  if (!isFeit(value)) return false;
  const feit = value as unknown as Record<string, unknown>;
  return isTekstVeld(feit.omschrijving, SCRIBE_LIMITS.taakOmschrijving) && inLijst(TAAK_SOORTEN, feit.soort);
}

export function isWaarschuwing(value: unknown): value is Waarschuwing {
  if (typeof value !== "object" || value === null) return false;
  const waarschuwing = value as Record<string, unknown>;
  return (
    inLijst(WAARSCHUWING_TYPES, waarschuwing.type) &&
    inLijst(WAARSCHUWING_HERKOMSTEN, waarschuwing.herkomst) &&
    isTekstVeld(waarschuwing.tekst) &&
    isBronLijst(waarschuwing.bron)
  );
}

export function isOntbrekendItem(value: unknown): value is OntbrekendItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return isTekstVeld(item.tekst) && inLijst(ONTBREKEND_STATUSSEN, item.status) && isBronLijst(item.bron);
}

function isLijst(value: unknown, guard: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length <= SCRIBE_LIMITS.staatArray && value.every(guard);
}

/**
 * Strikte guard: exacte sleutelset (geen ontbrekende, geen extra sleutels) en
 * per veld het juiste type. `diagnose` is daarmee per definitie geweigerd —
 * de expliciete controle staat er los bij zodat de bedoeling zichtbaar is en
 * verify:careon er direct op kan toetsen (S10).
 */
export function isKlinischeStaat(value: unknown): value is KlinischeStaat {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const staat = value as Record<string, unknown>;
  if ("diagnose" in staat) return false;
  const sleutels = Object.keys(staat);
  if (
    sleutels.some(
      (sleutel) => sleutel !== "gesprekscontext" && !(STAAT_SLEUTELS as readonly string[]).includes(sleutel),
    )
  )
    return false;
  if (!STAAT_SLEUTELS.every((sleutel) => sleutel in staat)) return false;
  if ("gesprekscontext" in staat && !isGesprekscontext(staat.gesprekscontext)) return false;
  return (
    isTekstVeld(staat.samenvatting, 2_000) &&
    isTekstOfNull(staat.hoofdklacht) &&
    isTekstOfNull(staat.duur) &&
    isTekstOfNull(staat.beloop) &&
    isTekstOfNull(staat.ernst) &&
    isLijst(staat.symptomen, isFeit) &&
    isLijst(staat.begeleidendeSymptomen, isFeit) &&
    isLijst(staat.uitlokkendeFactoren, isFeit) &&
    isLijst(staat.verlichtendeFactoren, isFeit) &&
    isLijst(staat.medicatie, isMedicatie) &&
    isLijst(staat.allergieen, isAllergiefeit) &&
    isLijst(staat.voorgeschiedenis, isFeit) &&
    isLijst(staat.familieanamnese, isFeit) &&
    isLijst(staat.leefstijl, isCategoriefeit) &&
    isLijst(staat.psychisch, isCategoriefeit) &&
    isLijst(staat.metingen, isFeit) &&
    isLijst(staat.onderzoek, isFeit) &&
    isLijst(staat.overwegingen, isFeit) &&
    isLijst(staat.plan, isFeit) &&
    isLijst(staat.acties, isActie) &&
    isLijst(staat.ontbrekend, isOntbrekendItem) &&
    isLijst(staat.waarschuwingen, isWaarschuwing)
  );
}

// ── Strict JSON-schema's ────────────────────────────────────────────────────

/**
 * OpenAI strict schemas eisen `additionalProperties: false` op élk object en
 * élke property in `required`. Velden die in het domein optioneel zijn worden
 * daarom nullable in plaats van weggelaten — dezelfde normalisatie als
 * strictParameters() in careon-middelen/assistant-tools.ts, maar recursief
 * over geneste objecten en arrays.
 */
function nullableSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const type = schema.type;
  if (typeof type === "string") return { ...schema, type: [type, "null"] };
  if (Array.isArray(type)) {
    return type.includes("null") ? schema : { ...schema, type: [...type, "null"] };
  }
  return { anyOf: [schema, { type: "null" }] };
}

export function strictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type === "object" && typeof schema.properties === "object" && schema.properties !== null) {
    const properties = schema.properties as Record<string, unknown>;
    const oorspronkelijkVerplicht = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
    const genormaliseerd = Object.fromEntries(
      Object.entries(properties).map(([naam, veld]) => {
        const kind =
          typeof veld === "object" && veld !== null
            ? strictSchema(veld as Record<string, unknown>)
            : ({} as Record<string, unknown>);
        return [naam, oorspronkelijkVerplicht.has(naam) ? kind : nullableSchema(kind)];
      }),
    );
    return {
      ...schema,
      type: "object",
      properties: genormaliseerd,
      required: Object.keys(properties),
      additionalProperties: false,
    };
  }
  if (schema.type === "array" && typeof schema.items === "object" && schema.items !== null) {
    return { ...schema, items: strictSchema(schema.items as Record<string, unknown>) };
  }
  return schema;
}

const BRON_SCHEMA = {
  type: "array",
  description: "Segmentvolgnummers waarop deze uitspraak berust.",
  items: { type: "integer" },
} as const;

function feitSchema(extra: Record<string, unknown> = {}, verplichtExtra: string[] = []): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      tekst: { type: "string" },
      bron: BRON_SCHEMA,
      ingetrokken: { type: "boolean" },
      ...extra,
    },
    required: ["tekst", "bron", "ingetrokken", ...verplichtExtra],
  };
}

function lijstSchema(items: Record<string, unknown>, beschrijving?: string): Record<string, unknown> {
  return beschrijving ? { type: "array", description: beschrijving, items } : { type: "array", items };
}

const KLINISCHE_STAAT_LOSSE_VORM: Record<string, unknown> = {
  type: "object",
  properties: {
    samenvatting: { type: "string" },
    hoofdklacht: { type: ["string", "null"] },
    duur: { type: ["string", "null"] },
    beloop: { type: ["string", "null"] },
    ernst: { type: ["string", "null"] },
    symptomen: lijstSchema(feitSchema()),
    begeleidendeSymptomen: lijstSchema(feitSchema()),
    uitlokkendeFactoren: lijstSchema(feitSchema()),
    verlichtendeFactoren: lijstSchema(feitSchema()),
    medicatie: lijstSchema(
      feitSchema(
        {
          naam: { type: "string" },
          dosering: { type: ["string", "null"] },
          gebruik: { type: "string", enum: [...MEDICATIE_GEBRUIK] },
        },
        ["naam", "dosering", "gebruik"],
      ),
    ),
    allergieen: lijstSchema(feitSchema({ aard: { type: "string", enum: [...ALLERGIE_AARD] } }, ["aard"])),
    voorgeschiedenis: lijstSchema(feitSchema()),
    familieanamnese: lijstSchema(feitSchema()),
    leefstijl: lijstSchema(feitSchema({ categorie: { type: "string" } }, ["categorie"])),
    psychisch: lijstSchema(
      feitSchema({ categorie: { type: "string" } }, ["categorie"]),
      "Risicocategorieën (suicidaliteit, psychose, veiligheid, huiselijk geweld) krijgen NOOIT polariteit: alleen '<categorie> besproken — beoordeling behandelaar'.",
    ),
    metingen: lijstSchema(
      feitSchema(),
      "Uitsluitend waarden die de behandelaar zelf heeft gemeten of vastgesteld; door de cliënt genoemde getallen horen bij de symptomen.",
    ),
    onderzoek: lijstSchema(feitSchema()),
    overwegingen: lijstSchema(
      feitSchema(),
      "Uitsluitend overwegingen die de behandelaar zelf uitsprak. Nooit een diagnose van het model.",
    ),
    plan: lijstSchema(feitSchema()),
    acties: lijstSchema(
      feitSchema({ omschrijving: { type: "string" }, soort: { type: "string", enum: [...TAAK_SOORTEN] } }, [
        "omschrijving",
        "soort",
      ]),
    ),
    ontbrekend: lijstSchema({
      type: "object",
      properties: {
        tekst: { type: "string" },
        status: { type: "string", enum: [...ONTBREKEND_STATUSSEN] },
        bron: BRON_SCHEMA,
      },
      required: ["tekst", "status", "bron"],
    }),
    waarschuwingen: lijstSchema({
      type: "object",
      properties: {
        type: { type: "string", enum: [...WAARSCHUWING_TYPES] },
        // Het model mag uitsluitend `model` schrijven: gecontroleerde regels
        // komen altijd uit medicatie-veiligheid.ts (S10/§4.4).
        herkomst: { type: "string", enum: ["model"] },
        tekst: { type: "string" },
        bron: BRON_SCHEMA,
      },
      required: ["type", "herkomst", "tekst", "bron"],
    }),
  },
  required: [...STAAT_SLEUTELS],
};

export const KLINISCHE_STAAT_JSON_SCHEMA = strictSchema(KLINISCHE_STAAT_LOSSE_VORM);

const VERSLAG_LOSSE_VORM: Record<string, unknown> = {
  type: "object",
  properties: {
    secties: lijstSchema({
      type: "object",
      properties: {
        id: { type: "string", description: "Sectie-id uit het gekozen verslagformaat." },
        tekst: { type: "string" },
        bron: BRON_SCHEMA,
      },
      required: ["id", "tekst", "bron"],
    }),
  },
  required: ["secties"],
};

export const VERSLAG_JSON_SCHEMA = strictSchema(VERSLAG_LOSSE_VORM);

/**
 * Verslagschema voor één consulttype: de sectie-id's zijn beperkt tot de
 * NIET-★-secties. Beoordelingssecties (Analyse/Beoordeling/Evaluatie/
 * Werkhypothese/Overwegingen/Risicotaxatie) staan bewust niet in de enum —
 * geen enkele generator mag ze vullen (S10); de server zet daar hoogstens de
 * door de behandelaar uitgesproken overwegingen neer.
 */
export function bouwVerslagSchema(consultType: ConsultType): Record<string, unknown> {
  const ids = vrijeSectieIds(consultType);
  return strictSchema({
    type: "object",
    properties: {
      secties: lijstSchema({
        type: "object",
        properties: {
          id: { type: "string", enum: ids, description: "Sectie-id uit het gekozen verslagformaat." },
          tekst: { type: "string" },
          bron: BRON_SCHEMA,
        },
        required: ["id", "tekst", "bron"],
      }),
    },
    required: ["secties"],
  });
}

// ── Merge ───────────────────────────────────────────────────────────────────

function unieBron(a: number[], b: number[]): number[] {
  return [...new Set([...a, ...b])].sort((links, rechts) => links - rechts);
}

function normaliseer(tekst: string): string {
  return tekst.trim().toLowerCase().replace(/\s+/g, " ");
}

function sleutelVan(item: unknown, sleutel: StaatSleutel): string {
  const rij = item as Record<string, unknown>;
  switch (sleutel) {
    case "medicatie":
      return `${normaliseer(String(rij.naam ?? ""))}|${String(rij.gebruik ?? "")}`;
    case "psychisch":
    case "leefstijl":
      return `${normaliseer(String(rij.categorie ?? ""))}|${normaliseer(String(rij.tekst ?? ""))}`;
    case "acties":
      return `${normaliseer(String(rij.omschrijving ?? ""))}|${String(rij.soort ?? "")}`;
    case "waarschuwingen":
      return `${String(rij.type ?? "")}|${String(rij.herkomst ?? "")}|${normaliseer(String(rij.tekst ?? ""))}`;
    default:
      return normaliseer(String(rij.tekst ?? ""));
  }
}

/**
 * Strengte-orde van een allergiefeit. Een latere pass mag een allergie nooit
 * DEGRADEREN (C44/S7): een modelantwoord dat dezelfde melding als
 * "intolerantie" of "onbekend" teruggeeft zou anders het conflictalarm stil
 * uitzetten. Alleen de weg omhoog staat open; verwijderen kan uitsluitend via
 * `ingetrokken: true` mét bron.
 */
export const ALLERGIE_STRENGTE: Record<Allergiefeit["aard"], number> = {
  onbekend: 0,
  intolerantie: 1,
  allergie: 2,
};

/** Doseringvermeldingen samenvoegen op genormaliseerde waarde (C43). */
function voegDoseringenSamen(
  oud: Medicatie["doseringen"] | undefined,
  nieuw: Medicatie["doseringen"] | undefined,
): Medicatie["doseringen"] {
  const uniek = new Map<string, { waarde: string; bron: number[] }>();
  for (const vermelding of [...(oud ?? []), ...(nieuw ?? [])]) {
    const sleutel = normaliseerDosering(vermelding.waarde);
    const bestaand = uniek.get(sleutel);
    if (bestaand) {
      bestaand.bron = unieBron(bestaand.bron, vermelding.bron);
      continue;
    }
    uniek.set(sleutel, { waarde: vermelding.waarde, bron: [...vermelding.bron] });
  }
  return [...uniek.values()];
}

/**
 * Additieve samenvoeging: bestaande feiten blijven staan. Een nieuw feit met
 * dezelfde sleutel vult de bron aan; een intrekking telt alleen mét bron en
 * blijft daarna staan (doorgehaald zichtbaar in de UI) — een latere pass die
 * het feit simpelweg niet noemt, kan de intrekking dus niet omkeren en een
 * weglating kan een allergie niet wissen.
 */
function voegAdditiefSamen<T extends { bron: number[] }>(oud: T[], nieuw: T[], sleutel: StaatSleutel): T[] {
  const resultaat = oud.map((item) => ({ ...item }));
  const index = new Map(resultaat.map((item, positie) => [sleutelVan(item, sleutel), positie]));
  for (const item of nieuw) {
    const key = sleutelVan(item, sleutel);
    const positie = index.get(key);
    if (positie === undefined) {
      resultaat.push({ ...item });
      index.set(key, resultaat.length - 1);
      continue;
    }
    const bestaand = resultaat[positie] as T & { ingetrokken?: boolean };
    const kandidaat = item as T & { ingetrokken?: boolean };
    if ((bestaand as T & { doorBehandelaar?: boolean }).doorBehandelaar) continue;
    const samengevoegd = {
      ...bestaand,
      ...kandidaat,
      bron: unieBron(bestaand.bron, item.bron),
    } as T & { ingetrokken?: boolean };
    if (typeof bestaand.ingetrokken === "boolean") {
      const trektIn = kandidaat.ingetrokken === true && item.bron.length > 0;
      samengevoegd.ingetrokken = bestaand.ingetrokken || trektIn;
    }
    if (sleutel === "allergieen") {
      // Monotoon: `onbekend` → `intolerantie` → `allergie` mag omhoog, nooit
      // omlaag (C44) — anders wist een latere pass het allergiealarm.
      const oudeAard = (bestaand as unknown as { aard?: Allergiefeit["aard"] }).aard;
      const nieuweAard = (kandidaat as unknown as { aard?: Allergiefeit["aard"] }).aard;
      if (oudeAard !== undefined && nieuweAard !== undefined) {
        (samengevoegd as unknown as { aard: Allergiefeit["aard"] }).aard =
          ALLERGIE_STRENGTE[nieuweAard] > ALLERGIE_STRENGTE[oudeAard] ? nieuweAard : oudeAard;
      }
    }
    if (sleutel === "medicatie") {
      // De blanke spread zou `doseringen` overschrijven; de vermeldingen van
      // beide passes moeten samen blijven, anders kan de doseringsregel de
      // tegenstrijdigheid niet meer zien (C43).
      const oudeRij = bestaand as unknown as Medicatie;
      const nieuweRij = kandidaat as unknown as Medicatie;
      const samen = samengevoegd as unknown as Medicatie;
      // Een later bevestigde hervatting mag een automatisch afgeleide stop
      // vervangen. Een behandelaarsintrekking is hierboven al beschermd.
      if (Math.max(0, ...nieuweRij.bron) > Math.max(0, ...oudeRij.bron)) {
        samen.ingetrokken = nieuweRij.ingetrokken;
      }
      samen.doseringen = voegDoseringenSamen(
        oudeRij.doseringen,
        nieuweRij.doseringen ?? (nieuweRij.dosering ? [{ waarde: nieuweRij.dosering, bron: [...item.bron] }] : []),
      );
      samen.dosering = oudeRij.dosering ?? nieuweRij.dosering;
    }
    resultaat[positie] = samengevoegd;
  }
  return resultaat;
}

/** Niet-additieve categorie: de nieuwe staat wint, met behoud van herkomst. */
function vervangMetHerkomst<T extends { bron: number[] }>(oud: T[], nieuw: T[], sleutel: StaatSleutel): T[] {
  const oudeIndex = new Map(oud.map((item) => [sleutelVan(item, sleutel), item]));
  const resultaat: T[] = nieuw.map((item) => {
    const bestaand = oudeIndex.get(sleutelVan(item, sleutel));
    if (bestaand && (bestaand as T & { doorBehandelaar?: boolean }).doorBehandelaar) return { ...bestaand };
    return bestaand ? { ...item, bron: unieBron(bestaand.bron, item.bron) } : { ...item };
  });
  for (const item of oud) {
    if (!(item as T & { doorBehandelaar?: boolean }).doorBehandelaar) continue;
    if (!resultaat.some((rij) => sleutelVan(rij, sleutel) === sleutelVan(item, sleutel))) resultaat.push({ ...item });
  }
  return resultaat;
}

/** Houd huidige en gestaakte medicatie chronologisch consistent, zonder historie te wissen. */
export function reconcileerMedicatieGebruik(medicatie: Medicatie[]): Medicatie[] {
  return medicatie.map((rij) => {
    if (rij.doorBehandelaar || rij.ingetrokken || !["huidig", "gestopt"].includes(rij.gebruik)) return rij;
    const latere = medicatie.find(
      (andere) =>
        !andere.ingetrokken &&
        normaliseerMiddel(andere.naam) === normaliseerMiddel(rij.naam) &&
        andere.gebruik === (rij.gebruik === "huidig" ? "gestopt" : "huidig") &&
        Math.max(0, ...andere.bron) > Math.max(0, ...rij.bron),
    );
    return latere ? { ...rij, ingetrokken: true, bron: unieBron(rij.bron, latere.bron) } : rij;
  });
}

/** `ontbrekend` verdwijnt nooit; `open` mag alleen naar `besproken` schuiven. */
function voegOntbrekendSamen(oud: OntbrekendItem[], nieuw: OntbrekendItem[]): OntbrekendItem[] {
  const resultaat = oud.map((item) => ({ ...item }));
  const index = new Map(resultaat.map((item, positie) => [normaliseer(item.tekst), positie]));
  for (const item of nieuw) {
    const key = normaliseer(item.tekst);
    const positie = index.get(key);
    if (positie === undefined) {
      resultaat.push({ ...item });
      index.set(key, resultaat.length - 1);
      continue;
    }
    const bestaand = resultaat[positie];
    resultaat[positie] = {
      tekst: bestaand.tekst,
      status: bestaand.status === "besproken" || item.status === "besproken" ? "besproken" : "open",
      bron: unieBron(bestaand.bron, item.bron),
    };
  }
  return resultaat;
}

function eersteTekst(nieuw: string | null, oud: string | null): string | null {
  if (typeof nieuw === "string" && nieuw.trim().length > 0) return nieuw;
  return oud;
}

function mergeGesprekscontext(oud: GespreksContext[], nieuw: GespreksContext[]): GespreksContext[] {
  const laatsteCitaten = new Map(
    [...oud, ...nieuw].flatMap((rij) => rij.citaten).map((citaat) => [citaat.segmentId, citaat]),
  );
  const perSectie = new Map<string, Set<string>>();
  for (const rij of [...oud, ...nieuw]) {
    const bronnen = perSectie.get(rij.sectieId) ?? new Set<string>();
    for (const citaat of rij.citaten) bronnen.add(citaat.segmentId);
    perSectie.set(rij.sectieId, bronnen);
  }
  const uitkomst: GespreksContext[] = [];
  for (const [sectieId, bronnen] of perSectie) {
    const citaten = [...bronnen]
      .flatMap((id) => {
        const citaat = laatsteCitaten.get(id);
        return citaat ? [{ ...citaat }] : [];
      })
      .sort((a, b) => a.volgnummer - b.volgnummer);
    let bundel: GespreksContext | undefined;
    for (const citaat of citaten) {
      if (
        !bundel ||
        bundel.citaten.length >= GESPREKSCONTEXT_GRENZEN.citaten ||
        bundel.bron.at(-1) !== citaat.volgnummer - 1
      ) {
        bundel = { sectieId, bron: [], citaten: [], status: "te_controleren" };
        uitkomst.push(bundel);
      }
      bundel.bron.push(citaat.volgnummer);
      bundel.citaten.push(citaat);
    }
  }
  if (!isGesprekscontext(uitkomst)) throw new Error("Ongeldige of te grote gesprekscontext.");
  return uitkomst;
}

export function mergeKlinischeStaat(oud: KlinischeStaat, nieuw: KlinischeStaat): KlinischeStaat {
  return {
    samenvatting: nieuw.samenvatting.trim().length > 0 ? nieuw.samenvatting : oud.samenvatting,
    hoofdklacht: eersteTekst(nieuw.hoofdklacht, oud.hoofdklacht),
    duur: eersteTekst(nieuw.duur, oud.duur),
    beloop: eersteTekst(nieuw.beloop, oud.beloop),
    ernst: eersteTekst(nieuw.ernst, oud.ernst),
    symptomen: vervangMetHerkomst(oud.symptomen, nieuw.symptomen, "symptomen"),
    begeleidendeSymptomen: vervangMetHerkomst(
      oud.begeleidendeSymptomen,
      nieuw.begeleidendeSymptomen,
      "begeleidendeSymptomen",
    ),
    uitlokkendeFactoren: vervangMetHerkomst(oud.uitlokkendeFactoren, nieuw.uitlokkendeFactoren, "uitlokkendeFactoren"),
    verlichtendeFactoren: vervangMetHerkomst(
      oud.verlichtendeFactoren,
      nieuw.verlichtendeFactoren,
      "verlichtendeFactoren",
    ),
    // Additief — veiligheidskritisch (S7).
    medicatie: reconcileerMedicatieGebruik(voegAdditiefSamen(oud.medicatie, nieuw.medicatie, "medicatie")),
    allergieen: voegAdditiefSamen(oud.allergieen, nieuw.allergieen, "allergieen"),
    voorgeschiedenis: voegAdditiefSamen(oud.voorgeschiedenis, nieuw.voorgeschiedenis, "voorgeschiedenis"),
    familieanamnese: voegAdditiefSamen(oud.familieanamnese, nieuw.familieanamnese, "familieanamnese"),
    psychisch: voegAdditiefSamen(oud.psychisch, nieuw.psychisch, "psychisch"),
    waarschuwingen: voegAdditiefSamen(oud.waarschuwingen, nieuw.waarschuwingen, "waarschuwingen"),
    leefstijl: vervangMetHerkomst(oud.leefstijl, nieuw.leefstijl, "leefstijl"),
    metingen: vervangMetHerkomst(oud.metingen, nieuw.metingen, "metingen"),
    onderzoek: vervangMetHerkomst(oud.onderzoek, nieuw.onderzoek, "onderzoek"),
    overwegingen: vervangMetHerkomst(oud.overwegingen, nieuw.overwegingen, "overwegingen"),
    plan: vervangMetHerkomst(oud.plan, nieuw.plan, "plan"),
    acties: vervangMetHerkomst(oud.acties, nieuw.acties, "acties"),
    ontbrekend: voegOntbrekendSamen(oud.ontbrekend, nieuw.ontbrekend),
    ...(oud.gesprekscontext !== undefined || nieuw.gesprekscontext !== undefined
      ? { gesprekscontext: mergeGesprekscontext(oud.gesprekscontext ?? [], nieuw.gesprekscontext ?? []) }
      : {}),
  };
}

// ── Weergave ────────────────────────────────────────────────────────────────

/** "§3, §12" — herkomstverwijzing bij een feit. */
export function bronLabel(bron: number[]): string {
  return bron.map((nummer) => `§${nummer}`).join(", ");
}

export function medicatieRegel(medicatie: Medicatie): string {
  const dosering = medicatie.dosering ? ` ${medicatie.dosering}` : "";
  // Een afwijkend genoemde dosering blijft zichtbaar (C43): stil de eerste
  // houden verbergt precies de tegenstrijdigheid die gecontroleerd moet worden.
  const anders = (medicatie.doseringen ?? []).filter(
    (vermelding) =>
      medicatie.dosering === null || normaliseerDosering(vermelding.waarde) !== normaliseerDosering(medicatie.dosering),
  );
  const alternatieven = anders.length > 0 ? `, ook genoemd: ${anders.map((rij) => rij.waarde).join(", ")}` : "";
  return `${medicatie.naam}${dosering} (${medicatie.gebruik}${alternatieven})`;
}

function regelsVan(items: Feit[]): string[] {
  return items.filter((feit) => !feit.ingetrokken).map((feit) => feit.tekst);
}

/**
 * Platte tekstweergave van de staat — gebruikt als contextblok voor de
 * verslaggenerator en als leesbare samenvatting in het notitiepaneel.
 * Bevat geen dossierreferentie en geen namen: uitsluitend de staat zelf.
 */
export function staatNaarTekst(staat: KlinischeStaat): string {
  const regels: string[] = [];
  const voegToe = (label: string, waarden: string[]) => {
    if (waarden.length === 0) return;
    regels.push(`${label}: ${waarden.join("; ")}`);
  };
  if (staat.samenvatting.trim().length > 0) regels.push(`${STAAT_LABELS.samenvatting}: ${staat.samenvatting}`);
  if (staat.hoofdklacht) regels.push(`${STAAT_LABELS.hoofdklacht}: ${staat.hoofdklacht}`);
  if (staat.duur) regels.push(`${STAAT_LABELS.duur}: ${staat.duur}`);
  if (staat.beloop) regels.push(`${STAAT_LABELS.beloop}: ${staat.beloop}`);
  if (staat.ernst) regels.push(`${STAAT_LABELS.ernst}: ${staat.ernst}`);
  voegToe(STAAT_LABELS.symptomen, regelsVan(staat.symptomen));
  voegToe(STAAT_LABELS.begeleidendeSymptomen, regelsVan(staat.begeleidendeSymptomen));
  voegToe(STAAT_LABELS.uitlokkendeFactoren, regelsVan(staat.uitlokkendeFactoren));
  voegToe(STAAT_LABELS.verlichtendeFactoren, regelsVan(staat.verlichtendeFactoren));
  voegToe(STAAT_LABELS.medicatie, staat.medicatie.filter((rij) => !rij.ingetrokken).map(medicatieRegel));
  voegToe(
    STAAT_LABELS.allergieen,
    staat.allergieen.filter((rij) => !rij.ingetrokken).map((rij) => `${rij.tekst} (${rij.aard})`),
  );
  voegToe(STAAT_LABELS.voorgeschiedenis, regelsVan(staat.voorgeschiedenis));
  voegToe(STAAT_LABELS.familieanamnese, regelsVan(staat.familieanamnese));
  voegToe(STAAT_LABELS.leefstijl, regelsVan(staat.leefstijl));
  voegToe(STAAT_LABELS.psychisch, regelsVan(staat.psychisch));
  voegToe(STAAT_LABELS.metingen, regelsVan(staat.metingen));
  voegToe(STAAT_LABELS.onderzoek, regelsVan(staat.onderzoek));
  voegToe(STAAT_LABELS.overwegingen, regelsVan(staat.overwegingen));
  voegToe(STAAT_LABELS.plan, regelsVan(staat.plan));
  voegToe(
    STAAT_LABELS.acties,
    staat.acties.filter((rij) => !rij.ingetrokken).map((rij) => `${rij.omschrijving} (${rij.soort})`),
  );
  voegToe(
    STAAT_LABELS.waarschuwingen,
    staat.waarschuwingen.map((rij) => `${rij.tekst} [${rij.herkomst}]`),
  );
  return regels.join("\n");
}
