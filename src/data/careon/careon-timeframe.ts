// Per-grafiek tijdvenster. Alle reeksen in het dashboard zijn maandreeksen
// (de bronexports worden bij het parsen per maand geaggregeerd; fijnere
// granulariteit — week/dag — bestaat bewust niet in de opgeslagen data).
// Een venster is dus altijd "laatste N maanden" van de beschikbare reeks;
// "all" toont de volledige reeks (alle beschikbare maanden).

export type CareonTimeframe = "all" | "12m" | "6m" | "3m" | "1m";

export const CAREON_TIMEFRAME_OPTIONS: { value: CareonTimeframe; label: string; months: number }[] = [
  { value: "all", label: "Alles", months: Number.POSITIVE_INFINITY },
  { value: "12m", label: "12m", months: 12 },
  { value: "6m", label: "6m", months: 6 },
  { value: "3m", label: "3m", months: 3 },
  { value: "1m", label: "1m", months: 1 },
];

export const CAREON_TIMEFRAME_MONTHS: Record<CareonTimeframe, number> = {
  all: Number.POSITIVE_INFINITY,
  "12m": 12,
  "6m": 6,
  "3m": 3,
  "1m": 1,
};

export const CAREON_TIMEFRAME_LABELS: Record<CareonTimeframe, string> = {
  all: "Alle maanden",
  "12m": "Laatste 12 maanden",
  "6m": "Laatste 6 maanden",
  "3m": "Laatste 3 maanden",
  "1m": "Laatste maand",
};

/** Laatste N punten van een chronologisch gesorteerde maandreeks ("all" = alles). */
export function sliceTimeframe<T>(series: readonly T[], timeframe: CareonTimeframe): T[] {
  const months = CAREON_TIMEFRAME_MONTHS[timeframe];
  return Number.isFinite(months) ? series.slice(-months) : series.slice();
}

/** Maandsleutels ("2026-06") die binnen het venster vallen, uit een gesorteerde sleutelreeks. */
export function timeframeKeys(sortedKeys: readonly string[], timeframe: CareonTimeframe): Set<string> {
  const months = CAREON_TIMEFRAME_MONTHS[timeframe];
  return new Set(Number.isFinite(months) ? sortedKeys.slice(-months) : sortedKeys);
}
