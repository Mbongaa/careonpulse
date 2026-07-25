// HR — handmatig bijgehouden personeelsregistratie (handoff 12).
// Deze data komt NIET uit het EPD/ZSG-export: ziekteverzuim, verloop, vacatures,
// opleidingen, intervisie, werkdruk, de verzuimtrend en de BIG-registraties
// worden door de gebruiker zelf bijgehouden en centraal (Supabase) of lokaal
// (localStorage-fallback) bewaard — hetzelfde patroon als middelen (handoff 09).

// De zes geauditeerde HR-kerncijfers. De ids komen overeen met de detailId's
// van HR_METRICS (careon-hr.ts) en met de KPI-drilldownpagina's (handoff 08).
export const HR_KPI_IDS = ["verzuim", "verloop", "vacatures", "opleidingen", "intervisie", "werkdruk"] as const;

export type HrKpiId = (typeof HR_KPI_IDS)[number];

/** Huidige en vorige-maand-waarde van één KPI; de delta wordt afgeleid. */
export interface HrKpiWaarde {
  value: number;
  prev: number;
}

/** Eén BIG-registratie. De resterende dagen worden live berekend uit `verloopt`
    en de huidige datum — niet opgeslagen — zodat de teller nooit veroudert. */
export interface HrBigRegistratie {
  naam: string;
  functie: string;
  /** ISO-datum (YYYY-MM-DD) waarop de registratie verloopt. */
  verloopt: string;
}

export interface HrState {
  /** Elk van de zes HR_KPI_IDS is aanwezig (nieuwe tabel, geen legacy-staten). */
  kpis: Record<HrKpiId, HrKpiWaarde>;
  /** Ziekteverzuim per maand (%), oplopend en uitgelijnd op CAREON_MONTHS. */
  verzuimTrend: number[];
  /** GGZ-benchmark ziekteverzuim (%), getoond als referentielijn. */
  benchmark: number;
  bigRegistraties: HrBigRegistratie[];
  updatedAt: string;
}

/** Metadata bij een centrale wijziging. Bevat bewust geen namen of tool-args. */
export interface HrChangeAudit {
  source: "assistant" | "manual";
  toolNames?: string[];
  requestIds?: string[];
}

// Grenzen voor de API-route: ruim boven reëel gebruik, maar een harde rem
// tegen misvormde of kwaadwillige payloads.
export const HR_LIMITS = {
  big: 200,
  naam: 120,
  functie: 80,
  trend: 24,
  /** KPI-waarden zijn niet-negatief (tellers, percentages, scores). */
  waarde: 1_000_000,
  /** Percentages/benchmark en trendpunten (verzuim in %). */
  percentage: 100,
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isWaardeGetal(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= HR_LIMITS.waarde;
}

function isPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= HR_LIMITS.percentage;
}

function isKpiWaarde(value: unknown): value is HrKpiWaarde {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return isWaardeGetal(row.value) && isWaardeGetal(row.prev);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}

function isBigRegistratie(value: unknown): value is HrBigRegistratie {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.naam === "string" &&
    row.naam.trim().length > 0 &&
    row.naam.length <= HR_LIMITS.naam &&
    typeof row.functie === "string" &&
    row.functie.length <= HR_LIMITS.functie &&
    isIsoDate(row.verloopt)
  );
}

export function isHrState(value: unknown): value is HrState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  if (typeof state.updatedAt !== "string" || Number.isNaN(Date.parse(state.updatedAt))) return false;
  if (typeof state.kpis !== "object" || state.kpis === null) return false;
  const kpis = state.kpis as Record<string, unknown>;
  if (!HR_KPI_IDS.every((id) => isKpiWaarde(kpis[id]))) return false;
  return (
    isPercentage(state.benchmark) &&
    Array.isArray(state.verzuimTrend) &&
    state.verzuimTrend.length <= HR_LIMITS.trend &&
    state.verzuimTrend.every(isPercentage) &&
    Array.isArray(state.bigRegistraties) &&
    state.bigRegistraties.length <= HR_LIMITS.big &&
    state.bigRegistraties.every(isBigRegistratie)
  );
}

/** Resterende dagen tot `verloopt` t.o.v. `vandaag` (kalenderdagen, UTC-veilig). */
export function bigDagenTot(verloopt: string, vandaag: Date): number {
  const eind = Date.parse(`${verloopt}T00:00:00Z`);
  const nu = Date.UTC(vandaag.getUTCFullYear(), vandaag.getUTCMonth(), vandaag.getUTCDate());
  return Math.round((eind - nu) / 86_400_000);
}
