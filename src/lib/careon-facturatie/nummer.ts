// Factuurnummer-formattering. De toekenning zelf is DB-werk (de atomaire RPC
// careon_factuur_definitief_maken, handoff 15 §5.5) — hier staat alleen de
// presentatie van reeks + jaar + volgnummer volgens het instellingen-template.
// Bewust géén 8-cijferig formaat: dat is het EPD-patroon (26000160) en de
// eigen reeks moet daar zichtbaar van afwijken (verify:careon asserteert dit).

const NUMMER_TOKEN = /\{nummer(?::(\d))?\}/;

export function formatFactuurnummer(formaat: string, reeks: string, jaar: number, volgnummer: number): string {
  const nummerMatch = formaat.match(NUMMER_TOKEN);
  const breedte = nummerMatch?.[1] ? Number.parseInt(nummerMatch[1], 10) : 4;
  return formaat
    .replace("{reeks}", reeks)
    .replace("{jaar}", String(jaar))
    .replace(NUMMER_TOKEN, String(volgnummer).padStart(breedte, "0"));
}

/** Vervaldatum = factuurdatum + betaaltermijn (ISO-datums, kalenderdagen). */
export function berekenVervaldatum(factuurdatum: string, betaaltermijnDagen: number): string {
  const datum = new Date(`${factuurdatum}T00:00:00Z`);
  datum.setUTCDate(datum.getUTCDate() + betaaltermijnDagen);
  return datum.toISOString().slice(0, 10);
}

/**
 * Art. 34g Wet OB: de factuur moet uiterlijk de 15e van de maand ná de
 * prestatiemaand worden uitgereikt. Alleen een UI-waarschuwing, geen blokkade.
 */
export function uitreikingstermijnOverschreden(prestatieTot: string, factuurdatum: string): boolean {
  const prestatie = new Date(`${prestatieTot}T00:00:00Z`);
  const uiterlijk = new Date(Date.UTC(prestatie.getUTCFullYear(), prestatie.getUTCMonth() + 1, 15));
  return new Date(`${factuurdatum}T00:00:00Z`).getTime() > uiterlijk.getTime();
}

/** "Te laat" is een afgeleide weergave, geen opgeslagen status (handoff 15 §3.1). */
export function isTeLaat(factuur: { status: string; vervaldatum: string | null }, vandaag: string): boolean {
  if (!factuur.vervaldatum) return false;
  if (factuur.status === "betaald" || factuur.status === "gecrediteerd" || factuur.status === "concept") return false;
  return factuur.vervaldatum < vandaag;
}
