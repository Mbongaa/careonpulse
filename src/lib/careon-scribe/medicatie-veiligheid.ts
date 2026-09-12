// Careon Scribe — deterministische medicatieveiligheid (handoff 20 §4.4).
//
// Deze laag draait ALTIJD, ook zonder AI (S11). De tabellen zijn gecureerd
// (Nederlandse generieke namen plus gangbare merknamen) en bewust beperkt:
// maximumdoseringen ontbreken omdat daarvoor een geverifieerde bron
// (G-Standaard/Farmacotherapeutisch Kompas) nodig is — dat is fase 2 (§10).
//
// Elke uitkomst draagt `herkomst: "regel"`. De UI toont die groep gescheiden
// van AI-signalen (`herkomst: "model"`): een modelsignaal mag nooit als
// gecontroleerde regel worden gepresenteerd.

import type { Allergiefeit, Medicatie, Waarschuwing } from "./types";

/** Slot van elke waarschuwingstekst — beslissingsondersteuning, geen oordeel. */
export const CONTROLE_SLOT = "Controleer vóór voorschrijven.";

/** Verbatim uit §4.4: een intolerantie is nooit een allergieconflict. */
export const INTOLERANTIE_TEKST = `Gemelde intolerantie — geen allergie. ${CONTROLE_SLOT}`;

/**
 * §4.4-lijn doorgetrokken (C45): een gemelde overgevoeligheid waarvan de aard
 * niet is vastgesteld krijgt géén allergieoordeel, maar verdwijnt evenmin —
 * juist daar wil de behandelaar het vóór voorschrijven navragen.
 */
export const ONBEKENDE_AARD_TEKST = `Gemelde overgevoeligheid, aard onbekend — geen allergieoordeel. ${CONTROLE_SLOT}`;

/**
 * Achtervoegsel waarmee de deterministische laag een ONTKENDE allergie
 * vastlegt (C39: "Ik ben niet allergisch voor penicilline"). Zo'n rij blijft
 * zichtbaar in de staat en houdt het checklist-item op `besproken`, maar mag
 * nooit een regelwaarschuwing voeden.
 */
export const ALLERGIE_ONTKEND_SUFFIX = " — allergie ontkend";

export interface MiddelGroep {
  /** Weergavenaam in de waarschuwingstekst. */
  label: string;
  /** Termen waarmee een allergietekst deze groep noemt (naast de leden). */
  aliassen: readonly string[];
  leden: readonly string[];
}

/**
 * Allergiegroepen. Een allergietekst wordt opgelost naar een groep wanneer hij
 * de GROEPSNAAM (alias) óf een LID bevat; een treffer op het middel zelf
 * waarschuwt eveneens.
 */
export const ALLERGIEGROEPEN = {
  penicillinen: {
    label: "penicillinen",
    aliassen: ["penicilline", "penicillinen", "betalactam", "bètalactam"],
    leden: [
      "amoxicilline",
      "amoxicilline/clavulaanzuur",
      "augmentin",
      "flucloxacilline",
      "feneticilline",
      "benzylpenicilline",
      "piperacilline",
    ],
  },
  sulfonamiden: {
    label: "sulfonamiden",
    aliassen: ["sulfa", "sulfonamide", "sulfonamiden"],
    leden: ["cotrimoxazol", "sulfamethoxazol"],
  },
  nsaid: {
    label: "NSAID",
    aliassen: ["nsaid", "nsaids", "prostaglandinesyntheseremmer"],
    leden: ["ibuprofen", "naproxen", "diclofenac", "meloxicam", "celecoxib"],
  },
  salicylaten: {
    label: "salicylaten",
    aliassen: ["salicylaat", "salicylaten"],
    leden: ["acetylsalicylzuur", "aspirine", "carbasalaatcalcium"],
  },
  opioiden: {
    label: "opioïden",
    aliassen: ["opioide", "opioiden", "opiaat", "opiaten"],
    leden: ["morfine", "oxycodon", "tramadol", "fentanyl", "codeïne"],
  },
} as const satisfies Record<string, MiddelGroep>;

