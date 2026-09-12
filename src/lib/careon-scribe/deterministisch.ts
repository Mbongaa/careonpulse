// Careon Scribe — deterministische laag (handoff 20 §4.5, puur).
//
// Deze laag draait altijd: zij voedt het demo-pad, is de terugval wanneer
// `CAREON_SCRIBE_LIVE` niet aan staat, en levert de checklist en het verslag
// waarop verify:careon toetst. Regelgebaseerde Nederlandse extractie —
// bewust conservatief: liever een feit missen dan een feit verzinnen.
//
// De harde veiligheidsregel van S10 leeft hier letterlijk: RISICOCATEGORIEËN
// (suïcidaliteit, psychose, veiligheid van anderen, huiselijk geweld) krijgen
// NOOIT polariteit. Een treffer levert uitsluitend "<categorie> besproken —
// beoordeling behandelaar" met bron; een ontkennend antwoord van de patiënt
// wordt dus nooit "geen suïcidale gedachten".

import { renderEnglishFacts } from "./english-report";
import { formaatVoor } from "./formaten";
import { geldigeGesprekscontext, renderGesprekscontext } from "./gesprekscontext";
import { ALLERGIE_STRENGTE, legeKlinischeStaat, medicatieRegel, mergeKlinischeStaat } from "./klinische-staat";
import {
  ALLERGIE_ONTKEND_SUFFIX,
  ALLERGIEGROEPEN,
  BEKENDE_MIDDELEN,
  controleerMedicatie,
  escapeVoorRegex,
  normaliseerDosering,
  normaliseerMiddel,
} from "./medicatie-veiligheid";
import { GETAL_PATROON, getalNaarCijfer } from "./nl-getallen";
import type {
  Actie,
  Allergiefeit,
  Categoriefeit,
  ConsultType,
  Feit,
  KlinischeStaat,
  Medicatie,
  OntbrekendItem,
  ScribeSegment,
  ScribeTaal,
  Spreker,
  TaakSoort,
  VerslagSectie,
} from "./types";
import { SCRIBE_LIMITS } from "./types";

// ── Hulpstukken ─────────────────────────────────────────────────────────────

/** De behandelaarscorrectie wint altijd van de herkende tekst (S9). */
export function effectieveTekst(segment: ScribeSegment): string {
  return segment.tekstGecorrigeerd ?? segment.tekst;
}

/**
 * Expliciete wikkel om `RegExp.exec`: de patronen hieronder worden met
 * `new RegExp()` opgebouwd (het getallenlexicon wordt erin geïnterpoleerd) en
 * dan verliest de statische analyse dat het resultaat null kan zijn.
 */
function zoek(patroon: RegExp, tekst: string): RegExpExecArray | null {
  return patroon.exec(tekst);
}

function deelzinnen(tekst: string): string[] {
  return (
    tekst
      // Een decimaalteken hoort bij de hoeveelheid, niet bij de zinsgrens.
      .split(/(?<!\d)[,.]|[,.](?!\d)|[;:!?]+/)
      .map((deel) => deel.trim())
      .filter((deel) => deel.length > 0)
  );
}

/** Afzonderlijke uitspraken, met behoud van vraagtekens en onderwerpwissels. */
export function beweringDelen(tekst: string): string[] {
  return tekst
    .split(
      /(?<=[!?;])\s*|(?<!\d)\.\s*|\.(?!\d)\s*|[\r\n]+|\s+maar\s+|\s+(?:en|terwijl)\s+(?=(?:ik|mijn|zijn|haar|de patiënt|de cliënt|cliënt|patiënt|gebruik|slik|neem|krijg)\b)/i,
    )
    .map((deel) => deel.trim())
    .filter(Boolean);
}

export function isVraag(tekst: string): boolean {
  return (
    /\?/.test(tekst) ||
    /^(?:bent|heeft|heb|gebruikt|slikt|neemt|krijgt|voelt|slaapt|hoort|drinkt|rookt)\s+(?:u|je|jij)\b|^(?:hoe|wanneer|waarom|welke|hoeveel|waarvoor)\b/i.test(
      tekst.trim(),
    )
  );
}

/** Een genoemd familielid is niet vanzelf de patiënt (ook niet bij patiëntspraak). */
export function betreftFamilie(tekst: string): boolean {
  return /\b(?:moeder|vader|broer|zus|opa|oma|familielid|partner|dochter|zoon)\b/i.test(tekst);
}

const HISTORISCHE_UITSPRAAK =
  /\b(?:vroeger|destijds|in het verleden|vorige week|vorig jaar|eerder|had|slikte|gebruikte|nam|in (?:19|20)\d{2})\b/i;
const HUIDIGE_OF_TOEKOMSTIGE_UITSPRAAK =
  /\b(?:nu|vandaag|nog steeds|sinds|momenteel|voortaan|morgen|gaan|zal|wil|starten|ophogen|afbouwen)\b/i;
const HYPOTHETISCHE_UITSPRAAK = /\b(?:als|stel dat|eventueel|zou|zouden|misschien|mogelijk)\b/i;

export function isHistorisch(tekst: string): boolean {
  return HISTORISCHE_UITSPRAAK.test(tekst) && !HUIDIGE_OF_TOEKOMSTIGE_UITSPRAAK.test(tekst);
}

export const ENGELSE_HANDMATIGE_BEOORDELING =
  "Automatische extractie van dit Engelstalige consult is niet beschikbaar. Controleer het transcript en vul iedere verslagsectie zelf in; ontbrekende feiten zijn niet automatisch beoordeeld.";

function eersteHoofdletter(waarde: string): string {
  return waarde.length === 0 ? waarde : waarde[0].toUpperCase() + waarde.slice(1);
}

function feit(tekst: string, bron: number[]): Feit {
  return { tekst: tekst.slice(0, SCRIBE_LIMITS.feitTekst), bron, ingetrokken: false };
}

function voegFeitToe(lijst: Feit[], tekst: string, volgnummer: number): void {
  const sleutel = tekst.trim().toLowerCase();
  const bestaand = lijst.find((rij) => rij.tekst.trim().toLowerCase() === sleutel);
  if (bestaand) {
    if (!bestaand.bron.includes(volgnummer)) bestaand.bron.push(volgnummer);
    return;
  }
  lijst.push(feit(tekst, [volgnummer]));
}

function voegCategorieToe(
  lijst: Categoriefeit[],
  categorie: string,
  tekst: string,
  volgnummer: number,
  // Een specifieker detail (een gemelde hoeveelheid) overschrijft een eerder
  // "besproken": de vraag van de behandelaar mag het antwoord niet verdringen.
  overschrijf = false,
): void {
  const bestaand = lijst.find((rij) => rij.categorie === categorie);
  if (bestaand) {
    if (!bestaand.bron.includes(volgnummer)) bestaand.bron.push(volgnummer);
    if (overschrijf) bestaand.tekst = tekst;
    return;
  }
  lijst.push({ ...feit(tekst, [volgnummer]), categorie });
}

/** `geen|niet|nooit` binnen drie woorden vóór of ná de treffer. */
function isOntkend(tekst: string, treffer: string): boolean {
  const woorden = tekst.toLowerCase().split(/\s+/);
  const doelwit = treffer.toLowerCase();
  const positie = woorden.findIndex((woord) => woord.replace(/[^a-zà-ÿ-]/g, "").startsWith(doelwit.slice(0, 5)));
  // Niet te lokaliseren? Dan geen negatie claimen — liever een feit zonder
  // ontkenning dan een ontkenning die er niet stond.
  if (positie === -1) return false;
  const venster = woorden.slice(Math.max(0, positie - 3), positie + 4);
  return venster.some((woord) => /^(geen|niet|nooit|not|never|no|denies)$/.test(woord.replace(/[^a-zà-ÿ]/g, "")));
}

// ── Lexicons ────────────────────────────────────────────────────────────────

interface SymptoomRegel {
  patroon: RegExp;
  label: string;
  /** Optionele psychische categorie (zonder polariteit bij risico). */
  psychisch?: string;
  /** Een normaal genoemde functie mag niet als klacht worden geïnterpreteerd. */
  normaal?: RegExp;
}

const SYMPTOMEN: readonly SymptoomRegel[] = [
  { patroon: /\b(somber|neerslachtig|depressief|verdrietig)/i, label: "somberheid", psychisch: "stemming" },
  { patroon: /\b(geen zin|nergens zin|geen plezier|anhedon)/i, label: "verlies van interesse", psychisch: "stemming" },
  {
    patroon:
      /\b(slaap\w*\s+(?:erg\s+)?(?:slecht|moeilijk|weinig)|slecht\s+slaap\w*|slaapproblem\w*|slapeloos\w*|wakker lig\w*)/i,
    label: "slaapproblemen",
    normaal: /\b(?:slaap\w*\s+(?:goed|prima|normaal)|geen slaapproblemen)\b/i,
  },
  { patroon: /\b(pieker|maal|malen|tobben)/i, label: "piekeren", psychisch: "angst" },
  {
    patroon:
      /\b((?:verminderde|weinig|slechte|geen|minder)\s+eetlust|eetlust\s+(?:is\s+)?(?:verminderd|afgenomen|slecht))/i,
    label: "verminderde eetlust",
  },
  // `\bmoe\b` met woordgrens: anders leest "moeder" als vermoeidheid.
  { patroon: /(\bmoe\b|vermoeid|uitgeput|weinig energie)/i, label: "vermoeidheid" },
  { patroon: /\b(angst|angstig|paniek|gespannen)/i, label: "angstklachten", psychisch: "angst" },
  { patroon: /\b(concentr|vergeetachtig|geheugen)/i, label: "concentratieproblemen", psychisch: "cognitie" },
  { patroon: /\b(hoofdpijn)/i, label: "hoofdpijn" },
  { patroon: /\b(rugpijn|rug doet)/i, label: "rugpijn" },
  { patroon: /\b(buikpijn)/i, label: "buikpijn" },
  { patroon: /\b(misselijk)/i, label: "misselijkheid" },
  { patroon: /\b(duizelig)/i, label: "duizeligheid" },
  { patroon: /\b(koorts)/i, label: "koorts" },
  { patroon: /\b(benauwd|kortademig)/i, label: "kortademigheid" },
];

/**
 * Risicocategorieën: nooit polariteit (S10). Een treffer — een vraag van de
 * behandelaar óf een uitspraak van de patiënt — levert uitsluitend
 * "besproken"; de beoordeling is en blijft van de behandelaar.
 */
