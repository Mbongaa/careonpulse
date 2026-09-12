import type { ScribeHandeling } from "@/lib/careon-scribe/api-contract";
import {
  bouwVerslagDeterministisch,
  extraheerDeterministisch,
  extraheerTaken,
} from "@/lib/careon-scribe/deterministisch";
import { formaatVoor, VERSLAG_FORMATEN } from "@/lib/careon-scribe/formaten";
import type { KlinischeStaat } from "@/lib/careon-scribe/types";
import {
  type AnalyseBron,
  CONSULT_TYPES,
  type ConsultType,
  type GeannuleerdGrond,
  normaliseerScribeInstellingen,
  type ScribeInstellingen,
  type ScribeNotitie,
  type ScribeSegment,
  type ScribeSessie,
  type ScribeTaak,
  type SectieStatus,
  type SegmentBron,
  type SessieStatus,
  type Spreker,
  type TaakSoort,
  type TaakStatus,
} from "@/lib/careon-scribe/types";

// Careon AI — labels, standaardteksten en demo-seeds (handoff 20).
//
// Deze module is GEEN onderdeel van de oorspronkelijke audit: het is een
// client-goedgekeurde toevoeging. De seeds hieronder zijn uitsluitend
// demonstratiedata (B12): in productie start de module leeg en uitgeschakeld,
// en een org_admin activeert haar pas na het vaststellen van de
// toestemmingstekst en het machtigen van behandelaren.
//
// Het demo-consult is GEFINGEERD. Er staat geen echte cliëntinformatie in;
// de dossierreferenties zijn verzonnen en bevatten geen BSN of geboortedatum.

export const SCRIBE_PAGE_META = {
  overzicht: { title: "Consulten", sub: "Live gespreksondersteuning — het EPD blijft het dossier." },
  werkruimte: { title: "Consult", sub: "Transcript, notities en klinische aanwijzingen tijdens het gesprek." },
  review: { title: "Verslag", sub: "Controleer en keur elke sectie goed; daarna neemt u het over in het EPD." },
  instellingen: {
    title: "Careon AI-instellingen",
    sub: "Toestemmingstekst, gemachtigde behandelaren, retentie en providerstatus.",
  },
} as const;

export const SESSIE_STATUS_LABELS: Record<SessieStatus, string> = {
  actief: "Actief",
  afgerond: "Te beoordelen",
  goedgekeurd: "Goedgekeurd",
  overgenomen: "Overgenomen in EPD",
  geannuleerd: "Geannuleerd",
};

export const SPREKER_LABELS: Record<Spreker, string> = {
  arts: "Arts",
  patient: "Patiënt",
  overig: "Overig",
  onbekend: "Onbekend",
};

export const CONSULT_TYPE_LABELS: Record<ConsultType, string> = CONSULT_TYPES.reduce(
  (verzameling, type) => {
    verzameling[type] = VERSLAG_FORMATEN[type].label;
    return verzameling;
  },
  {} as Record<ConsultType, string>,
);

export const TAAK_SOORT_LABELS: Record<TaakSoort, string> = {
  lab: "Laboratorium",
  beeldvorming: "Beeldvorming",
  medicatie: "Medicatie",
  verwijzing: "Verwijzing",
  vervolgafspraak: "Vervolgafspraak",
  communicatie: "Communicatie",
  overig: "Overig",
};

export const TAAK_STATUS_LABELS: Record<TaakStatus, string> = {
  voorgesteld: "Voorgesteld",
  goedgekeurd: "Goedgekeurd",
  afgewezen: "Afgewezen",
  afgerond: "Afgerond",
};

export const SEGMENT_BRON_LABELS: Record<SegmentBron, string> = {
  live: "Opname",
  handmatig: "Handmatig ingevoerd",
  demo: "Demo",
  systeem: "Ontbrekend fragment",
};

export const ANALYSE_BRON_LABELS: Record<AnalyseBron, string> = {
  ai: "AI-analyse",
  deterministisch: "Deterministische analyse",
  demo: "Demo",
};

export const SECTIE_STATUS_LABELS: Record<SectieStatus, string> = {
  leeg: "Leeg",
  concept: "Concept",
  bewerkt: "Bewerkt",
  goedgekeurd: "Goedgekeurd",
};

