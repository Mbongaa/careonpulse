import { MIDDELEN_TOOL_NAMES, type MiddelenToolName } from "./assistant-tools";

const ACTIE_WOORDEN =
  /\b(voeg|verwijder|wijzig|verander|geef|neem|registreer|noteer|zet|update|hernoem|ken|schrijf|maak|koppel|ontkoppel)\b/i;
const MIDDELEN_WOORDEN =
  /\b(middel(en)?|laptops?|telefoons?|tankpas(sen)?|sleutels?|toegang|auto'?s?|inventaris|behandelkamers?|boeken|diagnostiek|teamtags?|notities?|functie|taal|talen|medewerkers?|personeel|teams?|locaties?|dienstverband|uit dienst|in dienst|ontslag|vertrek)\b/i;
const LEES_WOORDEN = /\b(overzicht|inzicht|analyse|hoeveel|wat|welke|wie|waar|toon|laat|status|rapport)\b/i;
const NOTITIE_WOORDEN = /\b(notitie|notities|kenteken|sleutelnummer|laptop-?tag|asset-?tag)\b/i;
const ALLEEN_AGGREGAAT = /\b(hoeveel|aantal|totaal|telling)\b/i;
const EXPLICIETE_NAMEN = /\b(wie|welke medewerkers?|namen?|per medewerker)\b/i;

const CATEGORIEEN: { patroon: RegExp; tools: MiddelenToolName[] }[] = [
  {
    patroon: /\b(auto'?s?|tankpas(sen)?|sleutels?|telefoons?|laptops?|toegang|middel(en)?)\b/i,
    tools: ["wijzig_middel", "wijzig_middel_bulk"],
  },
  {
    patroon: /\b(taal|talen|nederlands|engels|turks|arabisch|farsi|dari|koerdisch|berbers|pools|oekra[ïi]ens)\b/i,
    tools: ["wijzig_taal", "wijzig_taal_bulk"],
  },
  {
    patroon: /\b(functie|kwalificatie|psycholoog|psychiater|psychotherapeut|spv|basisarts)\b/i,
    tools: ["zet_functie"],
  },
  { patroon: /\b(uit dienst|in dienst|dienstverband|ontslag|vertrek|stopt|vertrekt)\b/i, tools: ["zet_dienstverband"] },
  { patroon: NOTITIE_WOORDEN, tools: ["zet_notitie"] },
  {
    patroon:
      /\b(voeg|registreer|schrijf|maak)\b.{0,40}\b(nieuwe?\s+)?(medewerker|behandelaar|persoon)\b|\b(inschrijven|aanmaken)\b/i,
    tools: ["voeg_medewerker_toe"],
  },
  {
    patroon: /\b(verwijder|wis)\b.{0,40}\b(medewerker|behandelaar|persoon)\b|\buitschrijven\b/i,
    tools: ["verwijder_medewerker"],
  },
  { patroon: /\b(teamtag|teamtags|koppel|ontkoppel)\b/i, tools: ["wijzig_teamtag"] },
  { patroon: /\b(voeg|maak|registreer)\b.{0,30}\bteams?\b/i, tools: ["voeg_team_toe"] },
  { patroon: /\b(verwijder|wis)\b.{0,30}\bteams?\b/i, tools: ["verwijder_team"] },
  {
    patroon: /\b(inventaris|behandelkamers?|boeken|diagnostiek|voorraad)\b/i,
    tools: ["zet_inventaris"],
  },
  {
    patroon: /\b(voeg|maak|registreer)\b.{0,30}\b(locatie|vestiging|opslag|hoofdkantoor)\b/i,
    tools: ["voeg_locatie_toe"],
  },
  { patroon: /\b(verwijder|wis)\b.{0,30}\b(locatie|vestiging|opslag|hoofdkantoor)\b/i, tools: ["verwijder_locatie"] },
];

export function isMiddelenRelevant(text: string): boolean {
  return MIDDELEN_WOORDEN.test(text);
}

export function isMiddelenAction(text: string): boolean {
  return ACTIE_WOORDEN.test(text) && MIDDELEN_WOORDEN.test(text) && !LEES_WOORDEN.test(text);
}

export function includeMiddelenNotes(text: string): boolean {
  return NOTITIE_WOORDEN.test(text);
}

export function includeMiddelenNames(text: string): boolean {
  return !ALLEEN_AGGREGAAT.test(text) || EXPLICIETE_NAMEN.test(text);
}

/**
 * Least-privilege tool routing. Read-only requests receive no mutation tools;
 * action requests receive only the categories named by the user. An open
 * concept with an underspecified follow-up keeps the full set available so a
 * user can still say "pas dat aan" without losing the existing workflow.
 */
export function selectMiddelenTools(text: string, hasOpenConcept: boolean): MiddelenToolName[] {
  if (!isMiddelenAction(text) && !hasOpenConcept) return [];

  const selected = new Set<MiddelenToolName>(["lees_middelen_registratie"]);
  for (const categorie of CATEGORIEEN) {
    if (categorie.patroon.test(text)) {
      for (const tool of categorie.tools) selected.add(tool);
    }
  }

  if (selected.size === 1) {
    for (const tool of MIDDELEN_TOOL_NAMES) selected.add(tool);
  }
  return [...selected];
}
