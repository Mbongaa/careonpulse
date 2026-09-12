// Careon Scribe — verslagformaten per discipline (handoff 20 §4.2).
//
// Twee harde regels uit S10 leven in deze tabel:
//   * Geen enkele sectietitel bevat het woord "diagnose" — de module stelt
//     geen diagnose (verify:careon toetst dit).
//   * Secties met `vereistBehandelaar` (★) worden NOOIT machinaal geschreven.
//     Generatoren vullen hoogstens de door de behandelaar zelf uitgesproken
//     overwegingen (met bron) in `conceptTekst`; `tekst` blijft leeg tot de
//     behandelaar hem zelf schrijft. Ze vallen buiten "Alles goedkeuren" en
//     moeten individueel bewerkt én goedgekeurd zijn vóór goedkeuring.

import { CONSULT_TYPES, type ConsultType } from "./types";

export const BEOORDELING_HINT =
  "Beoordeling door behandelaar — wordt niet machinaal geschreven; hieronder alleen wat u zelf uitsprak (met bron)";

/**
 * Structuurhulp voor de risicotaxatie-textarea (N3): een lege ruit met de
 * kopjes die een risicotaxatie hoort te dragen. Bewust een PLACEHOLDER en geen
 * voorgevulde tekst — de sectie blijft leeg tot de behandelaar hem schrijft.
 */
export const RISICO_STRUCTUUR_PLACEHOLDER = "Suïcidaliteit —\nBeschermende factoren —\nAfspraken bij toename —";

export interface VerslagSectieDefinitie {
  id: string;
  titel: string;
  hint: string;
  /** ★ — beoordelingssectie: uitsluitend door de behandelaar te schrijven. */
  vereistBehandelaar?: true;
  /**
   * Aard van een ★-sectie (C48/N3). Een risicosectie citeert uitsluitend de
   * risicofeiten uit de staat; elke andere ★-sectie de uitgesproken
   * overwegingen. Staat BEWUST alleen op de definitie: `VerslagSectie` wordt
   * opgeslagen in `careon_scribe_notities.secties` en op vorm gecontroleerd
   * door `app.careon_scribe_secties_geldig`.
   */
  soort?: "risico";
}

export interface VerslagFormaat {
  label: string;
  doelgroep: string;
  secties: VerslagSectieDefinitie[];
}

/** Kortere schrijfwijze voor een ★-sectie: altijd dezelfde hint. */
function beoordeling(id: string, titel: string, soort?: "risico"): VerslagSectieDefinitie {
  return { id, titel, hint: BEOORDELING_HINT, vereistBehandelaar: true, soort };
}