export const RISICO_CATEGORIEEN: readonly { categorie: string; label: string; patroon: RegExp }[] = [
  {
    categorie: "suicidaliteit",
    label: "Suïcidaliteit",
    patroon:
      /(su[iï]cid|zelfmoord|einde aan (uw|je|mijn|het) leven|dood ?wens|niet meer (wil|willen) leven|want to die|wish to die|end (?:my|your|his|her) life)/i,
  },
  {
    categorie: "psychose",
    label: "Psychose",
    // C51 — de klinische uitvraag staat in normale Nederlandse woordvolgorde
    // ("Hoort u weleens stemmen?"); het oude patroon eiste "stemmen horen".
    // Bewust GEEN kaal `\bstemmen\b`: "we stemmen dat af met de huisarts" zou
    // dan een risicocategorie zonder polariteit vullen — de onveilige richting.
    patroon:
      /(psychos[ei]s?|psychoti[cs]|parano[iï]d|wanen|delusions?|hallucinat|hear\w*\s+(?:\w+\s+){0,3}voices|stemmen\s+hor|hoor\w*\s+(?:\w+\s+){0,3}stemmen|stemmen\s+(?:\w+\s+){0,2}(?:gehoord|hoorde)|stemmen\s+die\s+anderen)/i,
  },
  {
    categorie: "veiligheid",
    label: "Veiligheid van anderen",
    patroon:
      /(veiligheid van anderen|iemand iets aandoen|agressie (naar|richting)|harm (?:to )?others|homicid|risk to others)/i,
  },
  {
    categorie: "huiselijk-geweld",
    label: "Huiselijk geweld",
    patroon: /(huiselijk geweld|mishandel|onveilig thuis|domestic (?:violence|abuse)|unsafe at home)/i,
  },
];

const LEEFSTIJL: readonly { categorie: string; label: string; patroon: RegExp; hoeveelheid?: RegExp }[] = [
  { categorie: "roken", label: "Roken", patroon: /\b(rook|roken|sigaret)/i },
  {
    categorie: "alcohol",
    label: "Alcohol",
    patroon: /\b(alcohol|drink|bier|wijn|glazen)/i,
    hoeveelheid: new RegExp(`(${GETAL_PATROON})\\s+(glazen|glas|eenheden)`, "i"),
  },
  { categorie: "drugs", label: "Drugs", patroon: /\b(drugs|blow|cannabis|wiet|coca[iï]ne|xtc|speed)/i },
  { categorie: "slaap", label: "Slaap", patroon: /\b(slaap|slapen|wakker|slapeloos)/i },
  { categorie: "beweging", label: "Beweging", patroon: /\b(sport|beweeg|bewegen|wandel|fiets)/i },
  { categorie: "voeding", label: "Voeding", patroon: /\b(eetlust|voeding|maaltijd|eten)/i },
  { categorie: "werk", label: "Werk", patroon: /\b(werk|baan|collega|reorganisatie|werkdruk|werkstress)/i },
];

/** Tokens met een medicijn-achtig achtervoegsel die géén medicijn zijn. */
export const GEEN_MEDICIJN: readonly string[] = [
  "urine",
  "routine",
  "machine",
  "discipline",
  "vitamine",
  "cabine",
  "medicine",
  "kantine",
  "gelatine",
  "margarine",
  "benzine",
  "magazine",
  "terpentine",
  "lawine",
  "sardine",
  "praline",
  "online",
  "offline",
  "april",
  "combine",
  "turbine",
  "aspirine",
];

const MEDICIJN_SUFFIXEN = /(ine|pam|olol|pril|statine|azol)$/;
const INNAME_TERMEN =
  /(mg|milligram|mcg|microgram|ml|milliliter|gram|tablet|capsule|druppel|zetpil|injectie|infuus|inname|inneem|slik|gebruik|voorgeschreven|dosis|dosering|per dag|maal daags|voorschrijf|recept)/i;
const DOSERING_PATROON = new RegExp(`(${GETAL_PATROON})\\s*(mg|milligram|mcg|microgram|ml|milliliter|gram)\\b`, "i");

const VOORGESTELD_PATROON = /(starten met|start met|ophogen|ophoging|verhogen naar|voorschrijven|schrijf|ik geef)/i;
const GESTOPT_PATROON = /(gestopt met|gestopt|niet meer|afgebouwd|gestaakt)/i;
/** N5 — een depot of injectie is toegediend: dat is huidig gebruik. */
const TOEDIENING_PATROON = /\b(depot|depotinjectie|injectie|toegediend|geprikt|geïnjecteerd|prik gehad)\b/i;

/**
 * De allergievangst stopt vóór een bijzin (C41). Zonder deze grens slokt
 * "allergisch voor penicilline en ik slik ibuprofen" de hele restzin op: het
 * middel verdwijnt uit de medicatie én levert een vals allergieconflict.
 * `en`/`of` staan er bewust NIET in — die zijn dubbelzinnig (opsomming versus
 * nieuwe deelzin) en worden door `knipAllergieterm` afgehandeld.
 */
const ALLERGIE_BIJZIN = String.raw`(?=\s+(?:en\s+)?(?:maar|daar|want|omdat|dus|toen|ik|u|hij|zij|we|die|dat|verder|slik|slikt|gebruik|gebruikt|neem|neemt|krijg|krijgt)\b|[,.;:!?]|$)`;

const ALLERGIE_PATRONEN: readonly { patroon: RegExp; aard: Allergiefeit["aard"] }[] = [
  { patroon: new RegExp(`allergisch voor\\s+([^,.;:!?]*?)${ALLERGIE_BIJZIN}`, "i"), aard: "allergie" },
  { patroon: new RegExp(`allergie voor\\s+([^,.;:!?]*?)${ALLERGIE_BIJZIN}`, "i"), aard: "allergie" },
  { patroon: new RegExp(`kan niet tegen\\s+([^,.;:!?]*?)${ALLERGIE_BIJZIN}`, "i"), aard: "intolerantie" },
  { patroon: new RegExp(`wordt misselijk van\\s+([^,.;:!?]*?)${ALLERGIE_BIJZIN}`, "i"), aard: "intolerantie" },
  {
    patroon: new RegExp(`verdraag(?:t)? (?:ik )?(?:geen|niet)\\s+([^,.;:!?]*?)${ALLERGIE_BIJZIN}`, "i"),
    aard: "intolerantie",
  },
];

/**
 * Nederlandse ontkenning staat LINKS van "allergisch/allergie voor" (C39).
 * Bewust niet `isOntkend`: diens symmetrische venster van ±3 woorden laat een
 * echte allergie sneuvelen ("allergisch voor penicilline, verder geen klachten").
 */
const ALLERGIE_ONTKENNING = /\b(?:geen|niet|nooit)\s+(?:\S+\s+){0,2}$/i;

/** Vulwoorden uit een uitvraag ("allergisch voor bepaalde medicijnen?"). */
const GEEN_ALLERGEEN = /^(?:iets|bepaalde|dingen|dat|wat|medicijnen|medicatie)\b/i;

/** Termen waarop een allergievangst mag worden ingekort tot de allergenen. */
const ALLERGIE_TERMEN: ReadonlySet<string> = new Set([
  ...BEKENDE_MIDDELEN.map(normaliseerMiddel),
  ...Object.values(ALLERGIEGROEPEN).flatMap((groep) =>
    [...groep.aliassen, ...groep.leden].map((term) => normaliseerMiddel(term)),
  ),
]);

/**
 * Kort een allergievangst in tot de herkende allergenen. INVARIANT: alleen
 * INKORTEN vanaf rechts — het resultaat is altijd een letterlijk prefix van de
 * vangst, waar het uitknippen in `extraheerMedicatie` op rekent.
 */
function knipAllergieterm(vangst: string): string {
  const delen = vangst.split(/(\s+(?:en|of)\s+)/i);
  if (delen.length === 1) return vangst.trim();
  // Onbekend eerste deel ("pinda's", "pleisters"): de hele kern bewaren —
  // exacte herkenning is daar onmogelijk en de bijzin is al weggeknipt.
  if (!ALLERGIE_TERMEN.has(normaliseerMiddel(delen[0]))) return vangst.trim();
  let lengte = delen[0].length;
  for (let index = 1; index + 1 < delen.length; index += 2) {
    if (!ALLERGIE_TERMEN.has(normaliseerMiddel(delen[index + 1]))) break;
    lengte += delen[index].length + delen[index + 1].length;
  }
  return vangst.slice(0, lengte).trim();
}

const ACTIE_REGELS: readonly { soort: TaakSoort; patroon: RegExp }[] = [
  { soort: "lab", patroon: /\b(tsh|lab|bloedonderzoek|bloedprik|bepaling|prikken|urineonderzoek|spiegel)/i },
  { soort: "beeldvorming", patroon: /\b(echo|r[oö]ntgen|mri|ct-scan|scan|foto)\b/i },
  { soort: "verwijzing", patroon: /\b(verwijs|verwijzing|doorverwij)/i },
  {
    soort: "vervolgafspraak",
    patroon: /\b(vervolgafspraak|controleafspraak|afspraak over|controle over|terugkomen|volgende afspraak)/i,
  },
  {
    soort: "medicatie",
    patroon: /\b(ophogen|ophoging|starten met|start met|voorschrijven|recept|afbouwen|stoppen met)/i,
  },
  { soort: "communicatie", patroon: /\b(overleg|bellen|brief|informeren|contact opnemen|inlichten)/i },
  { soort: "overig", patroon: /\b(psycho-educatie|advies|adviezen|voorlichting|uitleg|we doen|afspraak maken)/i },
];

const OVERWEGING_PATRONEN: readonly RegExp[] = [
  /ik denk aan/i,
  /\bmogelijk\b/i,
  /zou kunnen passen bij/i,
  /zou passen bij/i,
  /ik wil\b[^.]*\buitsluiten/i,
  /differentiaal/i,
];

const DUUR_PATROON = new RegExp(
  `\\b(?:sinds|al|ongeveer|zo'n|circa|ruim)\\s+(${GETAL_PATROON})\\s+(dagen|weken|maanden|jaren|jaar)\\b`,
  "i",
);
const BELOOP_TERMEN: readonly string[] = [
  "geleidelijk erger",
  "langzaam erger",
  "steeds erger",
  "erger geworden",
  "wisselend",
  "stabiel",
  "toenemend",
  "afnemend",
  "verbeterd",
];
const ERNST_TERMEN: readonly string[] = ["ernstig", "heftig", "hevig", "matig", "mild", "licht"];
// De bloeddrukvorm eist expliciet het woord bloeddruk/RR/tensie: zonder die
// eis leest "op een schaal van 10 zit ik op 80/100" als een bloeddruk (C49).
const METING_PATROON = new RegExp(
  `(?:(${GETAL_PATROON})\\s*(kilo|kg|graden|mmhg|slagen per minuut)|\\b(?:bloeddruk|rr|tensie)\\b[^.]{0,20}?\\d{2,3}\\s*/\\s*\\d{2,3}\\b)`,
  "i",
);
const ONDERZOEK_PATROON = /(bij onderzoek|ik zie|ik hoor|bij inspectie|onderzoek toont|bij lichamelijk onderzoek)/i;
const VOORGESCHIEDENIS_PATROON = /(eerder|in het verleden|bekend met|\b(?:19|20)\d{2}\b|burn-?out gehad)/i;
const UITLOKKEND_PATROON = /\b(stress|werkdruk|reorganisatie|conflict|ruzie|drukte|uitgelokt|erger door)/i;
const VERLICHTEND_PATROON = /\b(helpt|lichter|verlicht|rust|ontspan|beter door|opluchting)/i;

/**
 * Wettelijke en klinische GGZ-onderwerpen (N8). Een treffer betekent uitsluitend
 * dat het onderwerp AAN BOD IS GEWEEST — nooit een polariteit of een oordeel;
 * de checklist gebruikt ze om "nog niet besproken" waarheidsgetrouw te maken.
 * Ze landen als categoriefeit in `leefstijl`, de contextcategorie van de staat.
 */
