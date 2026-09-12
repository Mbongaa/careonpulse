// Careon Scribe — Nederlands getallenlexicon (handoff 20 §4.5).
//
// Spraakherkenning levert getallen bijna altijd als WOORD ("vijftig
// milligram", "vier glazen", "over twee weken"). Elke <n>-plaats in de
// deterministische extractie gebruikt daarom dit lexicon naast de cijfervorm;
// zonder deze laag mist de regelextractie de helft van het consult.
//
// Twee eisen maken deze laag veiligheidskritisch (C38):
//   * VERANKERING. Een niet-verankerd patroon matcht de STAART van een
//     samengesteld telwoord: "vijfentwintig" → "twintig", "honderdvijftig" →
//     "vijftig". Dat is geen gemiste dosering maar een stil FOUTE dosering in
//     het verslag dat naar het EPD gaat. De woordtak draagt daarom
//     `(?<![a-zà-ÿ])`/`(?![a-zà-ÿ])`; de cijfertak blijft bewust los zodat
//     "50mg" (zonder spatie) herkenbaar blijft.
//   * SAMENSTELLING. Verankering alléén maakt elke samengestelde dosering
//     onzichtbaar. Het lexicon is daarom compositioneel: eenheden, tienden,
//     tientallen, honderd- en duizendtallen en de decimale "komma"-vorm
//     worden geparseerd in plaats van opgezocht.

/** 1–9 — ook de kop van een samenstelling ("vijf" in "vijfentwintig"). */
const EENHEDEN: Record<string, number> = {
  een: 1,
  één: 1,
  twee: 2,
  drie: 3,
  vier: 4,
  vijf: 5,
  zes: 6,
  zeven: 7,
  acht: 8,
  negen: 9,
};

/** 10–19 — nooit de kop van een samenstelling. */
const TIEN_19: Record<string, number> = {
  tien: 10,
  elf: 11,
  twaalf: 12,
  dertien: 13,
  veertien: 14,
  vijftien: 15,
  zestien: 16,
  zeventien: 17,
  achttien: 18,
  negentien: 19,
};

/** 20–90 — de staart van een samenstelling ("twintig" in "vijfentwintig"). */
const TIENTALLEN: Record<string, number> = {
  twintig: 20,
  dertig: 30,
  veertig: 40,
  vijftig: 50,
  zestig: 60,
  zeventig: 70,
  tachtig: 80,
  negentig: 90,
};

/** Losse breukwoorden — geen onderdeel van een samenstelling. */
const LOSSE: Record<string, number> = {
  half: 0.5,
  halve: 0.5,
  anderhalf: 1.5,
  anderhalve: 1.5,
};

/**
 * Vlakke weergave van het lexicon. Blijft bestaan voor terugwaartse
 * compatibiliteit; de samengestelde vormen komen uit `parseNlGetal`, niet uit
 * deze tabel.
 */
export const NL_GETALLEN: Record<string, number> = {
  ...EENHEDEN,
  ...TIEN_19,
  ...TIENTALLEN,
  ...LOSSE,
  honderd: 100,
  tweehonderd: 200,
  duizend: 1000,
};

/** Langste alternatief eerst, zodat "zeventien" niet als "zeven" leest. */
function alternatieven(lexicon: Record<string, number>): string {
  return Object.keys(lexicon)
    .sort((links, rechts) => rechts.length - links.length)
    .join("|");
}

const EENHEID_BRON = alternatieven(EENHEDEN);
const TIEN_19_BRON = alternatieven(TIEN_19);
const TIENTAL_BRON = alternatieven(TIENTALLEN);
const LOSSE_BRON = alternatieven(LOSSE);

/** "honderd", "vijfhonderd", "duizend". */
const HONDERD_BRON = `(?:(?:${EENHEID_BRON})?honderd|duizend)`;

/** 1–99: "vijfentwintig" (ook met trema: "tweeëntwintig"), 20–90, 10–19, 1–9. */
const KLEIN_BRON = `(?:(?:${EENHEID_BRON})[eë]n(?:${TIENTAL_BRON})|${TIENTAL_BRON}|${TIEN_19_BRON}|${EENHEID_BRON})`;