export type AllergieGroepNaam = keyof typeof ALLERGIEGROEPEN;

/** Kruisallergie: wie NSAID niet verdraagt, wordt ook op salicylaten gewezen. */
export const KRUISVERWIJZINGEN: Record<string, readonly AllergieGroepNaam[]> = {
  nsaid: ["salicylaten"],
  salicylaten: ["nsaid"],
};

/** Farmacologische groepen voor interacties en dubbelmedicatie. */
export const MIDDEL_GROEPEN = {
  ssri_snri: {
    label: "SSRI/SNRI",
    aliassen: ["ssri", "snri"],
    leden: [
      "sertraline",
      "citalopram",
      "escitalopram",
      "paroxetine",
      "fluoxetine",
      "fluvoxamine",
      "venlafaxine",
      "duloxetine",
    ],
  },
  benzodiazepinen: {
    label: "benzodiazepinen",
    aliassen: ["benzodiazepine", "benzodiazepinen", "benzo"],
    leden: ["diazepam", "oxazepam", "lorazepam", "temazepam"],
  },
  opioiden: ALLERGIEGROEPEN.opioiden,
  nsaid: ALLERGIEGROEPEN.nsaid,
  salicylaten: ALLERGIEGROEPEN.salicylaten,
  penicillinen: ALLERGIEGROEPEN.penicillinen,
  sulfonamiden: ALLERGIEGROEPEN.sulfonamiden,
  antipsychotica: {
    label: "antipsychotica",
    aliassen: ["antipsychoticum", "antipsychotica"],
    leden: [
      "haloperidol",
      "olanzapine",
      "quetiapine",
      "risperidon",
      "aripiprazol",
      "clozapine",
      // Depotvormen (N5): in de ambulante GGZ het gangbare toedieningspad.
      "paliperidon",
      "paliperidonpalmitaat",
      "zuclopentixol",
      "zuclopentixoldecanoaat",
      "flupentixol",
      "flupentixoldecanoaat",
      "haloperidoldecanoaat",
    ],
  },
  // N5 — TCA's stonden wél in BEKENDE_MIDDELEN maar in geen enkele groep, dus
  // leverden nooit een dubbel- of interactiesignaal met een SSRI.
  tca: {
    label: "tricyclische antidepressiva",
    aliassen: ["tca", "tricyclisch", "tricyclische antidepressiva"],
    leden: ["amitriptyline", "nortriptyline", "clomipramine", "imipramine", "doxepine"],
  },
  stemmingsstabilisatoren: {
    label: "stemmingsstabilisatoren",
    aliassen: ["stemmingsstabilisator", "stemmingsstabilisatoren"],
    leden: ["lithium", "valproinezuur", "valproaat", "natriumvalproaat", "lamotrigine", "carbamazepine"],
  },
  stimulantia: {
    label: "stimulantia",
    aliassen: ["stimulantia", "stimulantium"],
    leden: ["methylfenidaat", "dexamfetamine", "lisdexamfetamine"],
  },
  mao_remmers: {
    label: "MAO-remmers",
    aliassen: ["mao-remmer", "mao-remmers", "maoi"],
    leden: ["fenelzine", "tranylcypromine", "moclobemide", "selegiline", "rasagiline"],
  },
  qt_verlengend: {
    label: "QT-verlengende middelen",
    aliassen: ["qt-verlengend"],
    leden: [
      "citalopram",
      "escitalopram",
      "haloperidol",
      "methadon",
      "domperidon",
      // N5 — TCA's zijn klassiek QT-verlengend (FK: tricyclische antidepressiva).
      "amitriptyline",
      "nortriptyline",
      "clomipramine",
      "imipramine",
      "doxepine",
    ],
  },
  serotonerg_risico: {
    label: "serotonerge middelen",
    aliassen: [],
    leden: ["tramadol", "sint-janskruid", "lithium", "fenelzine", "tranylcypromine", "moclobemide", "linezolid"],
  },
  ace_en_diuretica: {
    label: "ACE-remmers/diuretica",
    aliassen: ["ace-remmer"],
    leden: ["enalapril", "lisinopril", "perindopril", "hydrochloorthiazide"],
  },
  cumarines: {
    label: "cumarinederivaten",
    aliassen: ["cumarine", "cumarinederivaat"],
    leden: ["acenocoumarol", "fenprocoumon"],
  },
} as const satisfies Record<string, MiddelGroep>;