const CONTEXT_ONDERWERPEN: readonly { categorie: string; label: string; patroon: RegExp }[] = [
  {
    categorie: "kindcheck",
    label: "Kindcheck",
    patroon: /\b(kindcheck|kinderen|thuiswonend|gezinssituatie|kind thuis|opvoeding)\b/i,
  },
  {
    categorie: "zwangerschap",
    label: "Zwangerschap en kinderwens",
    patroon: /\b(zwanger|zwangerschap|kinderwens|anticonceptie|borstvoeding)\b/i,
  },
  {
    categorie: "eerdere-pogingen",
    label: "Eerdere pogingen",
    patroon: /(eerdere? poging|su[iï]cidepoging|tentamen suicidii|eerder geprobeerd)/i,
  },
  {
    categorie: "crisisplan",
    label: "Crisisplan",
    patroon: /(crisisplan|veiligheidsplan|signaleringsplan|crisiskaart|crisisafspraken)/i,
  },
  { categorie: "bijwerkingen", label: "Bijwerkingen", patroon: /\b(bijwerking|bijwerkingen)\b/i },
  {
    categorie: "therapietrouw",
    label: "Therapietrouw",
    patroon:
      /(therapietrouw|medicatietrouw|trouw ingenomen|vergeet[^.]{0,25}(?:in te nemen|innemen)|sla[^.]{0,15}over)/i,
  },
  {
    categorie: "somatische-screening",
    label: "Somatische en metabole controle",
    patroon:
      /(metabole controle|somatische screening|bloedsuiker|glucosewaarde|lipiden|cholesterol|buikomvang|\becg\b)/i,
  },
  {
    categorie: "dagbesteding",
    label: "Dagbesteding",
    patroon: /(dagbesteding|dagritme|opleiding|vrijwilligerswerk|naar school)/i,
  },
  {
    categorie: "woon-financien",
    label: "Wonen en financiën",
    patroon: /(huisvesting|woonsituatie|schulden|financi[eë]n|uitkering|bewindvoering)/i,
  },
  {
    categorie: "vangnet",
    label: "Vangnetadvies",
    patroon: /(vangnet|wanneer contact opnemen|neem dan contact op|bij verergering|als het slechter gaat)/i,
  },
];

// ── Sprekerheuristiek ───────────────────────────────────────────────────────

const ARTS_SIGNALEN =
  /(\?|\bu\b|\buw\b|ik wil\b|ik stel voor|ik schrijf|ik verwijs|ik overleg|ik vraag|we maken|we doen|ik geef u|vertelt u)/i;
const PATIENT_SIGNALEN = /(\bik voel\b|\bik heb\b|\bmijn\b|\bik ben\b|\bik gebruik\b|\bik slaap\b|\bik denk\b)/i;

/**
 * Sprekerheuristiek voor segmenten die als `onbekend` binnenkomen (S8): de
 * providerdiarisatie of de context-agent kent normaal een spreker toe. Bij
 * twijfel wisselt de heuristiek af met de vorige spreker — een gesprek is
 * beurtelings — en anders blijft het `onbekend`.
 */
export function bepaalSpreker(tekst: string, vorige: Spreker = "onbekend"): Spreker {
  const artsScore = ARTS_SIGNALEN.test(tekst) ? 1 : 0;
  const patientScore = PATIENT_SIGNALEN.test(tekst) ? 1 : 0;
  if (tekst.trim().endsWith("?")) return "arts";
  if (artsScore > patientScore) return "arts";
  if (patientScore > artsScore) return "patient";
  if (vorige === "arts") return "patient";
  if (vorige === "patient") return "arts";
  return "onbekend";
}

// ── Extractie ───────────────────────────────────────────────────────────────

function bepaalGebruik(deelzin: string): Medicatie["gebruik"] {
  if (GESTOPT_PATROON.test(deelzin)) return "gestopt";
  if (VOORGESTELD_PATROON.test(deelzin)) return "voorgesteld";
  return "huidig";
}

/** "geen tramadol meer" is gestaakt gebruik, geen ontkenning (C40). */
function isGestaakt(deelzin: string, middel: string): boolean {
  const patroon = new RegExp(
    `\\b(?:geen|niet)\\s+(?:\\w+\\s+){0,2}${escapeVoorRegex(normaliseerMiddel(middel))}\\b[^,;.]{0,25}\\bmeer\\b`,
    "i",
  );
  return patroon.test(normaliseerMiddel(deelzin));
}

/** Elke afzonderlijk genoemde dosering blijft bewaard mét bron (C43). */
function noteerDosering(rij: Medicatie, dosering: string, volgnummer: number): void {
  if (!rij.doseringen) rij.doseringen = [];
  const sleutel = normaliseerDosering(dosering);
  const bestaand = rij.doseringen.find((vermelding) => normaliseerDosering(vermelding.waarde) === sleutel);
  if (bestaand) {
    if (!bestaand.bron.includes(volgnummer)) bestaand.bron.push(volgnummer);
  } else {
    rij.doseringen.push({ waarde: dosering, bron: [volgnummer] });
  }
  if (!rij.dosering) rij.dosering = dosering;
}

/**
 * Eén rij per middel per BEVESTIGDE gebruiksstatus. Een `onbekend`-vermelding
 * (uitvraag of ontkenning) maakt nooit een tweede rij: zij vult hoogstens de
 * bron aan, en wordt door een latere bevestiging ter plekke opgewaardeerd
 * (C40). Zo blijft de demo-splitsing huidig/voorgesteld overeind terwijl een
 * screeningsvraag geen dubbelmedicatie-alarm meer kan veroorzaken.
 */
function voegMedicatieToe(
  lijst: Medicatie[],
  naam: string,
  dosering: string | null,
  gebruik: Medicatie["gebruik"],
  tekst: string,
  volgnummer: number,
): void {
  const sleutel = normaliseerMiddel(naam);
  const rijen = lijst.filter((rij) => normaliseerMiddel(rij.naam) === sleutel);
  // Een expliciete actuele stop trekt het eerdere gebruik in, mét de bron
  // van die verandering. Historische informatie blijft doorgehaald bestaan.
  if (gebruik === "gestopt" || gebruik === "huidig") {
    for (const rij of rijen) {
      if (rij.doorBehandelaar) continue;
      const wordtVervangen = gebruik === "gestopt" ? rij.gebruik === "huidig" : rij.gebruik === "gestopt";
      if (wordtVervangen && Math.max(0, ...rij.bron) < volgnummer) {
        rij.ingetrokken = true;
        rij.bron.push(volgnummer);
      }
    }
  }
  const gelijk = rijen.find((rij) => rij.gebruik === gebruik);
  const doel = gelijk ?? (gebruik === "onbekend" ? rijen[0] : rijen.find((rij) => rij.gebruik === "onbekend")) ?? null;
  if (doel) {
    if (gebruik !== "onbekend" && !doel.doorBehandelaar && Math.max(0, ...doel.bron) < volgnummer) {
      doel.ingetrokken = false;
    }
    if (!doel.bron.includes(volgnummer)) doel.bron.push(volgnummer);
    if (doel.gebruik === "onbekend" && gebruik !== "onbekend") {
      doel.gebruik = gebruik;
      doel.tekst = tekst.slice(0, SCRIBE_LIMITS.feitTekst);
    }
    if (dosering) noteerDosering(doel, dosering, volgnummer);
    return;
  }
  lijst.push({
    ...feit(tekst, [volgnummer]),
    naam,
    dosering,
    gebruik,
    doseringen: dosering ? [{ waarde: dosering, bron: [volgnummer] }] : [],
  });
}

interface MiddelTreffer {
  naam: string;
  begin: number;
  eind: number;
  bekend: boolean;
}

/** Herkende middelen in tekstvolgorde, zodat doses aan hun eigen middel hangen. */
function middelenIn(deelzin: string): MiddelTreffer[] {
  const uitkomst: MiddelTreffer[] = [];
  for (const middel of BEKENDE_MIDDELEN) {
    const patroon = new RegExp(`(?<![\\p{L}\\p{N}])${escapeVoorRegex(middel)}(?![\\p{L}\\p{N}])`, "giu");
    for (const treffer of deelzin.matchAll(patroon)) {
      uitkomst.push({ naam: middel, begin: treffer.index, eind: treffer.index + treffer[0].length, bekend: true });
    }
  }
  for (const treffer of deelzin.matchAll(/[A-Za-zÀ-ÿ/-]+/g)) {
    const token = normaliseerMiddel(treffer[0]);
    if (token.length < 5 || !MEDICIJN_SUFFIXEN.test(token)) continue;
    if (GEEN_MEDICIJN.some((woord) => normaliseerMiddel(woord) === token)) continue;
    if (uitkomst.some((middel) => treffer.index >= middel.begin && treffer.index < middel.eind)) continue;
    uitkomst.push({ naam: treffer[0], begin: treffer.index, eind: treffer.index + treffer[0].length, bekend: false });
  }
  return uitkomst
    .sort((a, b) => a.begin - b.begin || b.eind - a.eind)
    .filter(
      (rij, index, lijst) =>
        !lijst.slice(0, index).some((eerder) => rij.begin >= eerder.begin && rij.eind <= eerder.eind),
    );
}

function doseringenPerMiddel(deelzin: string, middelen: MiddelTreffer[]): Map<MiddelTreffer, string[]> {
  const uitkomst = new Map<MiddelTreffer, string[]>();
  for (const treffer of deelzin.matchAll(new RegExp(DOSERING_PATROON.source, "gi"))) {
    const eind = treffer.index + treffer[0].length;
    // "50 mg sertraline" is een expliciete voorgeplaatste dosering.
    const volgend = middelen.find((middel) => middel.begin >= eind && /^\s*$/.test(deelzin.slice(eind, middel.begin)));
    const vorig = middelen.filter((middel) => middel.eind <= treffer.index).at(-1);
    const tussen = vorig ? deelzin.slice(vorig.eind, treffer.index) : "";
    // Een los getal na "en/of" zonder medicijn krijgt geen gok-toewijzing.
    const doel = volgend ?? (vorig && !/\b(?:en|of)\s*$/i.test(tussen) ? vorig : undefined);
    if (!doel) continue;
    const waarde = normaliseerDosering(`${getalNaarCijfer(treffer[1])} ${treffer[2]}`);
    uitkomst.set(doel, [...(uitkomst.get(doel) ?? []), waarde]);
  }
  return uitkomst;
}

/** Knipt uitsluitend het opgeloste allergiefragment uit een deelzin (C41). */
function zonderAllergiefragment(deelzin: string): string {
  let rest = deelzin;
  for (const regel of ALLERGIE_PATRONEN) {
    const treffer = regel.patroon.exec(rest);
    if (!treffer) continue;
    const term = knipAllergieterm(treffer[1]);
    const eind = treffer.index + (treffer[0].length - treffer[1].length) + term.length;
    rest = `${rest.slice(0, treffer.index)} ${rest.slice(eind)}`.replace(/\s+/g, " ").trim();
  }
  return rest;
}

