const ACTIE_WOORDEN =
  /\b(voeg|verwijder|wijzig|verander|geef|neem|registreer|noteer|zet|update|hernoem|ken|schrijf|maak|koppel|ontkoppel|toekennen|toewijzen|invullen|vul)\b|\btoe te kennen\b/i;
const MIDDELEN_WOORDEN =
  /\b(middel(en)?|laptops?|telefoons?|tankpas(sen)?|sleutels?|toegang|auto'?s?|inventaris|behandelkamers?|boeken|diagnostiek|teamtags?|notities?|functie|taal|talen|medewerkers?|personeel|teams?|locaties?|dienstverband|uit dienst|in dienst|ontslag|vertrek)\b/i;
const LEES_WOORDEN = /\b(overzicht|inzicht|analyse|hoeveel|wat|welke|wie|waar|toon|laat|status|rapport)\b/i;
const NOTITIE_WOORDEN = /\b(notitie|notities|kenteken|sleutelnummer|laptop-?tag|asset-?tag)\b/i;
const ALLEEN_AGGREGAAT = /\b(hoeveel|aantal|totaal|telling)\b/i;
const EXPLICIETE_NAMEN = /\b(wie|welke medewerkers?|namen?|per medewerker)\b/i;

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
 * Beslisregel van de live beurt (AVG-risicopunt uit handoff 11): de
 * personeelsregistratie — namen, functies, talen, teamtags — gaat alleen naar
 * de AI-provider wanneer de beurt die namen echt nodig heeft. Een pure telling
 * krijgt uitsluitend aggregaten. Actiebeurten hebben de namen wél nodig (de
 * executor resolvet erop, en het model moet weten wie er bestaat), net als
 * vervolgbeurten op een openstaand concept: die bouwen op eerder geraakte
 * medewerkers voort.
 */
export function includeMiddelenNamesForTurn(text: string, openConcept = false): boolean {
  return openConcept || isMiddelenAction(text) || includeMiddelenNames(text);
}
