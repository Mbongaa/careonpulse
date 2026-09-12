/**
 * Narrow English evidence allowlist. It validates literal statements, not diagnoses.
 * The caller must establish participant roles independently: a provider's neutral
 * speaker label is not a verified patient/clinician identity. Ambiguous material
 * stays in gesprekscontext; this helper never rewrites or shortens a source quote.
 */
import { BEKENDE_MIDDELEN, normaliseerMiddel } from "./medicatie-veiligheid";
import { type KlinischeStaat, SCRIBE_LIMITS, type ScribeSegment } from "./types";

// A noun after "take" is not automatically a medicine (bus/walk).
// Unsupported names stay source context until vocabulary is deliberately extended.
const MEDICINE_NAMES = new Set([...BEKENDE_MIDDELEN.map(normaliseerMiddel), "sodium valproate"]);

const FAMILY = /\b(?:mother|father|brother|sister|daughter|son|partner|wife|husband|grandmother|grandfather)\b/i;
const UNCERTAIN =
  /\b(?:if|would|could|may|might|maybe|perhaps|possibly|possible|probably|consider\w*|suggest\w*|option\w*|unsure|uncertain|suspect\w*|seems?|apparently|think|believe|suppose|guess)\b|\bnot sure\b/i;
const DENIAL =
  /\b(?:not|no|never|neither|without|den(?:y|ies|ied)|declin\w*|refus\w*)\b|\b(?:don|doesn|didn|isn|aren|wasn|weren|haven|hasn|hadn|won|wouldn|couldn|shouldn|can)['’]t\b|\bruled out\b/i;
const STOPPED = /\b(?:stopp?ed|discontinued|ceased|no longer)\b/i;
const PAST =
  /\b(?:yesterday|previously|formerly|earlier|ago|used to|last (?:night|week|month|year)|in the past|as a child|in (?:19|20)\d{2})\b|\bI (?:felt|had|was|used|took)\b/i;
const RISK =
  /\b(?:suicid\w*|self[- ]harm\w*|overdos\w*|homicid\w*|weapon\w*|knife|gun|psychos\w*|psychotic|hallucinat\w*|delusion\w*|voices|paranoi\w*)\b|\b(?:kill|hurt|harm) (?:myself|yourself|himself|herself|anyone|others|someone)\b|\b(?:want|wish) to die\b/i;
const SYMPTOM =
  /\b(?:pain|aches?|headaches?|dizzy|dizziness|nausea|nauseous|vomit\w*|cough\w*|fever|tired|fatigue|breathless|short of breath|palpitation\w*|insomnia|diarrh\w*|constipat\w*|rash|poor appetite|anxious|sad)\b/i;

function literal(tekst: string): string {
  return tekst.normalize("NFC").toLowerCase().trim().replace(/[.!]$/, "").replace(/\s+/g, " ");
}

function escaped(tekst: string): string {
  return tekst.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isEngelseVraag(tekst: string): boolean {
  return (
    /\?/.test(tekst) ||
    /^(?:(?:do|does|did|am|are|is|was|were|have|has|had|can|could|would|will|shall|should|may|might|must)\s+(?:you|he|she|they|we|I|the patient)\b|(?:what|why|when|where|who|whose|which|how)\b)/i.test(
      tekst.trim(),
    )
  );
}

/** Any mixed past/current account remains source context until it is split and reviewed. */
export function isEngelsHistorisch(tekst: string): boolean {
  return PAST.test(tekst);
}

function subject(tekst: string, segment: ScribeSegment): boolean {
  return segment.spreker === "patient" ? /^I\b/i.test(tekst) : /^The patient\b/i.test(tekst);
}

function medication(row: Record<string, unknown>, tekst: string, segment: ScribeSegment): boolean {
  if (typeof row.naam !== "string" || row.naam.trim().length === 0 || row.naam.length > 120) return false;
  if (!MEDICINE_NAMES.has(normaliseerMiddel(row.naam))) return false;
  if (row.dosering !== null && typeof row.dosering !== "string") return false;
  if (UNCERTAIN.test(tekst)) return false;
  const firstPerson = segment.spreker === "patient";
  const current = firstPerson
    ? /^I\s+(?:currently\s+)?(?:take|use|am (?:currently )?(?:taking|using))\s+(.+)$/i
    : /^The patient\s+(?:currently\s+)?(?:takes|uses|is (?:currently )?(?:taking|using))\s+(.+)$/i;
  const stopped = firstPerson
    ? /^I\s+(?:(?:have\s+)?(?:stopped|discontinued|ceased)(?:\s+(?:taking|using))?|no longer\s+(?:take|use))\s+(.+)$/i
    : /^The patient\s+(?:(?:has\s+)?(?:stopped|discontinued|ceased)(?:\s+(?:taking|using))?|no longer\s+(?:takes|uses))\s+(.+)$/i;
  const status = row.gebruik;
  if (status !== "huidig" && status !== "gestopt") return false;
  if (status === "huidig" && (DENIAL.test(tekst) || STOPPED.test(tekst) || isEngelsHistorisch(tekst))) return false;
  const body = (status === "huidig" ? current : stopped).exec(tekst)?.[1];
  if (!body || (status === "gestopt" && /\b(?:not|never)\b|\b(?:haven|hasn|didn)['’]t\b/i.test(tekst))) return false;
  // An explicit list delimiter ends the dose's association with this name.
  const clauses = body.split(/\s+and\s+|;\s*|,\s*(?=[A-Za-z])/i);
  const name = literal(row.naam);
  const mentions = clauses
    .map((clause) => new RegExp(`^${escaped(name)}(?:\\s+|$)(.*)`, "i").exec(literal(clause)))
    .filter((match) => match !== null);
  if (mentions.length !== 1) return false;
  if (row.dosering === null) return true;
  const adjacentDose = /^(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|µg|g|ml|units?|iu)\b/i.exec(mentions[0][1]);
  if (!adjacentDose) return false;
  const normalizeDose = (value: string): string =>
    value.toLowerCase().replace(/,/g, ".").replace(/\s+/g, "").replace(/µg/g, "ug");
  return normalizeDose(row.dosering) === normalizeDose(`${adjacentDose[1]} ${adjacentDose[2]}`);
}

function allergy(row: Record<string, unknown>, tekst: string, segment: ScribeSegment): boolean {
  if (DENIAL.test(tekst) || UNCERTAIN.test(tekst) || isEngelsHistorisch(tekst) || STOPPED.test(tekst)) return false;
  const prefix = segment.spreker === "patient" ? "I (?:am|have an?)" : "The patient (?:is|has an?)";
  if (row.aard === "allergie") return new RegExp(`^${prefix} (?:allergic to|allergy to)\\s+\\S`, "i").test(tekst);
  if (row.aard === "intolerantie")
    return new RegExp(`^${prefix} (?:intolerant to|intolerance to)\\s+\\S`, "i").test(tekst);
  return false;
}

function lifestyle(row: Record<string, unknown>, tekst: string): boolean {
  if (UNCERTAIN.test(tekst) || isEngelsHistorisch(tekst)) return false;
  const substanceVerb = /\b(?:smoke|smokes|smoking|use|uses|using|take|takes|taking|drink|drinks|drinking)\b/i;
  if (!substanceVerb.test(tekst)) return false;
  if (row.categorie === "roken") return /\b(?:cigarettes?|tobacco|cigars?)\b/i.test(tekst);
  if (row.categorie === "alcohol") return /\b(?:alcohol|beer|wine|spirits|vodka|whisky|whiskey)\b/i.test(tekst);
  if (row.categorie === "drugs") return /\b(?:cannabis|marijuana|cocaine|heroin|mdma|ecstasy)\b/i.test(tekst);
  return false;
}

/**
 * One complete source statement and one reviewed role per fact. Source-number
 * existence is still checked by the caller, and checked again here for standalone use.
 * Unsupported categories deliberately fail closed instead of guessing their meaning.
 */
export function valideerEngelsBewijs(veld: keyof KlinischeStaat, rij: unknown, bronnen: ScribeSegment[]): boolean {
  if (!rij || typeof rij !== "object" || Array.isArray(rij) || bronnen.length !== 1) return false;
  const row = rij as Record<string, unknown>;
  const segment = bronnen[0];
  if (segment.bron === "systeem" || !["patient", "arts"].includes(segment.spreker)) return false;
  if (!Array.isArray(row.bron) || row.bron.length !== 1 || row.bron[0] !== segment.volgnummer) return false;
  if (
    !Number.isSafeInteger(segment.volgnummer) ||
    segment.volgnummer < 1 ||
    segment.volgnummer > SCRIBE_LIMITS.segmentenPerSessie
  )
    return false;
  if (typeof row.tekst !== "string" || row.tekst.trim().length === 0 || row.tekst.length > SCRIBE_LIMITS.feitTekst)
    return false;
  const effectieveBron = segment.tekstGecorrigeerd ?? segment.tekst;
  const bronLimiet = veld === "acties" ? SCRIBE_LIMITS.taakOmschrijving : SCRIBE_LIMITS.feitTekst;
  if (effectieveBron.length > bronLimiet) return false;
  const tekst = effectieveBron.trim();
  if (literal(row.tekst) !== literal(tekst) || isEngelseVraag(tekst) || FAMILY.test(tekst) || RISK.test(tekst))
    return false;
  // A second sentence or contrast can reverse the first statement's meaning.
  if (/(?<!\d)\.\s+\S|\b(?:but|however|although|except)\b/i.test(tekst)) return false;
  if (typeof row.ingetrokken !== "boolean" || (row.ingetrokken && !(veld === "medicatie" && row.gebruik === "gestopt")))
    return false;
  if (veld === "medicatie") return medication(row, tekst, segment);
  if (veld === "allergieen") return allergy(row, tekst, segment);
  if (veld === "symptomen" || veld === "begeleidendeSymptomen")
    return subject(tekst, segment) && SYMPTOM.test(tekst) && !UNCERTAIN.test(tekst) && !isEngelsHistorisch(tekst);
  if (veld === "leefstijl") return subject(tekst, segment) && lifestyle(row, tekst);
  if (veld === "plan" || veld === "acties") {
    if (segment.spreker !== "arts" || UNCERTAIN.test(tekst) || DENIAL.test(tekst) || isEngelsHistorisch(tekst))
      return false;
    const commitment =
      /^(?:I will|We will|I am going to|We have agreed to)\s+(?:arrange|refer|contact|review|request|order|schedule|prescribe|start|stop|increase|decrease|discuss|send)\b/i.test(
        tekst,
      );
    if (!commitment) return false;
    return (
      veld === "plan" ||
      (row.soort === "overig" &&
        typeof row.omschrijving === "string" &&
        row.omschrijving.length <= SCRIBE_LIMITS.taakOmschrijving &&
        literal(row.omschrijving) === literal(tekst))
    );
  }
  return false;
}