function extraheerMedicatie(lijst: Medicatie[], tekst: string, volgnummer: number, isUitvraag: boolean): void {
  for (const ruweDeelzin of deelzinnen(tekst)) {
    // "allergisch voor amoxicilline" noemt een allergie, geen medicatie. Alleen
    // dát fragment gaat eruit — de rest van de deelzin ("… en gebruik
    // sertraline vijftig milligram") wordt wél op medicatie gescand (C41).
    const deelzin = zonderAllergiefragment(ruweDeelzin);
    if (deelzin.length === 0) continue;
    const middelen = middelenIn(deelzin);
    const doses = doseringenPerMiddel(deelzin, middelen);
    let gebruik = bepaalGebruik(deelzin);
    if (TOEDIENING_PATROON.test(deelzin)) gebruik = "huidig";
    if (isHistorisch(deelzin)) gebruik = "onbekend";
    const noteer = (middelnaam: string, dosering: string | null, ruweTekst: string): void => {
      // Een uitvraag van de behandelaar beweert geen gebruik (C40).
      if (isUitvraag || (HYPOTHETISCHE_UITSPRAAK.test(deelzin) && !VOORGESTELD_PATROON.test(deelzin))) {
        voegMedicatieToe(
          lijst,
          middelnaam,
          null,
          "onbekend",
          `${middelnaam} — uitgevraagd door behandelaar, bevestigen`,
          volgnummer,
        );
        return;
      }
      if (gebruik !== "gestopt" && isGestaakt(deelzin, middelnaam)) {
        voegMedicatieToe(lijst, middelnaam, dosering, "gestopt", `${middelnaam} — gestopt volgens cliënt`, volgnummer);
        return;
      }
      if (gebruik !== "gestopt" && isOntkend(deelzin, middelnaam)) {
        voegMedicatieToe(lijst, middelnaam, null, "onbekend", `${middelnaam} — ontkend, bevestigen`, volgnummer);
        return;
      }
      voegMedicatieToe(lijst, middelnaam, dosering, gebruik, ruweTekst, volgnummer);
    };
    for (const middel of middelen) {
      if (!middel.bekend && !INNAME_TERMEN.test(deelzin)) {
        voegMedicatieToe(
          lijst,
          middel.naam,
          null,
          "onbekend",
          `${middel.naam} — mogelijk medicijn, bevestigen`,
          volgnummer,
        );
        continue;
      }
      for (const dosering of doses.get(middel) ?? [null]) {
        noteer(middel.naam, dosering, `${middel.naam}${dosering ? ` ${dosering}` : ""}`);
      }
    }
  }
}

function extraheerAllergie(lijst: Allergiefeit[], tekst: string, volgnummer: number): void {
  for (const regel of ALLERGIE_PATRONEN) {
    const treffer = regel.patroon.exec(tekst);
    if (!treffer) continue;
    const middel = knipAllergieterm(treffer[1]).replace(/\s+/g, " ");
    if (middel.length === 0) continue;
    if (GEEN_ALLERGEEN.test(middel)) continue;
    // De ontkenning staat links van de treffer; de intolerantiepatronen dragen
    // zelf al "geen/niet" en worden daarom niet getoetst (C39). Een ontkende
    // allergie verdwijnt niet — zij wordt `onbekend` met een expliciet
    // achtervoegsel, zodat er geen regelalarm op vuurt terwijl het onderwerp
    // wél als besproken in de checklist blijft staan.
    const ontkend = regel.aard === "allergie" && ALLERGIE_ONTKENNING.test(tekst.slice(0, treffer.index));
    const aard: Allergiefeit["aard"] = ontkend ? "onbekend" : regel.aard;
    const label = ontkend ? `${middel}${ALLERGIE_ONTKEND_SUFFIX}` : middel;
    const bestaand = lijst.find((rij) => rij.tekst.toLowerCase() === label.toLowerCase());
    if (bestaand) {
      if (!bestaand.bron.includes(volgnummer)) bestaand.bron.push(volgnummer);
      // Monotoon: een uitgesproken opwaardering wint binnen dezelfde pass (C44).
      if (ALLERGIE_STRENGTE[aard] > ALLERGIE_STRENGTE[bestaand.aard]) bestaand.aard = aard;
      continue;
    }
    lijst.push({ ...feit(label, [volgnummer]), aard });
  }
}

function extraheerRisico(psychisch: Categoriefeit[], tekst: string, volgnummer: number): void {
  for (const risico of RISICO_CATEGORIEEN) {
    if (!risico.patroon.test(tekst)) continue;
    // Geen polariteit — ook niet wanneer de patiënt ontkent (S10).
    voegCategorieToe(psychisch, risico.categorie, `${risico.label} besproken — beoordeling behandelaar`, volgnummer);
  }
}

function bepaalActieSoort(tekst: string): TaakSoort | null {
  for (const regel of ACTIE_REGELS) {
    if (regel.patroon.test(tekst)) return regel.soort;
  }
  return null;
}

/**
 * Behandelaarsrapportage (N9): handmatig ingevoerde, DECLARATIEVE tekst van de
 * behandelaar zelf — het enige invoerpad zonder provider, en het vangnet in de
 * WebView en na een ontbrekend fragment. Wie na afloop dicteert ("cliënt is
 * bekend met COPD, gebruikt paliperidon depot") levert daarmee wél klinische
 * feiten; een VRAGENDE arts-zin blijft uitgesloten — dat is een uitvraag, geen
 * bevinding.
 */
export function isBehandelaarsrapportage(segment: ScribeSegment): boolean {
  return segment.bron === "handmatig" && segment.spreker === "arts" && !effectieveTekst(segment).trim().endsWith("?");
}

/**
 * Regelgebaseerde extractie over het hele transcript. Geeft een volledige
 * KlinischeStaat terug, inclusief de gecontroleerde medicatiewaarschuwingen
 * (§4.4) en de checklist "nog niet besproken" (§4.5).
 */
export function extraheerDeterministisch(
  segmenten: ScribeSegment[],
  consultType: ConsultType,
  taal: ScribeTaal = "nl",
): KlinischeStaat {
  const staat = legeKlinischeStaat();
  if (taal !== "nl") {
    return { ...staat, samenvatting: ENGELSE_HANDMATIGE_BEOORDELING };
  }
  for (const segment of segmenten) {
    if (segment.bron === "systeem") continue;
    const heleTekst = effectieveTekst(segment).trim();
    const uitspraken = beweringDelen(heleTekst);
    for (const tekst of uitspraken) {
      if (tekst.length === 0) continue;
      const nummer = segment.volgnummer;
      const isArts = segment.spreker === "arts";
      const isUitvraag = isVraag(tekst);
      const hypothetisch = HYPOTHETISCHE_UITSPRAAK.test(tekst);
      const historisch = isHistorisch(tekst);
      // N9: een behandelaar die zelf rapporteert draagt klinische feiten aan.
      const isRapportage = isBehandelaarsrapportage(segment) && !isUitvraag;
      const isPatient = segment.spreker === "patient";
      const meldtFeiten = (isPatient || isRapportage) && !isUitvraag && !hypothetisch;
      // Spreker en persoon waarover die spreekt zijn verschillende dingen.
      // Bij een onduidelijk familiezinsdeel blijven patiëntfeiten bewust leeg.
      if (betreftFamilie(tekst)) {
        if (meldtFeiten) voegFeitToe(staat.familieanamnese, tekst, nummer);
        continue;
      }
      if (segment.spreker === "overig" || segment.spreker === "onbekend") continue;

      // Risico eerst: een treffer mag nooit door een andere regel van polariteit
      // worden voorzien.
      extraheerRisico(staat.psychisch, tekst, nummer);

      if (meldtFeiten && !historisch && !staat.duur) {
        const duur = zoek(DUUR_PATROON, tekst);
        if (duur) staat.duur = `${duur[1].toLowerCase()} ${duur[2].toLowerCase()}`;
      }
      if (meldtFeiten && !historisch && !staat.beloop) {
        const beloop = BELOOP_TERMEN.find((term) => tekst.toLowerCase().includes(term));
        if (beloop) staat.beloop = beloop;
      }
      if (meldtFeiten && !historisch && !staat.ernst) {
        const ernst = ERNST_TERMEN.find((term) => new RegExp(`\\b${term}\\b`, "i").test(tekst));
        if (ernst) staat.ernst = ernst;
      }

      // Symptomen zijn wat de patiënt meldt; een uitvraag van de behandelaar is
      // geen symptoom (wel telt hij mee voor de checklist, zie hieronder).
      for (const regel of meldtFeiten && !historisch ? SYMPTOMEN : []) {
        const treffer = regel.patroon.exec(tekst);
        if (!treffer) continue;
        if (regel.normaal?.test(tekst)) continue;
        const intrinsiekeOntkenning =
          /^(?:verlies van interesse|verminderde eetlust)$/.test(regel.label) &&
          /\b(?:geen|nergens)\b/i.test(treffer[0]);
        const ontkend = !intrinsiekeOntkenning && isOntkend(tekst, treffer[1] ?? treffer[0]);
        const omschrijving = ontkend ? `${regel.label}: ontkend` : regel.label;
        const doel = /\b(daarnaast|ook nog|bijkomend|verder)\b/i.test(tekst)
          ? staat.begeleidendeSymptomen
          : staat.symptomen;
        voegFeitToe(doel, omschrijving, nummer);
        if (regel.psychisch && !ontkend) voegCategorieToe(staat.psychisch, regel.psychisch, regel.label, nummer);
        if (!staat.hoofdklacht && meldtFeiten && !ontkend) staat.hoofdklacht = regel.label;
      }

      for (const regel of LEEFSTIJL) {
        const leefstijlTreffer = regel.patroon.exec(tekst);
        if (!leefstijlTreffer) continue;
        const hoeveelheid = meldtFeiten && !historisch ? regel.hoeveelheid?.exec(tekst) : null;
        const ontkend =
          meldtFeiten && !historisch && !hoeveelheid && isOntkend(tekst, leefstijlTreffer[1] ?? leefstijlTreffer[0]);
        let detail = "besproken";
        if (hoeveelheid) detail = `${hoeveelheid[1].toLowerCase()} ${hoeveelheid[2].toLowerCase()}`;
        else if (ontkend) detail = "ontkend";
        voegCategorieToe(
          staat.leefstijl,
          regel.categorie,
          `${regel.label}: ${detail}`,
          nummer,
          Boolean(hoeveelheid) || ontkend,
        );
      }

      // Wettelijke en klinische GGZ-onderwerpen: alleen "besproken", nooit een
      // oordeel (N8).
      for (const onderwerp of CONTEXT_ONDERWERPEN) {
        if (!onderwerp.patroon.test(tekst)) continue;
        voegCategorieToe(staat.leefstijl, onderwerp.categorie, `${onderwerp.label}: besproken`, nummer);
      }

      extraheerMedicatie(staat.medicatie, tekst, nummer, isUitvraag);
      if (!isUitvraag && !hypothetisch) extraheerAllergie(staat.allergieen, tekst, nummer);

      if (meldtFeiten && VOORGESCHIEDENIS_PATROON.test(tekst)) voegFeitToe(staat.voorgeschiedenis, tekst, nummer);
      if (meldtFeiten && UITLOKKEND_PATROON.test(tekst)) voegFeitToe(staat.uitlokkendeFactoren, tekst, nummer);
      if (meldtFeiten && VERLICHTEND_PATROON.test(tekst)) voegFeitToe(staat.verlichtendeFactoren, tekst, nummer);

      // Alleen de behandelaar verricht metingen: Objectief/Onderzoek/Bevindingen
      // zijn per definitie waarnemingen van de behandelaar. Een getal uit de mond
      // van de cliënt is een gerapporteerd gegeven en hoort in de subjectieve
      // sectie — mét de omringende deelzin, anders leest "vier kilo"
      // (gewichtsVERLIES) als een gemeten gewicht (C49).
      const isMeetSegment = isArts;
      for (const deel of !isUitvraag && !hypothetisch && !historisch ? deelzinnen(tekst) : []) {
        if (!METING_PATROON.test(deel)) continue;
        const waarde = deel.slice(0, SCRIBE_LIMITS.feitTekst).toLowerCase();
        if (isMeetSegment) voegFeitToe(staat.metingen, waarde, nummer);
        // Subjectieve sectie: de eerste persoon eruit zodat "vier kilo
        // afgevallen" als gerapporteerd gegeven leesbaar blijft.
        else
          voegFeitToe(
            staat.begeleidendeSymptomen,
            waarde.replace(/^(?:en\s+)?ik (?:ben|heb|had|weeg)\s+/i, ""),
            nummer,
          );
      }
      if (isArts && !isUitvraag && !hypothetisch && !historisch && ONDERZOEK_PATROON.test(tekst))
        voegFeitToe(staat.onderzoek, tekst, nummer);

      // Overwegingen: uitsluitend wat de behandelaar zélf uitsprak (S10).
      if (isArts && !isUitvraag && !historisch && OVERWEGING_PATRONEN.some((patroon) => patroon.test(tekst))) {
        const citaat = uitspraken.every((deel) => !isVraag(deel) && !betreftFamilie(deel)) ? heleTekst : tekst;
        voegFeitToe(staat.overwegingen, citaat, nummer);
      }

      if (isArts && !isUitvraag && !historisch && !hypothetisch && !/\b(?:geen|niet|nooit)\b/i.test(tekst)) {
        const soort = bepaalActieSoort(tekst);
        if (soort) {
          const actieTekst = uitspraken.every(
            (deel) =>
              !isVraag(deel) &&
              !isHistorisch(deel) &&
              !HYPOTHETISCHE_UITSPRAAK.test(deel) &&
              !betreftFamilie(deel) &&
              !/\b(?:geen|niet|nooit)\b/i.test(deel) &&
              bepaalActieSoort(deel) === soort,
          )
            ? heleTekst
            : tekst;
          voegFeitToe(staat.plan, actieTekst, nummer);
          const omschrijving = actieTekst.slice(0, SCRIBE_LIMITS.taakOmschrijving);
          const bestaand = staat.acties.find((rij) => rij.omschrijving === omschrijving && rij.soort === soort);
          if (bestaand) {
            if (!bestaand.bron.includes(nummer)) bestaand.bron.push(nummer);
          } else {
            staat.acties.push({ ...feit(actieTekst, [nummer]), omschrijving, soort });
          }
        }
      }
    }
  }

  if (staat.hoofdklacht) {
    staat.samenvatting = staat.duur
      ? `${eersteHoofdletter(staat.hoofdklacht)} sinds ${staat.duur}.`
      : `${eersteHoofdletter(staat.hoofdklacht)}.`;
  }
  staat.waarschuwingen = controleerMedicatie(staat.medicatie, staat.allergieen);
  staat.ontbrekend = checklistOntbrekend(staat, consultType);
  return normaliseerRisicopolariteit(staat);
}