/** Grond bij annuleren, verwijderen of een ingetrokken vrijgave (N11). */
export const GEANNULEERD_GROND_LABELS: Record<GeannuleerdGrond, string> = {
  toestemming_ingetrokken: "Toestemming ingetrokken",
  verkeerd_dossier: "Verkeerd dossier",
  technisch_onbruikbaar: "Technisch onbruikbaar",
  overig: "Overig",
};

/** Kolomlabels van het scribe-logboek (N20). */
export const SCRIBE_HANDELING_LABELS: Record<ScribeHandeling, string> = {
  "scribe.sessie.start": "Consult gestart",
  "scribe.sessie.afgerond": "Consult afgerond",
  "scribe.sessie.goedgekeurd": "Verslag vastgesteld",
  "scribe.sessie.overgenomen": "Overgenomen in het EPD",
  "scribe.sessie.geannuleerd": "Consult geannuleerd",
  "scribe.staat.gewijzigd": "Consultstaat gecorrigeerd",
  "scribe.transcript.read": "Consult geopend",
  "scribe.notitie.goedgekeurd": "Verslag goedgekeurd",
  "scribe.export": "Verslag geëxporteerd",
  "scribe.sessie.vrijgegeven": "Verslag vrijgegeven",
  "scribe.sessie.vrijgave.ingetrokken": "Vrijgave ingetrokken",
  "scribe.sessie.verwijderd": "Consult verwijderd",
  "scribe.instellingen.gewijzigd": "Instellingen gewijzigd",
  "scribe.gemachtigden.gewijzigd": "Machtigingen gewijzigd",
};

/**
 * Standaard toestemmingstekst (§4.6, V5 — ter bevestiging door de raadsman
 * van de klant). De sessie bevriest de letterlijke tekst plus het
 * instellingenrevisienummer dat de patiënt te horen kreeg (S13); een latere
 * wijziging raakt daarom alleen nieuwe consulten.
 *
 * De tekst draagt vier elementen die art. 13 AVG / WGBO 7:448 hier vragen en
 * die `isConsenttekst()` afdwingt (N10): hoe lang de transcripttekst blijft,
 * dat het verslag na overname zichtbaar blijft, dat weigeren en intrekken op
 * elk moment mag zonder gevolgen voor de zorg, en dat het EPD het dossier
 * blijft. `{transcriptRetentieDagen}` is een plaatshouder: de bewaarde tekst
 * houdt hem, `vulConsenttekstIn()` vult hem bij het voorlezen in met de
 * ingestelde termijn, zodat de voorgelezen tekst nooit uit de pas loopt met de
 * retentie-instelling.
 */
export const STANDAARD_CONSENTTEKST =
  "De cliënt is geïnformeerd dat dit gesprek tijdens het consult wordt getranscribeerd en met AI-ondersteuning " +
  "wordt samengevat; dat de opname direct na verwerking wordt verwijderd en door Careon niet wordt bewaard; dat " +
  "een transcriptiedienst het fragment kortstondig verwerkt onder een verwerkersovereenkomst; dat de uitgeschreven " +
  "transcripttekst {transcriptRetentieDagen} dagen bewaard blijft en daarna automatisch wordt verwijderd; dat het " +
  "verslag na overname in het EPD nog tot de ingestelde termijn zichtbaar blijft in Careon AI; dat het EPD het " +
  "dossier blijft en dit een werkkopie is; dat de cliënt op elk moment mag weigeren of de toestemming mag " +
  "intrekken, zonder gevolgen voor de zorg; dat de behandelaar het verslag controleert en vaststelt; en heeft " +
  "hiermee ingestemd.";

/**
 * Productie: de module staat UIT tot een beheerder haar expliciet aanzet, en de
 * activatievoorwaarden (N21) staan leeg — `activatieVoorwaardenOntbrekend()`
 * noemt ze alle vier, dus `ingeschakeld: true` is nog niet toegestaan. Externe
 * verwerking staat eveneens uit: zonder expliciete keuze verlaat er geen
 * fragment en geen transcript het platform (N19).
 */