/** Volledig telwoord: honderd-/duizendtal met optionele rest, of 1–99, of een breuk. */
const WOORD_BRON = `(?:${HONDERD_BRON}(?:en)?(?:${KLEIN_BRON})?|${KLEIN_BRON}|${LOSSE_BRON})`;

/**
 * Regexbron voor één getal: cijfers (met decimaalteken) óf een telwoord.
 * De woordtak is verankerd op letters — een tiental binnen een samengesteld
 * woord kan daardoor niet meer los matchen. Gebruik als
 * `new RegExp(\`sinds ${GETAL_PATROON} weken\`)`.
 */
export const GETAL_PATROON = `(?:(?<![\\d.,])\\d+(?:[.,]\\d+)?|(?<![a-zà-ÿ])(?:${WOORD_BRON})(?:\\s+komma\\s+(?:${KLEIN_BRON}))?(?![a-zà-ÿ]))`;

/** Diakrieten weg zodat "één" en "tweeëntwintig" dezelfde sleutels raken. */
function zonderDiakrieten(waarde: string): string {
  return waarde.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Eén telwoord zonder decimalen; null wanneer het niet te ontleden is. */
function parseTelwoord(ruw: string): number | null {
  let rest = zonderDiakrieten(ruw).replace(/\s+/g, "");
  if (rest.length === 0) return null;
  if (LOSSE[rest] !== undefined) return LOSSE[rest];

  let totaal = 0;
  let gezien = false;
  const duizendPositie = rest.indexOf("duizend");
  if (duizendPositie >= 0) {
    const kop = rest.slice(0, duizendPositie);
    const factor = kop.length === 0 ? 1 : (EENHEDEN[kop] ?? TIEN_19[kop] ?? null);
    if (factor === null) return null;
    totaal += factor * 1000;
    gezien = true;
    rest = rest.slice(duizendPositie + "duizend".length);
    if (rest.startsWith("en")) rest = rest.slice(2);
  }
  const honderdPositie = rest.indexOf("honderd");
  if (honderdPositie >= 0) {
    const kop = rest.slice(0, honderdPositie);
    const factor = kop.length === 0 ? 1 : (EENHEDEN[kop] ?? null);
    if (factor === null) return null;
    totaal += factor * 100;
    gezien = true;
    rest = rest.slice(honderdPositie + "honderd".length);
    if (rest.startsWith("en")) rest = rest.slice(2);
  }
  if (rest.length === 0) return gezien ? totaal : null;

  // "<eenheid>en<tiental>" — elke "en"-positie proberen, want "eenentwintig"
  // draagt de scheiding op de tweede.
  for (let positie = 1; positie + 2 < rest.length; positie += 1) {
    if (rest.slice(positie, positie + 2) !== "en") continue;
    const eenheid = EENHEDEN[rest.slice(0, positie)];
    const tiental = TIENTALLEN[rest.slice(positie + 2)];
    if (eenheid !== undefined && tiental !== undefined) return totaal + eenheid + tiental;
  }
  const enkel = TIENTALLEN[rest] ?? TIEN_19[rest] ?? EENHEDEN[rest] ?? null;
  return enkel === null ? null : totaal + enkel;
}

/** Woord of cijfer → getal; null wanneer het geen getal is. */
export function parseNlGetal(token: string): number | null {
  const schoon = token.trim().toLowerCase().replace(/\s+/g, " ");
  if (schoon.length === 0) return null;
  if (/^\d+(?:[.,]\d+)?$/.test(schoon)) {
    const waarde = Number.parseFloat(schoon.replace(",", "."));
    return Number.isFinite(waarde) ? waarde : null;
  }
  const delen = schoon.split(/\s+komma\s+/);
  if (delen.length === 2) {
    const geheel = parseTelwoord(delen[0]);
    const decimaal = parseTelwoord(delen[1]);
    if (geheel === null || decimaal === null) return null;
    const samengesteld = Number.parseFloat(`${geheel}.${decimaal}`);
    return Number.isFinite(samengesteld) ? samengesteld : null;
  }
  return delen.length === 1 ? parseTelwoord(schoon) : null;
}

/** Getal als tekst normaliseren naar cijfers: "vijfentwintig" → "25". */
export function getalNaarCijfer(token: string): string {
  const waarde = parseNlGetal(token);
  return waarde === null ? token : String(waarde);
}