// ── Checklist "nog niet besproken" ──────────────────────────────────────────

export type ChecklistSleutel =
  | "duur"
  | "beloop"
  | "ernst"
  | "medicatie"
  | "allergieen"
  | "voorgeschiedenis"
  | "familie"
  | "leefstijl"
  | "slaap"
  | "werk"
  | "middelengebruik"
  | "suicidaliteit"
  | "psychose"
  | "veiligheid"
  | "metingen"
  | "onderzoek"
  | "plan"
  | "vervolg"
  // Wettelijke en klinische GGZ-onderwerpen (N8).
  | "kindcheck"
  | "zwangerschap"
  | "eerderePogingen"
  | "crisisplan"
  | "bijwerkingen"
  | "therapietrouw"
  | "somatischeScreening"
  | "dagbesteding"
  | "woonFinancien"
  | "vangnet";

export const CHECKLIST_TEKSTEN: Record<ChecklistSleutel, string> = {
  duur: "Duur van de klachten uitvragen",
  beloop: "Beloop sinds het begin uitvragen",
  ernst: "Ernst en beperkingen uitvragen",
  medicatie: "Actuele medicatie verifiëren",
  allergieen: "Allergieën verifiëren",
  voorgeschiedenis: "Voorgeschiedenis en eerdere behandelingen",
  familie: "Familieanamnese",
  leefstijl: "Leefstijl uitvragen",
  slaap: "Slaap uitvragen",
  werk: "Werk en sociale context",
  middelengebruik: "Middelengebruik (alcohol, drugs, roken) uitvragen",
  suicidaliteit: "Suïcidaliteit uitvragen",
  psychose: "Psychotische verschijnselen uitvragen",
  veiligheid: "Veiligheid van anderen en huiselijk geweld",
  metingen: "Metingen vastleggen",
  onderzoek: "Onderzoeksbevindingen vastleggen",
  plan: "Beleid afspreken",
  vervolg: "Vervolgafspraak maken",
  kindcheck: "Kindcheck: kinderen in het gezin en hun veiligheid",
  zwangerschap: "Zwangerschap, kinderwens en anticonceptie",
  eerderePogingen: "Eerdere suïcidepogingen",
  crisisplan: "Crisisplan en crisisafspraken",
  bijwerkingen: "Bijwerkingen van de medicatie uitvragen",
  therapietrouw: "Therapietrouw uitvragen",
  somatischeScreening: "Somatische/metabole controle bij antipsychotica",
  dagbesteding: "Dagbesteding en dagritme",
  woonFinancien: "Wonen, financiën en schulden",
  vangnet: "Vangnetadvies: wanneer contact opnemen",
};

export const CHECKLISTEN: Record<ConsultType, readonly ChecklistSleutel[]> = {
  soap: ["duur", "beloop", "medicatie", "allergieen", "voorgeschiedenis", "metingen", "onderzoek", "plan"],
  aobp: ["duur", "beloop", "medicatie", "allergieen", "voorgeschiedenis", "familie", "onderzoek", "plan"],
  soep: [
    "duur",
    "ernst",
    "medicatie",
    "allergieen",
    "leefstijl",
    "onderzoek",
    "bijwerkingen",
    "plan",
    "vangnet",
    "vervolg",
  ],
  // N8 — de psychiatrische intake draagt de wettelijke onderwerpen (kindcheck,
  // zwangerschap) én de klinische kern die eerder ontbrak.
  psychiatrie: [
    "suicidaliteit",
    "eerderePogingen",
    "crisisplan",
    "psychose",
    "veiligheid",
    "kindcheck",
    "zwangerschap",
    "middelengebruik",
    "slaap",
    "medicatie",
    "bijwerkingen",
    "therapietrouw",
    "allergieen",
    "somatischeScreening",
    "voorgeschiedenis",
    "familie",
    "werk",
    "woonFinancien",
    "plan",
    "vangnet",
    "vervolg",
  ],
  // Ambulante GGZ-rapportage, geen somatische lijst (N8).
  verpleegkundig: [
    "metingen",
    "medicatie",
    "bijwerkingen",
    "therapietrouw",
    "suicidaliteit",
    "dagbesteding",
    "plan",
    "vangnet",
    "vervolg",
  ],
  seh: ["duur", "ernst", "medicatie", "allergieen", "metingen", "onderzoek", "plan"],
  // Een vervolgconsult gaat juist over bijwerkingen, trouw en hercheck (N8).
  vervolg: ["beloop", "suicidaliteit", "medicatie", "bijwerkingen", "therapietrouw", "plan", "vervolg"],
  ontslag: ["medicatie", "allergieen", "onderzoek", "plan", "vangnet", "vervolg"],
};

function categorieBron(lijst: Categoriefeit[], categorieen: string[]): number[] | null {
  const treffers = lijst.filter((rij) => categorieen.includes(rij.categorie));
  if (treffers.length === 0) return null;
  return [...new Set(treffers.flatMap((rij) => rij.bron))].sort((links, rechts) => links - rechts);
}

function lijstBron(lijst: { bron: number[]; ingetrokken?: boolean }[]): number[] | null {
  const actief = lijst.filter((rij) => rij.ingetrokken !== true);
  if (actief.length === 0) return null;
  return [...new Set(actief.flatMap((rij) => rij.bron))].sort((links, rechts) => links - rechts);
}

function besprokenBron(staat: KlinischeStaat, sleutel: ChecklistSleutel): number[] | null {
  switch (sleutel) {
    case "duur":
      return staat.duur ? [] : null;
    case "beloop":
      return staat.beloop ? [] : null;
    case "ernst":
      return staat.ernst ? [] : null;
    case "medicatie":
      return lijstBron(staat.medicatie);
    case "allergieen":
      return lijstBron(staat.allergieen);
    case "voorgeschiedenis":
      return lijstBron(staat.voorgeschiedenis);
    case "familie":
      return lijstBron(staat.familieanamnese);
    case "leefstijl":
      // Alleen de echte leefstijlcategorieën — de GGZ-contextonderwerpen (N8)
      // delen dezelfde lijst maar hebben hun eigen checklist-items.
      return categorieBron(
        staat.leefstijl,
        LEEFSTIJL.map((regel) => regel.categorie),
      );
    case "slaap":
      return categorieBron(staat.leefstijl, ["slaap"]);
    case "werk":
      return categorieBron(staat.leefstijl, ["werk"]);
    case "middelengebruik":
      return categorieBron(staat.leefstijl, ["alcohol", "drugs", "roken"]);
    case "suicidaliteit":
      return categorieBron(staat.psychisch, ["suicidaliteit"]);
    case "psychose":
      return categorieBron(staat.psychisch, ["psychose"]);
    case "veiligheid":
      return categorieBron(staat.psychisch, ["veiligheid", "huiselijk-geweld"]);
    case "metingen":
      return lijstBron(staat.metingen);
    case "onderzoek":
      return lijstBron(staat.onderzoek);
    case "plan":
      return lijstBron(staat.plan);
    case "vervolg": {
      const vervolg = staat.acties.filter((rij) => rij.soort === "vervolgafspraak");
      return vervolg.length === 0 ? null : lijstBron(vervolg);
    }
    case "kindcheck":
      return categorieBron(staat.leefstijl, ["kindcheck"]);
    case "zwangerschap":
      return categorieBron(staat.leefstijl, ["zwangerschap"]);
    case "eerderePogingen":
      return categorieBron(staat.leefstijl, ["eerdere-pogingen"]);
    case "crisisplan":
      return categorieBron(staat.leefstijl, ["crisisplan"]);
    case "bijwerkingen":
      return categorieBron(staat.leefstijl, ["bijwerkingen"]);
    case "therapietrouw":
      return categorieBron(staat.leefstijl, ["therapietrouw"]);
    case "somatischeScreening":
      return categorieBron(staat.leefstijl, ["somatische-screening"]);
    case "dagbesteding":
      return categorieBron(staat.leefstijl, ["dagbesteding"]);
    case "woonFinancien":
      return categorieBron(staat.leefstijl, ["woon-financien"]);
    case "vangnet":
      return categorieBron(staat.leefstijl, ["vangnet"]);
    default:
      return null;
  }
}