export type MiddelGroepNaam = keyof typeof MIDDEL_GROEPEN;

/** Alle middelnamen die de deterministische extractie herkent (§4.5). */
export const BEKENDE_MIDDELEN: readonly string[] = [
  ...new Set(
    Object.values(MIDDEL_GROEPEN)
      .flatMap((groep) => groep.leden as readonly string[])
      .concat([
        "lithium",
        "methotrexaat",
        "carbamazepine",
        "cotrimoxazol",
        "paracetamol",
        "metformine",
        "levothyroxine",
        "melatonine",
        "mirtazapine",
        "nortriptyline",
        "amitriptyline",
        "pantoprazol",
        "omeprazol",
        "prednison",
        "salbutamol",
        "simvastatine",
        "atorvastatine",
        "metoprolol",
        "bisoprolol",
        "amlodipine",
        "sint-janskruid",
        "methadon",
        "domperidon",
        "hydroxyzine",
        "promethazine",
        "biperideen",
        "naltrexon",
        "acamprosaat",
        "disulfiram",
      ]),
  ),
];

export interface InteractieRegel {
  id: string;
  links: readonly string[];
  rechts: readonly string[];
  /** Leden van één groep onderling (bijv. QT-verlenging). */
  onderling?: true;
  tekst: string;
}

function leden(groep: MiddelGroepNaam): readonly string[] {
  return MIDDEL_GROEPEN[groep].leden;
}