export const EMPTY_SCRIBE_INSTELLINGEN: ScribeInstellingen = {
  ingeschakeld: false,
  standaardFormaat: "soap",
  consenttekst: STANDAARD_CONSENTTEKST,
  transcriptRetentieDagen: 30,
  notitieRetentieDagen: 30,
  transcriptWissenBijOvername: true,
  klinischeAanwijzingenAan: true,
  medicatiecheckAan: true,
  aiAnalyseAan: false,
  transcriptieAan: false,
  dpiaVastgesteldOp: null,
  dpiaEigenaar: null,
  verwerkersovereenkomstBevestigd: false,
  consenttekstGoedgekeurdOp: null,
};

/**
 * Demo/sales: aan, met het GGZ-formaat als standaard. De activatievoorwaarden
 * zijn ingevuld — anders zou de demo-organisatie een stand tonen die de
 * PUT-route zelf zou weigeren. De twee schakelaars voor externe verwerking
 * blijven UIT: het demo-pad is volledig deterministisch en roept geen provider
 * aan.
 */
export const DEMO_SCRIBE_INSTELLINGEN: ScribeInstellingen = {
  ...EMPTY_SCRIBE_INSTELLINGEN,
  ingeschakeld: true,
  standaardFormaat: "psychiatrie",
  dpiaVastgesteldOp: "2026-08-15",
  dpiaEigenaar: "Functionaris gegevensbescherming",
  verwerkersovereenkomstBevestigd: true,
  consenttekstGoedgekeurdOp: "2026-08-15",
};

/** Snapshot-migratie bij lezen, met de productie-standaard als basis. */
export function migreerScribeInstellingen(value: unknown): ScribeInstellingen {
  return normaliseerScribeInstellingen(value, EMPTY_SCRIBE_INSTELLINGEN);
}

/** Tempo van "Demo-opname" en "Volledig afspelen" (§7.3). */
export const DEMO_SEGMENT_INTERVAL_MS = 1_500;

/** Simulatieduur van één gesproken fragment in het demo-transcript. */
const DEMO_FRAGMENT_MS = 8_000;

export interface DemoScriptRegel {
  spreker: Spreker;
  tekst: string;
}

/**
 * Gescript GGZ-intakeconsult (§7.7). Alle getallen staan bewust als WOORD
 * geschreven — zo levert de demo dezelfde uitdaging als echte spraak en
 * bewijst zij dat het getallenlexicon (nl-getallen.ts) werkt. Het enige
 * cijfer is het jaartal in de voorgeschiedenis.
 *
 * Verwachte deterministische uitkomst (vastgelegd in verify:careon):
 * hoofdklacht somberheid, duur "drie maanden", sertraline 50 mg huidig plus
 * 100 mg voorgesteld, tramadol, allergie amoxicilline (penicillinegroep),
 * suïcidaliteit *besproken* zonder polariteit, twee uitgesproken
 * overwegingen, één regelwaarschuwing (sertraline × tramadol) en de taken
 * TSH, overleg huisarts en vervolgafspraak.
 */