/**
 * Vaste checklist per consulttype. Een item verdwijnt nooit: het schuift van
 * `open` naar `besproken` en blijft — grijs, met bron — zichtbaar, zodat de
 * behandelaar ziet dát het onderwerp aan bod is geweest.
 */
export function checklistOntbrekend(staat: KlinischeStaat, consultType: ConsultType): OntbrekendItem[] {
  return CHECKLISTEN[consultType].map((sleutel) => {
    const bron = besprokenBron(staat, sleutel);
    return {
      tekst: CHECKLIST_TEKSTEN[sleutel],
      status: bron === null ? "open" : "besproken",
      bron: bron ?? [],
    };
  });
}

// ── Verslagopbouw ───────────────────────────────────────────────────────────

type StaatVeld =
  | "hoofdklacht"
  | "duur"
  | "beloop"
  | "ernst"
  | "symptomen"
  | "begeleidendeSymptomen"
  | "uitlokkendeFactoren"
  | "verlichtendeFactoren"
  | "medicatie"
  | "allergieen"
  | "voorgeschiedenis"
  | "familieanamnese"
  | "leefstijl"
  | "psychisch"
  | "metingen"
  | "onderzoek"
  | "plan"
  | "acties"
  /** Alleen de vervolgafspraken — eigen sleutelruimte, zodat een vervolgsectie
   *  niet leeg raakt doordat het beleid dezelfde zin al noemde. */
  | "vervolgacties";

/**
 * Welke staatsvelden een sectie voedt. N2: medicatie, allergieën,
 * voorgeschiedenis en leefstijl vielen in vier van de acht formaten (soap,
 * soep, verpleegkundig, vervolg) uit ELKE sectie — het aanwijzingenpaneel
 * waarschuwde dan over een allergie die het goedgekeurde verslag niet noemde.
 * `verify:careon` toetst formaat-onafhankelijk dat elke medicatie- en
 * allergieregel voor élk consulttype in minstens één sectie belandt.
 */
const SECTIE_INHOUD: Record<string, readonly StaatVeld[]> = {
  subjectief: [
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
  ],
  anamnese: [
    "hoofdklacht",
    "duur",
    "beloop",
    "ernst",
    "symptomen",
    "medicatie",
    "allergieen",
    "voorgeschiedenis",
    "familieanamnese",
  ],
  objectief: ["metingen", "onderzoek"],
  onderzoek: ["metingen", "onderzoek"],
  plan: ["plan", "acties"],
  "reden-van-komst": ["hoofdklacht", "duur", "beloop"],
  // `psychisch` hoort bij het psychiatrisch onderzoek, niet ook hier: anders
  // staat hetzelfde feit twee secties lang in hetzelfde verslag (C50/N7).
  "speciele-anamnese": ["symptomen", "begeleidendeSymptomen", "uitlokkendeFactoren", "verlichtendeFactoren"],
  "psychiatrisch-onderzoek": ["psychisch", "onderzoek"],
  "somatiek-medicatie": ["medicatie", "allergieen", "voorgeschiedenis"],
  "sociale-anamnese": ["leefstijl", "familieanamnese"],
  beleid: ["plan", "acties"],
  observaties: ["hoofdklacht", "duur", "ernst", "symptomen", "metingen", "psychisch", "medicatie", "allergieen"],
  interventies: ["plan"],
  vervolg: ["vervolgacties"],
  "reden-triage": ["hoofdklacht", "ernst"],
  "beleid-vervolg": ["plan", "acties"],
  "beloop-sinds-vorig-contact": ["beloop", "symptomen"],
  "huidige-klachten": ["hoofdklacht", "symptomen", "ernst", "medicatie", "allergieen"],
  bevindingen: ["metingen", "onderzoek"],
  opnamereden: ["hoofdklacht", "duur"],
  beloop: ["beloop", "symptomen"],
  "bevindingen-onderzoeken": ["metingen", "onderzoek"],
  "medicatie-bij-ontslag": ["medicatie", "allergieen"],
  vervolgafspraken: ["vervolgacties"],
  adviezen: ["plan"],
};

export const NIET_BESPROKEN_TEKST = "Niet besproken tijdens dit consult.";

function scalarLabel(veld: "hoofdklacht" | "duur" | "beloop" | "ernst"): string {
  switch (veld) {
    case "hoofdklacht":
      return "Hoofdklacht";
    case "duur":
      return "Duur";
    case "beloop":
      return "Beloop";
    default:
      return "Ernst";
  }
}

/**
 * Eén feit in het verslag. `sleutel` draagt de ONDERLIGGENDE feittekst, niet de
 * gerenderde regel: alleen zo herkent de ontdubbeling dat `plan` en `acties`
 * (en `symptomen` en `psychisch`) hetzelfde feit dragen (C50).
 */
interface VerslagRij {
  sleutel: string;
  tekst: string;
  bron: number[];
}

function rijenVoorVeld(staat: KlinischeStaat, veld: StaatVeld): VerslagRij[] {
  if (veld === "hoofdklacht" || veld === "duur" || veld === "beloop" || veld === "ernst") {
    const waarde = staat[veld];
    // Eigen sleutelruimte: "Hoofdklacht: somberheid" mag nooit tegen een
    // symptoomregel "somberheid" wegvallen.
    return waarde ? [{ sleutel: `${veld}|${waarde.toLowerCase()}`, tekst: waarde, bron: [] }] : [];
  }
  if (veld === "medicatie") {
    return staat.medicatie
      .filter((rij) => !rij.ingetrokken)
      .map((rij) => ({
        sleutel: `medicatie|${normaliseerMiddel(rij.naam)}|${rij.gebruik}`,
        tekst: medicatieRegel(rij),
        bron: [...rij.bron],
      }));
  }
  if (veld === "allergieen") {
    return staat.allergieen
      .filter((rij) => !rij.ingetrokken)
      .map((rij) => ({
        sleutel: `allergie|${normaliseerMiddel(rij.tekst)}`,
        tekst: `${rij.tekst} (${rij.aard})`,
        bron: [...rij.bron],
      }));
  }
  if (veld === "vervolgacties") {
    return staat.acties
      .filter((rij) => !rij.ingetrokken && rij.soort === "vervolgafspraak")
      .map((rij) => ({
        sleutel: `vervolgactie|${rij.tekst.trim().toLowerCase()}`,
        tekst: rij.tekst,
        bron: [...rij.bron],
      }));
  }
  if (veld === "psychisch") {
    return staat.psychisch
      .filter((rij) => !rij.ingetrokken)
      .map((rij) => ({
        sleutel: rij.tekst.trim().toLowerCase(),
        // S10: een risicofeit blijft letterlijk staan, zonder categorie-as en
        // zonder polariteit.
        tekst: isRisicofeit(rij) ? rij.tekst : `${eersteHoofdletter(rij.categorie)}: ${rij.tekst}`,
        bron: [...rij.bron],
      }));
  }
  const lijst = staat[veld] as { tekst: string; bron: number[]; ingetrokken: boolean }[];
  return lijst
    .filter((rij) => !rij.ingetrokken)
    .map((rij) => ({ sleutel: rij.tekst.trim().toLowerCase(), tekst: rij.tekst, bron: [...rij.bron] }));
}

const RISICO_CATEGORIE_NAMEN: ReadonlySet<string> = new Set(RISICO_CATEGORIEEN.map((rij) => rij.categorie));

function isRisicofeit(rij: Categoriefeit): boolean {
  return RISICO_CATEGORIE_NAMEN.has(rij.categorie);
}

// ── Zinsassemblage (N7) ─────────────────────────────────────────────────────
//
// Zonder AI is deze laag het ENIGE actieve verslagpad. Een trefwoordenlijst
// ("- somberheid (§2, §4)") moet de behandelaar alsnog volledig herschrijven;
// dan is de tijdwinst negatief. Daarom bouwt elke sectie Nederlandse zinnen,
// worden eerste-persoonsconstructies uit het beleid gehaald, worden feiten die
// al in een eerdere sectie staan niet herhaald, en staan de §-verwijzingen
// gebundeld aan het eind van de sectie. Wat geen zinsvorm heeft, valt terug op
// de opsomming.

function opsomming(waarden: string[]): string {
  if (waarden.length <= 1) return waarden.join("");
  return `${waarden.slice(0, -1).join(", ")} en ${waarden[waarden.length - 1]}`;
}

function alsZin(tekst: string): string {
  const schoon = tekst.trim();
  if (schoon.length === 0) return schoon;
  return /[.!?]$/.test(schoon) ? schoon : `${schoon}.`;
}

function zinnenVan(waarden: string[]): string {
  return waarden.map(alsZin).join(" ");
}

const ZIN_SJABLONEN: Partial<Record<StaatVeld, (waarden: string[]) => string>> = {
  symptomen: (waarden) => `Cliënt meldt ${opsomming(waarden)}.`,
  begeleidendeSymptomen: (waarden) => `Daarnaast ${opsomming(waarden)}.`,
  uitlokkendeFactoren: (waarden) => `Uitlokkend: ${zinnenVan(waarden)}`,
  verlichtendeFactoren: (waarden) => `Verlichtend: ${zinnenVan(waarden)}`,
  medicatie: (waarden) => `Medicatie: ${opsomming(waarden)}.`,
  allergieen: (waarden) => `Allergieën: ${opsomming(waarden)}.`,
  voorgeschiedenis: (waarden) => `Voorgeschiedenis: ${zinnenVan(waarden)}`,
  familieanamnese: (waarden) => `Familieanamnese: ${zinnenVan(waarden)}`,
  leefstijl: (waarden) => `Leefstijl en context: ${waarden.join("; ")}.`,
  metingen: (waarden) => `Gemeten: ${opsomming(waarden)}.`,
  onderzoek: (waarden) => `Bij onderzoek: ${zinnenVan(waarden)}`,
};

/** Aanhef van een beleidszin die in de derde persoon hoort te staan. */
const EERSTE_PERSOON_AANHEF: readonly RegExp[] = [
  /^ik wil(?: graag)?\s+/i,
  /^ik ga\s+/i,
  /^ik zal\s+/i,
  /^ik stel voor(?: om)?\s+/i,
  /^we doen\s+/i,
  /^we maken\s+/i,
  /^wij doen\s+/i,
  /^wij maken\s+/i,
];

const EERSTE_PERSOON_VERVANGING: readonly { patroon: RegExp; vervanging: string }[] = [
  // Scheidbaar werkwoord eerst: "ik vraag … aan" → "aanvragen …".
  { patroon: /\bik vraag\b(.*?)\s+\baan\b/gi, vervanging: "aanvragen$1" },
  { patroon: /\bik geef u\b/gi, vervanging: "cliënt krijgt" },
  { patroon: /\bik geef\b/gi, vervanging: "cliënt krijgt" },
  { patroon: /\bik schrijf\b/gi, vervanging: "voorschrijven:" },
  { patroon: /\bik verwijs\b/gi, vervanging: "verwijzing" },
  { patroon: /\bik overleg\b/gi, vervanging: "overleg" },
  { patroon: /\bik bespreek\b/gi, vervanging: "bespreken" },
  { patroon: /\bik controleer\b/gi, vervanging: "controleren" },
  { patroon: /\bik plan\b/gi, vervanging: "plannen" },
];

