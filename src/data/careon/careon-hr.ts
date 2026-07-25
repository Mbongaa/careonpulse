// Runtime-imports bewust relatief: de verify-scripts draaien via ts-node zonder
// de @/-alias op runtime-require's (zie careon-middelen.ts voor dezelfde reden).
import { HR_KPI_IDS, type HrBigRegistratie, type HrState } from "../../lib/careon-hr/types";
import { CAREON_MONTHLY, GGZ_VERZUIM_BENCHMARK } from "./careon-shared-charts";
import type { CareonMetric } from "./careon-types";

export const HR_METRICS: CareonMetric[] = [
  { label: "Ziekteverzuim", value: 5.8, prev: 6.4, f: "pct", betterLow: true, detailId: "verzuim" },
  { label: "Verloop (12m)", value: 11, prev: 14, f: "pct0", betterLow: true, detailId: "verloop" },
  { label: "Openstaande vacatures", value: 4, prev: 6, f: "int", betterLow: true, detailId: "vacatures" },
  { label: "Lopende opleidingen", value: 12, prev: 9, f: "int", detailId: "opleidingen" },
  { label: "Intervisie-deelname", value: 92, prev: 88, f: "pct0", detailId: "intervisie" },
  { label: "Werkdrukscore", value: 6.9, prev: 7.3, f: "dec1", betterLow: true, detailId: "werkdruk" },
];

export const BIG_REGISTRATIES = [
  { naam: "L. Vermeer", functie: "GZ-psycholoog", verloopt: "14 aug 2026", dagen: 39 },
  { naam: "T. Bakker", functie: "Psychotherapeut", verloopt: "2 sep 2026", dagen: 58 },
  { naam: "S. Yılmaz", functie: "SPV", verloopt: "28 sep 2026", dagen: 84 },
];

export const HR_BIG_NOTE =
  "Careon Pulse mailt medewerker en teamleider automatisch 90, 60 en 30 dagen vóór het verlopen van de registratie.";

// ---- Handmatige HR-registratie (handoff 12) ----
// HR-cijfers komen niet uit het EPD; de gebruiker houdt ze zelf bij. De seed
// hieronder is de startstand — exact de geauditeerde waarden (HR_METRICS,
// BIG_REGISTRATIES, verzuimtrend) — die de klant vervolgens overschrijft. Anders
// dan middelen start HR ook in productie niet leeg: elke organisatie heeft een
// verzuim-% en een werkdrukscore, dus een lege pagina zou nergens naar wijzen.

// De ISO-verloopdata horend bij BIG_REGISTRATIES ("14 aug 2026" → "2026-08-14").
// De resterende dagen worden live berekend, dus deze data zijn de bron van waarheid.
const BIG_SEED: HrBigRegistratie[] = [
  { naam: "L. Vermeer", functie: "GZ-psycholoog", verloopt: "2026-08-14" },
  { naam: "T. Bakker", functie: "Psychotherapeut", verloopt: "2026-09-02" },
  { naam: "S. Yılmaz", functie: "SPV", verloopt: "2026-09-28" },
];

// Vaste seed-datum: de registratie blijft deterministisch (ook voor e2e-asserties).
export const HR_SEED_UPDATED_AT = "2026-07-01T09:00:00.000Z";

const HR_METRIC_BY_ID = new Map(HR_METRICS.map((metric) => [metric.detailId, metric]));

export const HR_SEED_STATE: HrState = {
  kpis: Object.fromEntries(
    HR_KPI_IDS.map((id) => {
      const metric = HR_METRIC_BY_ID.get(id);
      if (!metric) throw new Error(`HR_SEED_STATE: geen HR_METRICS-waarde voor "${id}"`);
      return [id, { value: metric.value, prev: metric.prev }];
    }),
  ) as HrState["kpis"],
  verzuimTrend: CAREON_MONTHLY.map((point) => point.verzuim),
  benchmark: GGZ_VERZUIM_BENCHMARK,
  bigRegistraties: BIG_SEED,
  updatedAt: HR_SEED_UPDATED_AT,
};