export const DEMO_CONSULT_SCRIPT: readonly DemoScriptRegel[] = [
  { spreker: "arts", tekst: "Goedemiddag, fijn dat u er bent. Waarvoor komt u vandaag bij mij?" },
  { spreker: "patient", tekst: "Ik voel me al een tijd erg somber en ik krijg bijna niets meer gedaan." },
  { spreker: "arts", tekst: "Hoe lang speelt die somberheid al?" },
  { spreker: "patient", tekst: "Sinds drie maanden ongeveer, en het wordt geleidelijk erger." },
  { spreker: "patient", tekst: "Ik slaap heel slecht, ik lig uren wakker en ik pieker de hele nacht door." },
  { spreker: "arts", tekst: "En hoe is uw eetlust?" },
  { spreker: "patient", tekst: "Mijn eetlust is verminderd, ik ben ongeveer vier kilo afgevallen." },
  { spreker: "arts", tekst: "Zijn er dingen die het erger maken?" },
  { spreker: "patient", tekst: "Werkstress vooral; er is een reorganisatie op mijn werk en de druk is hoog." },
  { spreker: "patient", tekst: "Als ik ga wandelen met mijn hond voelt het even wat lichter." },
  { spreker: "arts", tekst: "Gebruikt u alcohol of andere middelen?" },
  {
    spreker: "patient",
    tekst: "In het weekend drink ik vier glazen wijn op een avond, doordeweeks niet. Roken doe ik niet.",
  },
  {
    spreker: "arts",
    tekst: "Ik wil u iets vragen wat ik iedereen vraag: denkt u er weleens aan om een einde aan uw leven te maken?",
  },
  { spreker: "patient", tekst: "Nee, daar denk ik niet aan. Ik wil gewoon dat het beter gaat." },
  { spreker: "arts", tekst: "Welke medicijnen gebruikt u op dit moment?" },
  { spreker: "patient", tekst: "Ik gebruik sertraline vijftig milligram, sinds zes weken." },
  { spreker: "patient", tekst: "En sinds vorige week gebruik ik tramadol voor mijn rugpijn." },
  { spreker: "arts", tekst: "Bent u ergens allergisch voor?" },
  { spreker: "patient", tekst: "Ik ben allergisch voor amoxicilline, daar krijg ik uitslag van." },
  { spreker: "arts", tekst: "Bent u eerder behandeld voor psychische klachten, en komt er in uw familie iets voor?" },
  { spreker: "patient", tekst: "In 2022 heb ik een burn-out gehad, toen ben ik drie maanden thuis geweest." },
  { spreker: "patient", tekst: "Mijn moeder heeft een depressie gehad toen ik jong was." },
  {
    spreker: "arts",
    tekst: "Dit zou kunnen passen bij een depressieve episode, maar ik wil een schildklierafwijking uitsluiten.",
  },
  { spreker: "arts", tekst: "De rugpijn en de tramadol beïnvloeden mogelijk ook het slapen." },
  { spreker: "arts", tekst: "Ik wil de sertraline ophogen naar honderd milligram." },
  {
    spreker: "arts",
    tekst: "Ik vraag via de huisarts een TSH-bepaling aan om de schildklier te laten controleren.",
  },
  { spreker: "arts", tekst: "Ik overleg met de huisarts over de tramadol." },
  { spreker: "arts", tekst: "We doen psycho-educatie en ik geef u adviezen over slaaphygiëne." },
  { spreker: "arts", tekst: "We maken een vervolgafspraak over twee weken." },
  { spreker: "patient", tekst: "Dat is goed, dank u wel." },
];

// ── Demo-sessies ────────────────────────────────────────────────────────────

const DEMO_CONSULT_2_ID = "demo-consult-2";
const DEMO_CONSULT_2_START = "2026-09-04T10:00:00.000Z";
const DEMO_CONSULT_2_TYPE: ConsultType = "psychiatrie";

function tijdstip(basis: string, verschuivingMs: number): string {
  return new Date(Date.parse(basis) + verschuivingMs).toISOString();
}

const DEMO_CONSULT_2_DUUR_MS = DEMO_CONSULT_SCRIPT.length * DEMO_FRAGMENT_MS;

/**
 * Demo-transcript van consult 2: het script als segmenten, met een vaste
 * tijdlijn (8 seconden per regel) zodat de weergave deterministisch is.
 */
export function demoConsult2Segmenten(): ScribeSegment[] {
  return DEMO_CONSULT_SCRIPT.map((regel, index) => ({
    id: `${DEMO_CONSULT_2_ID}-seg-${index + 1}`,
    volgnummer: index + 1,
    spreker: regel.spreker,
    tekst: regel.tekst,
    tekstGecorrigeerd: null,
    correctieBron: null,
    beginMs: index * DEMO_FRAGMENT_MS,
    eindMs: index * DEMO_FRAGMENT_MS + (DEMO_FRAGMENT_MS - 400),
    bron: "demo" as SegmentBron,
    createdAt: tijdstip(DEMO_CONSULT_2_START, index * DEMO_FRAGMENT_MS),
  }));
}

export interface DemoConsult2 {
  segmenten: ScribeSegment[];
  staat: KlinischeStaat;
  notitie: ScribeNotitie;
  taken: ScribeTaak[];
}