export const INTERACTIE_REGELS: readonly InteractieRegel[] = [
  {
    id: "serotonerg",
    links: leden("ssri_snri"),
    rechts: leden("serotonerg_risico"),
    tekst: "verhoogd risico op serotonerge toxiciteit (serotoninesyndroom).",
  },
  {
    id: "lithium-spiegel",
    links: ["lithium"],
    rechts: [...leden("nsaid"), ...leden("ace_en_diuretica")],
    tekst: "de lithiumspiegel kan stijgen; spiegelcontrole nodig.",
  },
  {
    id: "benzo-opioid",
    links: leden("benzodiazepinen"),
    rechts: leden("opioiden"),
    tekst: "versterkte sedatie en ademhalingsdepressie.",
  },
  {
    id: "methotrexaat-nsaid",
    links: ["methotrexaat"],
    rechts: leden("nsaid"),
    tekst: "verhoogde methotrexaattoxiciteit.",
  },
  {
    id: "cumarine-bloeding",
    links: leden("cumarines"),
    rechts: [...leden("nsaid"), "cotrimoxazol"],
    tekst: "verhoogd bloedingsrisico; INR-controle nodig.",
  },
  {
    id: "clozapine-carbamazepine",
    links: ["clozapine"],
    rechts: ["carbamazepine"],
    tekst: "verhoogd risico op beenmergdepressie en een lagere clozapinespiegel.",
  },
  {
    id: "qt-onderling",
    links: leden("qt_verlengend"),
    rechts: leden("qt_verlengend"),
    onderling: true,
    tekst: "additief QT-verlengend effect.",
  },
  // ── GGZ-kern (N5) ────────────────────────────────────────────────────────
  // Bron per regel: Farmacotherapeutisch Kompas (FK), interactiehoofdstuk, en
  // de G-Standaard-interactiecategorieën. De tabel blijft gecureerd en
  // beperkt: maximumdoseringen en spiegelgrenzen vragen een geverifieerde
  // bron en zijn fase 2 (§10).
  {
    // Bron: FK lamotrigine — valproaat remt de glucuronidering.
    id: "lamotrigine-valproaat",
    links: ["lamotrigine"],
    rechts: ["valproaat", "valproinezuur", "natriumvalproaat"],
    tekst: "de lamotriginespiegel stijgt sterk; risico op ernstige huidreacties, halveer de opbouw.",
  },
  {
    // Bron: FK lithium — carbamazepine geeft neurotoxiciteit bij normale spiegel.
    id: "lithium-carbamazepine",
    links: ["lithium"],
    rechts: ["carbamazepine"],
    tekst: "verhoogd risico op neurotoxiciteit, ook bij een normale lithiumspiegel.",
  },
  {
    // Bron: FK clozapine — gecombineerde sedatie/ademdepressie, cave collaps.
    id: "clozapine-benzo",
    links: ["clozapine"],
    rechts: leden("benzodiazepinen"),
    tekst: "risico op ernstige sedatie, ademhalingsdepressie en collaps.",
  },
  {
    // Bron: FK SSRI — trombocytenaggregatieremming plus NSAID/salicylaat.
    id: "ssri-nsaid",
    links: leden("ssri_snri"),
    rechts: [...leden("nsaid"), ...leden("salicylaten")],
    tekst: "verhoogd risico op maagdarmbloeding; overweeg maagbescherming.",
  },
  {
    // Bron: FK cumarinederivaten — versterkt bloedingsrisico met SSRI/SNRI.
    id: "ssri-cumarine",
    links: leden("ssri_snri"),
    rechts: leden("cumarines"),
    tekst: "verhoogd bloedingsrisico; INR-controle nodig.",
  },
  {
    // Bron: FK MAO-remmers — absolute contra-indicatie met sympathicomimetica.
    id: "stimulantia-mao",
    links: leden("stimulantia"),
    rechts: leden("mao_remmers"),
    tekst: "risico op hypertensieve crisis; combinatie is gecontra-indiceerd.",
  },
  {
    // Bron: FK TCA — remming van het metabolisme plus serotonerge belasting.
    id: "tca-ssri",
    links: leden("tca"),
    rechts: leden("ssri_snri"),
    tekst: "de spiegel van het tricyclische middel stijgt en de serotonerge belasting neemt toe.",
  },
  {
    // Bron: FK MAO-remmers — serotoninesyndroom bij combinatie met SSRI/SNRI.
    id: "mao-serotonerg",
    links: leden("mao_remmers"),
    rechts: [...leden("ssri_snri"), ...leden("tca")],
    tekst: "risico op serotoninesyndroom; een uitwasperiode is nodig.",
  },
];

/** Groepen waarbinnen twee middelen tegelijk dubbelmedicatie opleveren. */
export const DUBBEL_GROEPEN: readonly MiddelGroepNaam[] = [
  "ssri_snri",
  "benzodiazepinen",
  "nsaid",
  "opioiden",
  "antipsychotica",
  "tca",
  "stimulantia",
];

// ── Herkenning ──────────────────────────────────────────────────────────────

/** Kleine letters, diakrieten weg — zodat "codeïne" en "codeine" gelijk zijn. */
export function normaliseerMiddel(waarde: string): string {
  return waarde
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Eenheidsnamen naar hun korte vorm — één tabel voor extractie én controle. */
const EENHEID_KORT: Record<string, string> = {
  milligram: "mg",
  mg: "mg",
  microgram: "mcg",
  mcg: "mcg",
  milliliter: "ml",
  ml: "ml",
};

/**
 * Doseringstekst vergelijkbaar maken: "50mg", "50 milligram" en "50 MG"
 * leveren dezelfde sleutel. Zonder deze normalisatie meldt de doseringsregel
 * een inconsistentie op twee schrijfwijzen van hetzelfde getal (C43).
 */
export function normaliseerDosering(waarde: string): string {
  const schoon = waarde
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d)\s*([a-z])/g, "$1 $2");
  return schoon.replace(/\b(milligram|microgram|milliliter|mg|mcg|ml)\b/g, (term) => EENHEID_KORT[term] ?? term);
}