export const VERSLAG_FORMATEN: Record<ConsultType, VerslagFormaat> = {
  soap: {
    label: "SOAP",
    doelgroep: "algemeen/ziekenhuis",
    secties: [
      { id: "subjectief", titel: "Subjectief", hint: "Wat de patiënt vertelt: klacht, duur, beloop, ernst." },
      { id: "objectief", titel: "Objectief", hint: "Waarneembare bevindingen, metingen en onderzoek." },
      beoordeling("analyse", "Analyse"),
      { id: "plan", titel: "Plan", hint: "Afspraken, behandeling, vervolgacties." },
    ],
  },
  aobp: {
    // Implementeert het concept-formaat "HEAP"; de naam volgt de Nederlandse
    // sectievolgorde (Anamnese · Onderzoek · Beoordeling · Plan, 07-09-2026).
    label: "Anamnese · Onderzoek · Beoordeling · Plan",
    doelgroep: "medisch-specialistisch/poliklinisch",
    secties: [
      { id: "anamnese", titel: "Anamnese", hint: "Klacht, duur, beloop en relevante voorgeschiedenis." },
      { id: "onderzoek", titel: "Onderzoek", hint: "Lichamelijk onderzoek, metingen en aanvullend onderzoek." },
      beoordeling("beoordeling", "Beoordeling"),
      { id: "plan", titel: "Plan", hint: "Beleid, medicatie, aanvragen en vervolgafspraken." },
    ],
  },
  soep: {
    label: "Huisartsconsult (SOEP)",
    doelgroep: "huisartsenzorg/NHG",
    secties: [
      { id: "subjectief", titel: "Subjectief", hint: "Hulpvraag en klachten in de woorden van de patiënt." },
      { id: "objectief", titel: "Objectief", hint: "Bevindingen bij onderzoek en metingen." },
      beoordeling("evaluatie", "Evaluatie"),
      { id: "plan", titel: "Plan", hint: "Beleid, voorschriften, controle en verwijzing." },
    ],
  },
  psychiatrie: {
    label: "Psychiatrisch consult",
    doelgroep: "GGZ",
    secties: [
      { id: "reden-van-komst", titel: "Reden van komst", hint: "Hulpvraag, hoofdklacht, duur en beloop." },
      {
        id: "speciele-anamnese",
        titel: "Speciële anamnese",
        hint: "Klachten per domein, uitlokkende en verlichtende factoren.",
      },
      {
        id: "psychiatrisch-onderzoek",
        titel: "Psychiatrisch onderzoek",
        hint: "Waarnemingen tijdens het gesprek: stemming, angst, cognitie.",
      },
      {
        id: "somatiek-medicatie",
        titel: "Somatiek & medicatie",
        hint: "Medicatie, allergieën en somatische voorgeschiedenis.",
      },
      { id: "sociale-anamnese", titel: "Sociale anamnese", hint: "Werk, relaties, leefstijl en familieanamnese." },
      beoordeling("risicotaxatie", "Risicotaxatie", "risico"),
      beoordeling("overwegingen", "Overwegingen"),
      { id: "beleid", titel: "Beleid", hint: "Afspraken, medicatiebeleid, vervolg en verwijzingen." },
    ],
  },
  verpleegkundig: {
    label: "Verpleegkundige rapportage",
    doelgroep: "verpleging/begeleiding",
    secties: [
      { id: "observaties", titel: "Observaties", hint: "Wat is waargenomen: gedrag, klachten, metingen." },
      { id: "interventies", titel: "Interventies", hint: "Uitgevoerde zorg en begeleiding." },
      // N4 — zonder ★-sectie maakt "Alles goedkeuren" een volledig machinaal
      // verslag in twee klikken definitief; juist deze discipline gebruikt de
      // module het vaakst.
      beoordeling("reactie-evaluatie", "Reactie & evaluatie"),
      { id: "vervolg", titel: "Vervolg", hint: "Afspraken en aandachtspunten voor de volgende dienst." },
    ],
  },
  seh: {
    label: "SEH-verslag",
    doelgroep: "spoedeisende hulp",
    secties: [
      { id: "reden-triage", titel: "Reden van komst & triage", hint: "Presentatie, urgentie en eerste opvang." },
      { id: "anamnese", titel: "Anamnese", hint: "Klacht, duur, beloop, medicatie en allergieën." },
      { id: "onderzoek", titel: "Onderzoek", hint: "Vitale parameters, lichamelijk en aanvullend onderzoek." },
      beoordeling("werkhypothese", "Werkhypothese"),
      { id: "beleid-vervolg", titel: "Beleid & vervolg", hint: "Behandeling, opname of ontslag en instructies." },
    ],
  },
  vervolg: {
    label: "Vervolgconsult",
    doelgroep: "alle disciplines",
    secties: [
      {
        id: "beloop-sinds-vorig-contact",
        titel: "Beloop sinds vorig contact",
        hint: "Wat is er veranderd sinds de vorige afspraak.",
      },
      { id: "huidige-klachten", titel: "Huidige klachten", hint: "Actuele klachten, ernst en beperkingen." },
      { id: "bevindingen", titel: "Bevindingen", hint: "Metingen, onderzoek en waarnemingen." },
      beoordeling("beoordeling", "Beoordeling"),
      { id: "beleid", titel: "Beleid", hint: "Voortzetting, bijstelling en vervolgafspraken." },
    ],
  },
  ontslag: {
    label: "Ontslagbrief",
    doelgroep: "klinische opname",
    secties: [
      { id: "opnamereden", titel: "Opnamereden", hint: "Reden van opname en presentatie." },
      { id: "beloop", titel: "Beloop", hint: "Beloop tijdens de opname." },
      {
        id: "bevindingen-onderzoeken",
        titel: "Bevindingen & onderzoeken",
        hint: "Uitgevoerde onderzoeken en uitkomsten.",
      },
      beoordeling("conclusie-beoordeling", "Conclusie & beoordeling"),
      { id: "medicatie-bij-ontslag", titel: "Medicatie bij ontslag", hint: "Actuele medicatie en allergieën." },
      { id: "vervolgafspraken", titel: "Vervolgafspraken", hint: "Controles, verwijzingen en aanvragen." },
      { id: "adviezen", titel: "Adviezen", hint: "Leefregels en instructies voor de patiënt." },
    ],
  },
};

export function formaatVoor(consultType: ConsultType): VerslagFormaat {
  return VERSLAG_FORMATEN[consultType];
}

/** Sectie-id's die een generator mág vullen (alle niet-★-secties). */
export function vrijeSectieIds(consultType: ConsultType): string[] {
  return VERSLAG_FORMATEN[consultType].secties
    .filter((sectie) => sectie.vereistBehandelaar !== true)
    .map((sectie) => sectie.id);
}

/** Sectie-id's die uitsluitend de behandelaar schrijft (★). */
export function beoordelingsSectieIds(consultType: ConsultType): string[] {
  return VERSLAG_FORMATEN[consultType].secties
    .filter((sectie) => sectie.vereistBehandelaar === true)
    .map((sectie) => sectie.id);
}

export function isBeoordelingsSectie(consultType: ConsultType, sectieId: string): boolean {
  return VERSLAG_FORMATEN[consultType].secties.some(
    (sectie) => sectie.id === sectieId && sectie.vereistBehandelaar === true,
  );
}

/** ★-secties die over risico gaan — zij citeren nooit de overwegingen (C48). */
export function isRisicoSectie(consultType: ConsultType, sectieId: string): boolean {
  return VERSLAG_FORMATEN[consultType].secties.some((sectie) => sectie.id === sectieId && sectie.soort === "risico");
}

/** Structuurplaceholder voor een lege ★-sectie; null wanneer er geen is. */
export function structuurPlaceholderVoor(consultType: ConsultType, sectieId: string): string | null {
  return isRisicoSectie(consultType, sectieId) ? RISICO_STRUCTUUR_PLACEHOLDER : null;
}

/** Alle consulttypen met hun label — voor keuzelijsten. */
export const FORMAAT_KEUZES: readonly { waarde: ConsultType; label: string; doelgroep: string }[] = CONSULT_TYPES.map(
  (type) => ({ waarde: type, label: VERSLAG_FORMATEN[type].label, doelgroep: VERSLAG_FORMATEN[type].doelgroep }),
);