/**
 * Seeds en motor mogen niet uit elkaar lopen: staat, verslag en taken van het
 * demo-consult worden hier ter plekke uit DEMO_CONSULT_SCRIPT berekend met
 * exact dezelfde deterministische functies die de module in productie
 * gebruikt. Een wijziging in de extractie verandert dus automatisch de demo —
 * en verify:careon toetst beide tegen elkaar.
 */
export function buildDemoConsult2(): DemoConsult2 {
  const segmenten = demoConsult2Segmenten();
  const staat = extraheerDeterministisch(segmenten, DEMO_CONSULT_2_TYPE);
  const secties = bouwVerslagDeterministisch(staat, segmenten, DEMO_CONSULT_2_TYPE);
  const afgerondOp = tijdstip(DEMO_CONSULT_2_START, DEMO_CONSULT_2_DUUR_MS);
  const notitie: ScribeNotitie = {
    id: `${DEMO_CONSULT_2_ID}-notitie-1`,
    sessieId: DEMO_CONSULT_2_ID,
    versie: 1,
    bewerkRevisie: 1,
    formaat: DEMO_CONSULT_2_TYPE,
    secties,
    status: "concept",
    model: null,
    bron: "demo",
    goedgekeurdOp: null,
    createdAt: afgerondOp,
    updatedAt: afgerondOp,
  };
  const taken: ScribeTaak[] = extraheerTaken(staat).map((actie, index) => ({
    id: `${DEMO_CONSULT_2_ID}-taak-${index + 1}`,
    sessieId: DEMO_CONSULT_2_ID,
    omschrijving: actie.omschrijving,
    soort: actie.soort,
    status: "voorgesteld" as TaakStatus,
    bronSegmenten: [...actie.bron],
    createdAt: afgerondOp,
    updatedAt: afgerondOp,
  }));
  return { segmenten, staat, notitie, taken };
}

const DEMO_CONSULT_3_ID = "demo-consult-3";
const DEMO_CONSULT_3_TYPE: ConsultType = "vervolg";
const DEMO_CONSULT_3_TEKSTEN: Record<string, string> = {
  "beloop-sinds-vorig-contact":
    "Stemming iets verbeterd sinds de vorige afspraak; slaapt gemiddeld vijf uur per nacht.",
  "huidige-klachten": "Nog steeds piekeren aan het begin van de avond; overdag meer energie.",
  bevindingen: "Gewicht stabiel. Geen bijwerkingen van de medicatie gemeld.",
  beoordeling: "Beoordeling door behandelaar, vastgesteld tijdens het consult.",
  beleid: "Medicatie ongewijzigd voortzetten; vervolgafspraak over vier weken.",
};

/**
 * Verslag van het overgenomen demo-consult: alle secties goedgekeurd, ook de
 * ★-sectie — die is (zoals de module eist) door de behandelaar zelf
 * geschreven, niet machinaal gevuld.
 */
export function demoConsult3Notitie(): ScribeNotitie {
  const formaat = formaatVoor(DEMO_CONSULT_3_TYPE);
  const goedgekeurdOp = "2026-08-28T15:40:00.000Z";
  return {
    id: `${DEMO_CONSULT_3_ID}-notitie-1`,
    sessieId: DEMO_CONSULT_3_ID,
    versie: 1,
    bewerkRevisie: 1,
    formaat: DEMO_CONSULT_3_TYPE,
    secties: formaat.secties.map((definitie) => {
      const tekst = DEMO_CONSULT_3_TEKSTEN[definitie.id] ?? "Niet besproken tijdens dit consult.";
      return {
        id: definitie.id,
        titel: definitie.titel,
        conceptTekst: definitie.vereistBehandelaar === true ? "" : tekst,
        tekst,
        status: "goedgekeurd" as SectieStatus,
        bron: [],
        vereistBehandelaar: definitie.vereistBehandelaar === true,
      };
    }),
    status: "goedgekeurd",
    model: null,
    bron: "demo",
    goedgekeurdOp,
    createdAt: "2026-08-28T15:05:00.000Z",
    updatedAt: goedgekeurdOp,
  };
}