const DOSERING_IN_ZIN = new RegExp(`(${GETAL_PATROON})\\s*(mg|milligram|mcg|microgram|ml|milliliter|gram)\\b`, "gi");

/** "ophogen naar honderd milligram" → "ophogen naar 100 mg". */
function normaliseerDoseringenInZin(zin: string): string {
  return zin.replace(DOSERING_IN_ZIN, (_treffer, getal: string, eenheid: string) =>
    normaliseerDosering(`${getalNaarCijfer(getal)} ${eenheid}`),
  );
}

/** Beleidsregel als verslagzin: geen "ik", genormaliseerde doseringen. */
export function beleidszin(tekst: string): string {
  let zin = tekst.trim();
  for (const patroon of EERSTE_PERSOON_AANHEF) zin = zin.replace(patroon, "");
  for (const regel of EERSTE_PERSOON_VERVANGING) zin = zin.replace(regel.patroon, regel.vervanging);
  zin = zin.replace(/^(?:de|het|een)\s+/i, "");
  zin = normaliseerDoseringenInZin(zin).replace(/\s+/g, " ").trim();
  return alsZin(eersteHoofdletter(zin));
}

function openingszin(staat: KlinischeStaat, velden: readonly StaatVeld[]): string | null {
  const heeft = (veld: StaatVeld): boolean => velden.includes(veld);
  const hoofdklacht = heeft("hoofdklacht") ? staat.hoofdklacht : null;
  const duur = heeft("duur") ? staat.duur : null;
  const beloop = heeft("beloop") ? staat.beloop : null;
  const ernst = heeft("ernst") ? staat.ernst : null;
  const staart: string[] = [];
  if (beloop) staart.push(`beloop ${beloop}`);
  if (ernst) staart.push(`ernst ${ernst}`);
  if (hoofdklacht) {
    let zin = `Cliënt meldt ${hoofdklacht}`;
    if (duur) zin += ` sinds ${duur}`;
    if (staart.length > 0) zin += `, ${staart.join(", ")}`;
    return `${zin}.`;
  }
  const losse: string[] = [];
  if (duur) losse.push(`${scalarLabel("duur")}: ${duur}`);
  if (beloop) losse.push(`${scalarLabel("beloop")}: ${beloop}`);
  if (ernst) losse.push(`${scalarLabel("ernst")}: ${ernst}`);
  return losse.length > 0 ? `${losse.join(". ")}.` : null;
}

const SCALAIRE_VELDEN: readonly StaatVeld[] = ["hoofdklacht", "duur", "beloop", "ernst"];

interface SectieOpbouw {
  tekst: string;
  bron: number[];
}

/**
 * Bouwt de tekst van één niet-★-sectie. `gezien` draagt de sleutels van feiten
 * die al in een eerdere sectie staan; een sectie herhaalt zo'n feit alleen
 * wanneer zij anders leeg zou zijn — een lege sectie zou beweren dat er niets
 * besproken is, en dat is een positief onjuiste uitspraak.
 */
function bouwSectie(staat: KlinischeStaat, velden: readonly StaatVeld[], gezien: Set<string>): SectieOpbouw {
  const perVeld = new Map<StaatVeld, VerslagRij[]>();
  const binnenSectie = new Set<string>();
  let iets = false;
  let ietsNieuw = false;
  for (const veld of velden) {
    const rijen: VerslagRij[] = [];
    for (const rij of rijenVoorVeld(staat, veld)) {
      if (binnenSectie.has(rij.sleutel)) continue;
      binnenSectie.add(rij.sleutel);
      iets = true;
      rijen.push(rij);
      if (!gezien.has(rij.sleutel)) ietsNieuw = true;
    }
    perVeld.set(veld, rijen);
  }
  if (!iets) return { tekst: NIET_BESPROKEN_TEKST, bron: [] };

  const zinnen: string[] = [];
  const bron: number[] = [];
  const neem = (rijen: VerslagRij[]): VerslagRij[] =>
    ietsNieuw ? rijen.filter((rij) => !gezien.has(rij.sleutel)) : rijen;

  const scalairen = velden.filter((veld) => SCALAIRE_VELDEN.includes(veld));
  const scalaireRijen = neem(scalairen.flatMap((veld) => perVeld.get(veld) ?? []));
  if (scalaireRijen.length > 0) {
    const opening = openingszin(
      staat,
      scalairen.filter((veld) => scalaireRijen.some((rij) => rij.sleutel.startsWith(`${veld}|`))),
    );
    if (opening) zinnen.push(opening);
    for (const rij of scalaireRijen) {
      gezien.add(rij.sleutel);
      bron.push(...rij.bron);
    }
  }

  for (const veld of velden) {
    if (SCALAIRE_VELDEN.includes(veld)) continue;
    const rijen = neem(perVeld.get(veld) ?? []);
    if (rijen.length === 0) continue;
    for (const rij of rijen) {
      gezien.add(rij.sleutel);
      bron.push(...rij.bron);
    }
    if (veld === "plan" || veld === "acties" || veld === "vervolgacties") {
      for (const rij of rijen) zinnen.push(beleidszin(rij.tekst));
      continue;
    }
    if (veld === "psychisch") {
      const risico = rijen.filter((rij) => /beoordeling behandelaar/.test(rij.tekst));
      const overig = rijen.filter((rij) => !/beoordeling behandelaar/.test(rij.tekst));
      if (overig.length > 0) zinnen.push(`Psychisch functioneren: ${overig.map((rij) => rij.tekst).join("; ")}.`);
      for (const rij of risico) zinnen.push(alsZin(rij.tekst));
      continue;
    }
    const sjabloon = ZIN_SJABLONEN[veld];
    if (sjabloon) {
      zinnen.push(sjabloon(rijen.map((rij) => rij.tekst)));
      continue;
    }
    // Terugval: geen passende zinsvorm, dan de opsomming.
    for (const rij of rijen) zinnen.push(`- ${rij.tekst}`);
  }

  if (zinnen.length === 0) return { tekst: NIET_BESPROKEN_TEKST, bron: [] };
  const uniek = [...new Set(bron)].sort((links, rechts) => links - rechts);
  const herkomst = uniek.length > 0 ? ` (${uniek.map((nummer) => `§${nummer}`).join(", ")})` : "";
  return { tekst: `${zinnen.join(" ")}${herkomst}`, bron: uniek };
}

// ── Risicopolariteit (S10/C42) ──────────────────────────────────────────────

const RISICO_ZINSGRENS = /(?<=[.;\n])\s+/;

/**
 * Herschrijft elke ZIN die een risicocategorie raakt tot de vaste, polariteit-
 * loze formulering. Bedoeld voor tekst die NIET uit de deterministische laag
 * komt: een modelantwoord dat "geen suïcidale gedachten" schrijft mag zo'n
 * uitspraak nooit het verslag in krijgen (S10). Zinnen zonder risicotreffer
 * blijven ongemoeid.
 */
export function normaliseerRisicozin(tekst: string): string {
  const uitkomst: string[] = [];
  for (const zin of tekst.split(RISICO_ZINSGRENS)) {
    const treffer = RISICO_CATEGORIEEN.find((risico) => risico.patroon.test(zin));
    if (!treffer) {
      uitkomst.push(zin);
      continue;
    }
    const schoon = zin.trim();
    const staart = /[.;]$/.test(schoon) ? schoon.slice(-1) : "";
    const vervangen = `${treffer.label} besproken — beoordeling behandelaar${staart}`;
    if (uitkomst.length > 0 && uitkomst[uitkomst.length - 1] === vervangen) continue;
    uitkomst.push(vervangen);
  }
  return uitkomst.join(" ");
}

/** Velden waarin vrije tekst uit een modelpass kan binnenkomen. */
/**
 * S10 als code, niet als prompt: risicocategorieën krijgen van GEEN ENKELE laag
 * polariteit. Een `psychisch`-rij die een risicocategorie raakt wordt volledig
 * teruggebracht tot de vaste zin (categorie inbegrepen); vrije tekstvelden
 * worden per zin genormaliseerd. `bron`, `ingetrokken`, `ontbrekend` en
 * `acties` blijven ongemoeid — die dragen de checklist- en taakformulering.
 * Idempotent: op deterministische uitvoer verandert er niets.
 */
export function normaliseerRisicopolariteit(staat: KlinischeStaat, inclusiefScalair = true): KlinischeStaat {
  const psychisch = staat.psychisch.map((rij) => {
    if (rij.doorBehandelaar) return rij;
    const treffer = RISICO_CATEGORIEEN.find(
      (risico) =>
        risico.categorie === rij.categorie.trim().toLowerCase() ||
        risico.patroon.test(rij.categorie) ||
        risico.patroon.test(rij.tekst),
    );
    if (!treffer) return rij;
    const vast = `${treffer.label} besproken — beoordeling behandelaar`;
    if (rij.categorie === treffer.categorie && rij.tekst === vast) return rij;
    return { ...rij, categorie: treffer.categorie, tekst: vast };
  });
  const genormaliseerd: KlinischeStaat = {
    ...staat,
    psychisch,
  };
  // Alleen nieuwe machine-invoer mag scalair worden aangepast. Bestaande
  // waarden kunnen door een behandelaar zijn vastgelegd; er is geen
  // scalair eigendomsveld in de oudere staatvorm.
  if (inclusiefScalair) {
    for (const veld of ["samenvatting", "hoofdklacht", "duur", "beloop", "ernst"] as const) {
      const waarde = staat[veld];
      if (typeof waarde === "string") genormaliseerd[veld] = normaliseerRisicozin(waarde);
    }
  }
  for (const veld of Object.keys(staat) as (keyof KlinischeStaat)[]) {
    // Literal source excerpts are not clinical assertions. Never rewrite their
    // negation or risk wording: the clinician needs the original conversation.
    if (veld === "psychisch" || veld === "gesprekscontext") continue;
    const rijen = genormaliseerd[veld];
    if (!Array.isArray(rijen)) continue;
    // Door de behandelaar vastgelegde feiten worden niet machinaal herschreven.
    const schoon = rijen.map((rij) => {
      const record = rij as unknown as Record<string, unknown>;
      if (record.doorBehandelaar === true) return rij;
      return Object.fromEntries(
        Object.entries(record).map(([sleutel, waarde]) => [
          sleutel,
          typeof waarde === "string" &&
          ["tekst", "omschrijving", "naam", "dosering", "categorie"].includes(sleutel) &&
          (!(veld === "ontbrekend" || veld === "acties" || sleutel === "categorie") ||
            /\b(?:geen|niet|ontken\w*|aanwezig|afwezig|wel|laag|hoog|verhoogd|no|not|denies|denied|absent|present|positive|negative|low|high|increased)\b/i.test(
              waarde,
            ))
            ? normaliseerRisicozin(waarde)
            : waarde,
        ]),
      );
    });
    Object.assign(genormaliseerd, { [veld]: schoon });
  }
  return genormaliseerd;
}

/**
 * Deterministisch verslag in het formaat van de discipline.
 *
 * ★-secties (`vereistBehandelaar`) worden NOOIT machinaal geschreven: hun
 * `tekst` blijft leeg met status `leeg`. `conceptTekst` draagt uitsluitend
 * CITATEN uit het consult, en sectie-specifiek (C48): een risicosectie citeert
 * de risicofeiten uit `staat.psychisch` — zonder polariteit — en elke andere
 * ★-sectie de door de behandelaar uitgesproken overwegingen. Gatsegmenten
 * (`bron: "systeem"`) leiden tot een kopnoot op de eerste sectie zodat een
 * ontbrekend fragment nooit onzichtbaar in het verslag verdwijnt.
 */