export function escapeVoorRegex(waarde: string): string {
  return waarde.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Woordgrens op letters/cijfers — werkt ook rond "/" en "-" in namen. */
export function bevatTerm(tekst: string, term: string): boolean {
  const genormaliseerd = normaliseerMiddel(tekst);
  const patroon = new RegExp(`(?<![a-z0-9])${escapeVoorRegex(normaliseerMiddel(term))}(?![a-z0-9])`, "u");
  return patroon.test(genormaliseerd);
}

/** Groepen waartoe een middelnaam behoort (lege lijst = niet ingedeeld). */
export function groepenVanMiddel(naam: string): MiddelGroepNaam[] {
  const genormaliseerd = normaliseerMiddel(naam);
  return (Object.keys(MIDDEL_GROEPEN) as MiddelGroepNaam[]).filter((groep) =>
    MIDDEL_GROEPEN[groep].leden.some((lid) => normaliseerMiddel(lid) === genormaliseerd),
  );
}

/**
 * Allergiegroepen waarnaar een allergietekst verwijst: via de groepsnaam
 * (alias) óf via een lid. Kruisverwijzingen (NSAID ⇄ salicylaten) worden
 * meegenomen zodat "allergisch voor ibuprofen" ook op carbasalaatcalcium
 * waarschuwt.
 */
export function groepenVoorAllergie(tekst: string): AllergieGroepNaam[] {
  const gevonden = new Set<AllergieGroepNaam>();
  for (const naam of Object.keys(ALLERGIEGROEPEN) as AllergieGroepNaam[]) {
    const groep = ALLERGIEGROEPEN[naam];
    const treffer =
      groep.aliassen.some((alias) => bevatTerm(tekst, alias)) || groep.leden.some((lid) => bevatTerm(tekst, lid));
    if (!treffer) continue;
    gevonden.add(naam);
    for (const kruis of KRUISVERWIJZINGEN[naam] ?? []) gevonden.add(kruis);
  }
  return [...gevonden];
}

// ── Controle ────────────────────────────────────────────────────────────────

function unieBron(...bronnen: number[][]): number[] {
  return [...new Set(bronnen.flat())].sort((links, rechts) => links - rechts);
}

function regel(type: Waarschuwing["type"], tekst: string, bron: number[]): Waarschuwing {
  return { type, herkomst: "regel", tekst, bron };
}

/** Alleen wat de patiënt nu gebruikt of wat nu wordt voorgesteld telt mee. */
function relevanteMedicatie(medicatie: Medicatie[]): Medicatie[] {
  return medicatie.filter(
    (rij) => !rij.ingetrokken && (rij.gebruik === "huidig" || rij.gebruik === "voorgesteld") && rij.naam.trim() !== "",
  );
}

function allergieWaarschuwingen(medicatie: Medicatie[], allergieen: Allergiefeit[]): Waarschuwing[] {
  const uitkomst: Waarschuwing[] = [];
  for (const allergie of allergieen) {
    if (allergie.ingetrokken) continue;
    // Een ONTKENDE allergie is een besproken onderwerp, geen bevinding (C39).
    if (allergie.tekst.endsWith(ALLERGIE_ONTKEND_SUFFIX)) continue;
    const groepen = groepenVoorAllergie(allergie.tekst);
    for (const middel of medicatie) {
      const directeTreffer = bevatTerm(allergie.tekst, middel.naam);
      const groepstreffer = groepen.filter((groep) =>
        ALLERGIEGROEPEN[groep].leden.some((lid) => normaliseerMiddel(lid) === normaliseerMiddel(middel.naam)),
      );
      if (!directeTreffer && groepstreffer.length === 0) continue;
      const bron = unieBron(allergie.bron, middel.bron);
      const groepsLabel = groepstreffer.length > 0 ? ALLERGIEGROEPEN[groepstreffer[0]].label : null;
      if (allergie.aard !== "allergie") {
        // Nooit een allergieconflict (§4.4): melding zonder conflictoordeel.
        // De middelnaam staat één keer vooraan (C52) en de groepsredenering
        // blijft behouden; `onbekend` krijgt dezelfde behandeling (C45).
        const staart = allergie.aard === "intolerantie" ? INTOLERANTIE_TEKST : ONBEKENDE_AARD_TEKST;
        const kop = directeTreffer
          ? `${middel.naam}:`
          : `${middel.naam} behoort tot de groep ${groepsLabel} van de gemelde ${allergie.tekst}.`;
        uitkomst.push(regel("allergie", `${kop} ${staart}`, bron));
        continue;
      }
      const toelichting = directeTreffer
        ? `${middel.naam} is het gemelde middel`
        : `${middel.naam} behoort tot de groep ${groepsLabel}`;
      uitkomst.push(
        regel("allergie", `Gemelde allergie voor ${allergie.tekst} — ${toelichting}. ${CONTROLE_SLOT}`, bron),
      );
    }
  }
  return uitkomst;
}

function interactieWaarschuwingen(medicatie: Medicatie[]): Waarschuwing[] {
  const uitkomst: Waarschuwing[] = [];
  const gezien = new Set<string>();
  for (const regelSpec of INTERACTIE_REGELS) {
    const links = new Set(regelSpec.links.map(normaliseerMiddel));
    const rechts = new Set(regelSpec.rechts.map(normaliseerMiddel));
    for (const eerste of medicatie) {
      for (const tweede of medicatie) {
        if (eerste === tweede) continue;
        const a = normaliseerMiddel(eerste.naam);
        const b = normaliseerMiddel(tweede.naam);
        if (a === b) continue;
        if (!links.has(a) || !rechts.has(b)) continue;
        if (regelSpec.onderling && a > b) continue;
        const sleutel = `${regelSpec.id}|${[a, b].sort().join("+")}`;
        if (gezien.has(sleutel)) continue;
        gezien.add(sleutel);
        uitkomst.push(
          regel(
            "interactie",
            `Mogelijke interactie ${eerste.naam} × ${tweede.naam}: ${regelSpec.tekst} ${CONTROLE_SLOT}`,
            unieBron(eerste.bron, tweede.bron),
          ),
        );
      }
    }
  }
  return uitkomst;
}

function dubbelWaarschuwingen(medicatie: Medicatie[]): Waarschuwing[] {
  const uitkomst: Waarschuwing[] = [];
  const gezien = new Set<string>();
  for (const groep of DUBBEL_GROEPEN) {
    const inGroep = medicatie.filter((rij) =>
      MIDDEL_GROEPEN[groep].leden.some((lid) => normaliseerMiddel(lid) === normaliseerMiddel(rij.naam)),
    );
    const namen = [...new Set(inGroep.map((rij) => normaliseerMiddel(rij.naam)))];
    if (namen.length < 2) continue;
    for (let i = 0; i < namen.length; i += 1) {
      for (let j = i + 1; j < namen.length; j += 1) {
        const sleutel = `${groep}|${namen[i]}+${namen[j]}`;
        if (gezien.has(sleutel)) continue;
        gezien.add(sleutel);
        const eerste = inGroep.find((rij) => normaliseerMiddel(rij.naam) === namen[i]);
        const tweede = inGroep.find((rij) => normaliseerMiddel(rij.naam) === namen[j]);
        uitkomst.push(
          regel(
            "dubbel",
            `Dubbelmedicatie: ${eerste?.naam ?? namen[i]} en ${tweede?.naam ?? namen[j]} zijn beide ${MIDDEL_GROEPEN[groep].label}. ${CONTROLE_SLOT}`,
            unieBron(eerste?.bron ?? [], tweede?.bron ?? []),
          ),
        );
      }
    }
  }
  return uitkomst;
}

interface Doseringvermelding {
  waarde: string;
  bron: number[];
}

/**
 * Alle doseringen die voor één medicatierij zijn genoemd. `doseringen` draagt
 * elke afzonderlijke vermelding met bron; `dosering` is de weergavewaarde en
 * dient als terugval voor rijen uit oudere opslag of uit een modelpass.
 */
function vermeldingenVan(rij: Medicatie): Doseringvermelding[] {
  const vermeldingen = rij.doseringen ?? [];
  if (vermeldingen.length > 0) return vermeldingen.map((item) => ({ waarde: item.waarde, bron: [...item.bron] }));
  return rij.dosering ? [{ waarde: rij.dosering, bron: [...rij.bron] }] : [];
}

/**
 * Doseringsinconsistentie: hetzelfde middel met dezelfde gebruiksstatus maar
 * twee verschillende doseringen in één consult. Een ophoging (huidig 50 mg →
 * voorgesteld 100 mg) is dus GEEN inconsistentie. Bewust bronvrij: de
 * segmentnummers staan in de tekst, de waarschuwing zelf verwijst nergens
 * naar één bron.
 */
function doseringWaarschuwingen(medicatie: Medicatie[]): Waarschuwing[] {
  const perMiddel = new Map<string, Doseringvermelding[]>();
  for (const rij of medicatie) {
    const vermeldingen = vermeldingenVan(rij);
    if (vermeldingen.length === 0) continue;
    const sleutel = `${normaliseerMiddel(rij.naam)}|${rij.gebruik}`;
    const bestaand = perMiddel.get(sleutel);
    if (bestaand) bestaand.push(...vermeldingen);
    else perMiddel.set(sleutel, [...vermeldingen]);
  }
  const uitkomst: Waarschuwing[] = [];
  for (const vermeldingen of perMiddel.values()) {
    const uniek = new Map<string, Doseringvermelding>();
    for (const vermelding of vermeldingen) {
      const sleutel = normaliseerDosering(vermelding.waarde);
      const bestaand = uniek.get(sleutel);
      if (bestaand) {
        bestaand.bron = unieBron(bestaand.bron, vermelding.bron);
        continue;
      }
      uniek.set(sleutel, { waarde: vermelding.waarde, bron: [...vermelding.bron] });
    }
    if (uniek.size < 2) continue;
    const beschrijving = [...uniek.values()]
      .sort((links, rechts) => (links.bron[0] ?? 0) - (rechts.bron[0] ?? 0))
      .map((vermelding) => `§${vermelding.bron[0] ?? 0}: ${vermelding.waarde}`)
      .join("; ");
    uitkomst.push({
      type: "dosering",
      herkomst: "regel",
      tekst: `Dosering inconsistent genoemd (${beschrijving}) — controleer.`,
      bron: [],
    });
  }
  return uitkomst;
}

/**
 * Gecontroleerde medicatieregels over de huidige consultstaat. Alleen
 * `gebruik ∈ {huidig, voorgesteld}` telt mee; `onbekend` (een mogelijk
 * medicijn dat nog bevestigd moet worden) en `gestopt` gaan niet mee de
 * veiligheidscheck in.
 */
export function controleerMedicatie(medicatie: Medicatie[], allergieen: Allergiefeit[]): Waarschuwing[] {
  const relevant = relevanteMedicatie(medicatie);
  return [
    ...allergieWaarschuwingen(relevant, allergieen),
    ...interactieWaarschuwingen(relevant),
    ...dubbelWaarschuwingen(relevant),
    ...doseringWaarschuwingen(relevant),
  ];
}