/**
 * Drie demo-consulten (§7.7): een actief consult om de werkruimte te tonen,
 * een afgerond consult met volledig transcript en conceptverslag, en een al
 * in het EPD overgenomen consult waarvan het transcript is gewist.
 *
 * De bevroren `consentTekst` is hier bewust de sjabloontekst mét
 * `{transcriptRetentieDagen}`: de seeds zijn demonstratiedata en moeten
 * letterlijk aan STANDAARD_CONSENTTEKST gelijk blijven. In een echt consult
 * bevriest de route de ingevulde tekst (`vulConsenttekstIn`).
 */
export const DEMO_SCRIBE_SESSIES: readonly ScribeSessie[] = [
  {
    id: "demo-consult-1",
    status: "actief",
    patientReferentie: "D-2026-0417",
    consultType: "psychiatrie",
    taal: "nl",
    consentBevestigdOp: "2026-09-07T09:14:00.000Z",
    consentRevisie: 1,
    consentTekst: STANDAARD_CONSENTTEKST,
    gestartOp: "2026-09-07T09:14:00.000Z",
    beeindigdOp: null,
    goedgekeurdOp: null,
    overgenomenOp: null,
    duurMs: 0,
    segmentTeller: 0,
    ontbrekendeFragmenten: 0,
    transcriptieProvider: "demo",
    transcriptieModel: null,
    notitieModel: null,
    transcriptVerwijderNa: "2026-10-07T09:14:00.000Z",
    sessieVerwijderNa: "2026-10-07T09:14:00.000Z",
    createdAt: "2026-09-07T09:14:00.000Z",
    updatedAt: "2026-09-07T09:14:00.000Z",
    eigen: true,
    vrijgegeven: false,
  },
  {
    id: DEMO_CONSULT_2_ID,
    status: "afgerond",
    patientReferentie: "D-2026-0392",
    consultType: DEMO_CONSULT_2_TYPE,
    taal: "nl",
    consentBevestigdOp: "2026-09-04T09:58:00.000Z",
    consentRevisie: 1,
    consentTekst: STANDAARD_CONSENTTEKST,
    gestartOp: DEMO_CONSULT_2_START,
    beeindigdOp: tijdstip(DEMO_CONSULT_2_START, DEMO_CONSULT_2_DUUR_MS),
    goedgekeurdOp: null,
    overgenomenOp: null,
    duurMs: DEMO_CONSULT_2_DUUR_MS,
    segmentTeller: DEMO_CONSULT_SCRIPT.length,
    ontbrekendeFragmenten: 0,
    transcriptieProvider: "demo",
    transcriptieModel: null,
    notitieModel: null,
    transcriptVerwijderNa: "2026-10-04T10:00:00.000Z",
    sessieVerwijderNa: "2026-10-04T10:00:00.000Z",
    createdAt: "2026-09-04T09:58:00.000Z",
    updatedAt: tijdstip(DEMO_CONSULT_2_START, DEMO_CONSULT_2_DUUR_MS),
    eigen: true,
    vrijgegeven: false,
  },
  {
    id: DEMO_CONSULT_3_ID,
    status: "overgenomen",
    patientReferentie: "D-2026-0355",
    consultType: DEMO_CONSULT_3_TYPE,
    taal: "nl",
    consentBevestigdOp: "2026-08-28T14:58:00.000Z",
    consentRevisie: 1,
    consentTekst: STANDAARD_CONSENTTEKST,
    gestartOp: "2026-08-28T15:00:00.000Z",
    beeindigdOp: "2026-08-28T15:22:00.000Z",
    goedgekeurdOp: "2026-08-28T15:40:00.000Z",
    overgenomenOp: "2026-08-28T15:44:00.000Z",
    duurMs: 22 * 60 * 1_000,
    segmentTeller: 0,
    ontbrekendeFragmenten: 0,
    transcriptieProvider: "demo",
    transcriptieModel: null,
    notitieModel: null,
    // Transcript is bij de overname direct gewist (S15); het verslag blijft
    // dertig dagen zichtbaar.
    transcriptVerwijderNa: "2026-08-28T15:44:00.000Z",
    sessieVerwijderNa: "2026-09-27T15:44:00.000Z",
    createdAt: "2026-08-28T14:58:00.000Z",
    updatedAt: "2026-08-28T15:44:00.000Z",
    eigen: true,
    vrijgegeven: false,
  },
];