export function bouwVerslagDeterministisch(
  staat: KlinischeStaat,
  segmenten: ScribeSegment[],
  consultType: ConsultType,
  taal: ScribeTaal = "nl",
): VerslagSectie[] {
  const formaat = formaatVoor(consultType);
  const gaten = segmenten.filter((segment) => segment.bron === "systeem");
  const kopnoot = gaten.length > 0 ? `Let op: ${gaten.length} fragmenten ontbreken in het transcript.` : "";
  const overwegingen = staat.overwegingen.filter((rij) => !rij.ingetrokken);
  const risicofeiten = staat.psychisch.filter((rij) => !rij.ingetrokken && isRisicofeit(rij));
  const gezien = new Set<string>();
  const bronContext = geldigeGesprekscontext(staat.gesprekscontext ?? [], segmenten, consultType);

  return formaat.secties.map((definitie, index) => {
    const engelsHandmatig = taal === "en";
    const vereistBehandelaar = definitie.vereistBehandelaar === true || engelsHandmatig;
    let conceptTekst: string;
    let bron: number[];
    if (definitie.vereistBehandelaar === true) {
      const isRisico = definitie.soort === "risico";
      const rijen = isRisico ? risicofeiten : overwegingen;
      const regels = rijen.map((rij) => {
        const herkomst = rij.bron.map((nummer) => `§${nummer}`).join(", ");
        return isRisico ? `${rij.tekst} (${herkomst})` : `Uitgesproken overwegingen (${herkomst}): ${rij.tekst}`;
      });
      conceptTekst = regels.join("\n");
      bron = rijen.flatMap((rij) => rij.bron);
    } else {
      const opbouw = bouwSectie(staat, SECTIE_INHOUD[definitie.id] ?? [], gezien);
      conceptTekst = opbouw.tekst;
      bron = opbouw.bron;
    }
    const citatenContext = renderGesprekscontext(bronContext, definitie.id);
    if (engelsHandmatig && !definitie.vereistBehandelaar) {
      const feiten = renderEnglishFacts(staat, segmenten, definitie.id);
      if (feiten.tekst) {
        const tekst = index === 0 && kopnoot ? `${kopnoot}\n\n${feiten.tekst}` : feiten.tekst;
        if (tekst.length <= SCRIBE_LIMITS.sectieTekst) {
          return {
            id: definitie.id,
            titel: definitie.titel,
            conceptTekst: tekst,
            tekst,
            status: "concept",
            bron: feiten.bron,
            vereistBehandelaar: true,
          };
        }
      }
    }
    // Retain clinician-entered and previously validated facts. Source excerpts
    // supplement empty sections; they must never replace already captured facts.
    const heeftVastgelegdeInhoud = conceptTekst.trim().length > 0 && conceptTekst !== NIET_BESPROKEN_TEKST;
    if (engelsHandmatig && citatenContext.tekst && !heeftVastgelegdeInhoud) {
      // These prefills remain outside bulk approval and cannot be approved
      // unchanged. Actual assessment sections still have no machine text.
      const tekst = index === 0 && kopnoot ? `${kopnoot}\n\n${citatenContext.tekst}` : citatenContext.tekst;
      if (tekst.length <= SCRIBE_LIMITS.sectieTekst) {
        return {
          id: definitie.id,
          titel: definitie.titel,
          conceptTekst: tekst,
          tekst: definitie.vereistBehandelaar ? "" : tekst,
          status: definitie.vereistBehandelaar ? "leeg" : "concept",
          bron: citatenContext.bron,
          vereistBehandelaar: true,
        };
      }
      // Do not truncate an exact quote and accidentally remove its negation.
      return {
        id: definitie.id,
        titel: definitie.titel,
        conceptTekst:
          "Er zijn te veel broncitaten voor één verslagsectie. Bekijk de gekoppelde transcriptregels en werk deze uit tot een gecontroleerde notitie.",
        tekst: "",
        status: "leeg",
        bron: citatenContext.bron,
        vereistBehandelaar: true,
      };
    }
    if (engelsHandmatig) {
      conceptTekst = `${ENGELSE_HANDMATIGE_BEOORDELING}${conceptTekst && conceptTekst !== NIET_BESPROKEN_TEKST ? `\n\nEerder vastgelegde context (controleer):\n${conceptTekst}` : ""}`;
    }
    const metKop = index === 0 && kopnoot.length > 0 ? `${kopnoot}\n\n${conceptTekst}`.trim() : conceptTekst;
    return {
      id: definitie.id,
      titel: definitie.titel,
      conceptTekst: metKop.slice(0, SCRIBE_LIMITS.sectieTekst),
      // ★: de behandelaar schrijft zelf; anders is het concept de starttekst.
      tekst: vereistBehandelaar ? "" : metKop.slice(0, SCRIBE_LIMITS.sectieTekst),
      status: vereistBehandelaar ? "leeg" : "concept",
      bron: [...new Set(bron)].sort((links, rechts) => links - rechts),
      vereistBehandelaar,
    };
  });
}

// ── Eén deterministische ronde (C21) ────────────────────────────────────────

export interface SprekerRondeUitkomst {
  volgnummer: number;
  spreker: Spreker;
}

export interface CorrectieRondeUitkomst {
  volgnummer: number;
  tekstGecorrigeerd: string;
}

export interface DeterministischeRondeUitkomst {
  staat: KlinischeStaat;
  sprekers: SprekerRondeUitkomst[];
  correcties: CorrectieRondeUitkomst[];
}

/**
 * Gecontroleerde medicatieregels zijn altijd bepalend: de regellaag draait na
 * elke pass opnieuw en vervangt de vorige `regel`-waarschuwingen. AI-signalen
 * (`herkomst: "model"`) blijven ernaast staan — de UI toont ze gescheiden.
 * Tegelijk is dit de enige trechter waardoor élke staat gaat, dus hier wordt
 * ook de S10-polariteitsregel afgedwongen (C42).
 */
export function rondStaatAf(staat: KlinischeStaat): KlinischeStaat {
  const modelSignalen = staat.waarschuwingen.filter((rij) => rij.herkomst === "model");
  const regels = controleerMedicatie(staat.medicatie, staat.allergieen);
  return normaliseerRisicopolariteit({ ...staat, waarschuwingen: [...regels, ...modelSignalen] }, false);
}

/**
 * Eén volledige deterministische analyseronde: extractie, merge met de vorige
 * staat, sprekerheuristiek en ASR-woordenlijst. Zowel de serverroute als het
 * demo-pad draaien deze functie, zodat de twee paden niet uit elkaar kunnen
 * lopen (C21).
 */
export function deterministischeRonde(
  alle: ScribeSegment[],
  nieuwe: ScribeSegment[],
  consultType: ConsultType,
  vorigeStaat: KlinischeStaat,
  taal: ScribeTaal = "nl",
): DeterministischeRondeUitkomst {
  if (taal !== "nl") {
    return {
      staat: {
        ...vorigeStaat,
        samenvatting:
          vorigeStaat.samenvatting || (vorigeStaat.gesprekscontext?.length ? "" : ENGELSE_HANDMATIGE_BEOORDELING),
      },
      sprekers: [],
      correcties: [],
    };
  }
  const sprekers: SprekerRondeUitkomst[] = [];
  const correcties: CorrectieRondeUitkomst[] = [];
  const nieuweNummers = new Set(nieuwe.map((segment) => segment.volgnummer));
  let vorige: Spreker = "onbekend";
  const effectief = alle.map((segment) => {
    const kopie = { ...segment };
    if (nieuweNummers.has(segment.volgnummer) && segment.correctieBron !== "behandelaar") {
      const tekst = corrigeerTranscriptDeterministisch(effectieveTekst(segment));
      if (tekst) {
        correcties.push({ volgnummer: segment.volgnummer, tekstGecorrigeerd: tekst });
        kopie.tekstGecorrigeerd = tekst;
        kopie.correctieBron = "ai";
      }
    }
    if (kopie.spreker === "onbekend") {
      kopie.spreker = bepaalSpreker(effectieveTekst(kopie), vorige);
      if (nieuweNummers.has(segment.volgnummer) && kopie.spreker !== "onbekend") {
        sprekers.push({ volgnummer: segment.volgnummer, spreker: kopie.spreker });
      }
    }
    vorige = kopie.spreker;
    return kopie;
  });
  const nieuweStaat = extraheerDeterministisch(effectief, consultType, taal);
  return { staat: rondStaatAf(mergeKlinischeStaat(vorigeStaat, nieuweStaat)), sprekers, correcties };
}

// ── Taken & transcriptcorrectie ─────────────────────────────────────────────

/** Vervolgacties uit de staat, ontdubbeld op omschrijving + soort. */
export function extraheerTaken(staat: KlinischeStaat): Actie[] {
  const gezien = new Set<string>();
  const taken: Actie[] = [];
  for (const actie of staat.acties) {
    if (actie.ingetrokken) continue;
    const sleutel = `${actie.omschrijving.trim().toLowerCase()}|${actie.soort}`;
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);
    taken.push({ ...actie, bron: [...actie.bron] });
  }
  return taken;
}

/**
 * Kleine ASR-woordenlijst voor medische termen. Bewust klein en expliciet:
 * de behandelaarscorrectie mag nooit door een machinale worden overschreven
 * (S9), dus deze laag corrigeert alleen wat aantoonbaar fout gespeld is.
 */
export const ASR_CORRECTIES: readonly { fout: RegExp; goed: string }[] = [
  { fout: /\bsertaline\b/gi, goed: "sertraline" },
  { fout: /\bsertralien\b/gi, goed: "sertraline" },
  { fout: /\btramadal\b/gi, goed: "tramadol" },
  { fout: /\btramadolol\b/gi, goed: "tramadol" },
  { fout: /\bamoxiciline\b/gi, goed: "amoxicilline" },
  { fout: /\bamoxilline\b/gi, goed: "amoxicilline" },
  { fout: /\bparacetamal\b/gi, goed: "paracetamol" },
  { fout: /\bdiazepan\b/gi, goed: "diazepam" },
  { fout: /\boxazepan\b/gi, goed: "oxazepam" },
  { fout: /\bcitalopran\b/gi, goed: "citalopram" },
  { fout: /\bkwetiapine\b/gi, goed: "quetiapine" },
  { fout: /\bmilligramm\b/gi, goed: "milligram" },
  { fout: /\bpsychoeducatie\b/gi, goed: "psycho-educatie" },
  { fout: /\bburnout\b/gi, goed: "burn-out" },
  { fout: /\bsuicidaal\b/gi, goed: "suïcidaal" },
  { fout: /\bt\.?s\.?h\.? bepaling\b/gi, goed: "TSH-bepaling" },
];

/** `null` wanneer er niets te corrigeren viel — dan blijft de brontekst staan. */
export function corrigeerTranscriptDeterministisch(tekst: string): string | null {
  let resultaat = tekst;
  for (const correctie of ASR_CORRECTIES) {
    resultaat = resultaat.replace(correctie.fout, correctie.goed);
  }
  return resultaat === tekst ? null : resultaat;
}
