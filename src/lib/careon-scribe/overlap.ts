// Careon Scribe — ontdubbeling op de fragmentgrens (handoff 20 §5.3, puur).
//
// De opname stuurt fragmenten van ±8 seconden met 1 seconde OVERLAP (§7.6):
// zonder overlap knipt de grens midden in een woord en verdwijnt bijvoorbeeld
// een medicijnnaam. De prijs is dat de provider het overlappende stuk twee
// keer transcribeert. Deze functie knipt die herhaalde kop weg.
//
// Bewust tolerant: spraakherkenning levert de overlap zelden letterlijk
// hetzelfde (interpunctie, hoofdletters, een half woord). Een lopende reeks
// tokens telt als overlap bij ≥ 80% gelijkenis, waarbij een token dat een
// prefix of suffix van zijn tegenhanger is als treffer geldt — precies het
// geval "sertra" + "sertraline" op de grens.

const MAX_OVERLAP_TOKENS = 24;
const STANDAARD_DREMPEL = 0.8;

interface Token {
  waarde: string;
  start: number;
}

function tokeniseer(tekst: string): Token[] {
  const tokens: Token[] = [];
  const patroon = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;
  let treffer = patroon.exec(tekst);
  while (treffer !== null) {
    tokens.push({ waarde: normaliseer(treffer[0]), start: treffer.index });
    treffer = patroon.exec(tekst);
  }
  return tokens;
}

function normaliseer(waarde: string): string {
  return waarde
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let vorige = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const huidige = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const kosten = a[i - 1] === b[j - 1] ? 0 : 1;
      huidige[j] = Math.min(huidige[j - 1] + 1, vorige[j] + 1, vorige[j - 1] + kosten);
    }
    vorige = huidige;
  }
  return vorige[b.length];
}

/** Twee tokens gelden als hetzelfde woord — inclusief afgekapte varianten. */
function tokenGelijk(a: string, b: string): boolean {
  if (a === b) return true;
  const kort = a.length <= b.length ? a : b;
  const lang = a.length <= b.length ? b : a;
  // Woord doormidden geknipt op de fragmentgrens ("sertra" ↔ "sertraline").
  if (kort.length >= 3 && (lang.startsWith(kort) || lang.endsWith(kort))) return true;
  const afstand = levenshtein(a, b);
  return 1 - afstand / Math.max(a.length, b.length) >= STANDAARD_DREMPEL;
}

function gelijkenis(staart: Token[], kop: Token[]): number {
  if (staart.length === 0) return 0;
  let treffers = 0;
  for (let index = 0; index < staart.length; index += 1) {
    if (tokenGelijk(staart[index].waarde, kop[index].waarde)) treffers += 1;
  }
  return treffers / staart.length;
}

/**
 * Verwijdert uit `nieuweTekst` de kop die het staartstuk van het vorige
 * segment herhaalt. Geeft de nieuwe tekst zonder die kop terug (leeg wanneer
 * het hele fragment een herhaling was); zonder herkenbare overlap komt de
 * tekst ongewijzigd (getrimd) terug.
 */
export function verwijderOverlap(vorigeStaart: string, nieuweTekst: string, drempel = STANDAARD_DREMPEL): string {
  const nieuw = nieuweTekst.trim();
  if (vorigeStaart.trim().length === 0 || nieuw.length === 0) return nieuw;

  const staartTokens = tokeniseer(vorigeStaart);
  const kopTokens = tokeniseer(nieuw);
  if (staartTokens.length === 0 || kopTokens.length === 0) return nieuw;

  const maxK = Math.min(staartTokens.length, kopTokens.length, MAX_OVERLAP_TOKENS);
  const laatsteStaart = staartTokens[staartTokens.length - 1].waarde;
  for (let k = maxK; k >= 1; k -= 1) {
    const staart = staartTokens.slice(staartTokens.length - k);
    const kop = kopTokens.slice(0, k);
    if (gelijkenis(staart, kop) < drempel) continue;
    // Werd het vorige fragment middenin een woord afgekapt ("… sertra"), dan
    // draagt het nieuwe fragment de énige volledige schrijfwijze. Dat woord
    // blijft staan: een halve medicijnnaam verliezen is erger dan één keer
    // dubbel zien.
    const afgekaptOpDeGrens =
      laatsteStaart !== kop[k - 1].waarde && laatsteStaart.length >= 3 && kop[k - 1].waarde.startsWith(laatsteStaart);
    const teKnippen = afgekaptOpDeGrens ? k - 1 : k;
    if (teKnippen === 0) return nieuw;
    if (teKnippen >= kopTokens.length) return "";
    return nieuw.slice(kopTokens[teKnippen].start).trim();
  }
  return nieuw;
}

/** Laatste `tekens` van de lopende transcripttekst — invoer voor de volgende ronde. */
export function staartVan(tekst: string, tekens = 160): string {
  return tekst.length <= tekens ? tekst : tekst.slice(tekst.length - tekens);
}
