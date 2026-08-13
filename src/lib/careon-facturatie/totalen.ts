import type { BtwCategorie, BtwTarief, BtwTotaal, FactuurRegel } from "./types";

// Totaalberekening — de ENIGE plek waar factuurbedragen worden opgeteld.
// De definitief-route herrekent hier server-side mee (client-getallen worden
// nooit vertrouwd) en verify:careon draait fixtures tegen deze functie.
// Alles in hele centen; afronding per regel (half-up), daarna optellen —
// dat is stabiel bij herberekening en verandert nooit met de regelvolgorde.

const TARIEF_PCT: Record<BtwTarief, number> = {
  vrijgesteld: 0,
  "0": 0,
  "9": 9,
  "21": 21,
};

export interface FactuurTotalen {
  subtotaalCent: number;
  btwCent: number;
  totaalCent: number;
  btwTotalen: BtwTotaal[];
}

/**
 * Afronden op hele centen, halven wég van nul: Math.round rondt -262,5 naar
 * -262 maar 262,5 naar 263, waardoor een creditfactuur (genegeerde regels)
 * één cent van het origineel kon afwijken zodra een bedrag exact op een
 * halve cent viel. Voor positieve bedragen identiek aan Math.round.
 */
function rondCent(bedrag: number): number {
  return Math.sign(bedrag) * Math.round(Math.abs(bedrag));
}

/** Nettobedrag van één regel in centen (aantal × stukprijs, korting eraf). */
export function regelBedragCent(regel: FactuurRegel): number {
  const bruto = regel.aantal * regel.stukprijsCent;
  const korting = regel.kortingPct ?? 0;
  return rondCent(bruto * (1 - korting / 100));
}

export function berekenTotalen(regels: FactuurRegel[]): FactuurTotalen {
  const perGroep = new Map<string, BtwTotaal>();

  let subtotaalCent = 0;
  let btwCent = 0;
  for (const regel of regels) {
    const grondslag = regelBedragCent(regel);
    const btw = rondCent((grondslag * TARIEF_PCT[regel.btwTarief]) / 100);
    subtotaalCent += grondslag;
    btwCent += btw;

    const sleutel = `${regel.btwTarief}:${regel.btwCategorie}`;
    const bestaand = perGroep.get(sleutel);
    if (bestaand) {
      bestaand.grondslagCent += grondslag;
      bestaand.btwCent += btw;
    } else {
      perGroep.set(sleutel, {
        tarief: regel.btwTarief,
        categorie: regel.btwCategorie as BtwCategorie,
        grondslagCent: grondslag,
        btwCent: btw,
      });
    }
  }

  // Vaste volgorde op de factuur: vrijgesteld → 0 → 9 → 21.
  const volgorde: BtwTarief[] = ["vrijgesteld", "0", "9", "21"];
  const btwTotalen = [...perGroep.values()].sort(
    (a, b) => volgorde.indexOf(a.tarief) - volgorde.indexOf(b.tarief) || a.categorie.localeCompare(b.categorie),
  );

  return { subtotaalCent, btwCent, totaalCent: subtotaalCent + btwCent, btwTotalen };
}

/** Volledig vrijgesteld ⇒ de pdf toont géén btw-kolom en géén 0%-regel. */
export function isVolledigVrijgesteld(regels: FactuurRegel[]): boolean {
  return regels.length > 0 && regels.every((regel) => regel.btwTarief === "vrijgesteld");
}

export function heeftVrijgesteldeRegels(regels: FactuurRegel[]): boolean {
  return regels.some((regel) => regel.btwTarief === "vrijgesteld");
}

const EURO_FORMAT = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

export function formatEuro(cent: number): string {
  return EURO_FORMAT.format(cent / 100);
}

/**
 * Btw-regel in het totalenblok, mét de grondslag van die groep — art. 35a
 * lid 1 sub h eist de vergoeding per tarief, en bij gemengde facturen is het
 * gecombineerde subtotaal daarvoor niet genoeg. Gedeeld door pdf en scherm
 * (en geasserteerd in verify:careon) zodat beide weergaven nooit uiteenlopen.
 */
export function btwRegelLabel(totaal: BtwTotaal): string {
  const basis = totaal.categorie === "AE" ? "Btw verlegd" : `Btw ${totaal.tarief}%`;
  return `${basis} over ${formatEuro(totaal.grondslagCent)}`;
}
