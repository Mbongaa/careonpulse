// HR — handmatig bijgehouden personeelsregistratie (handoff 12).
// Deze data komt NIET uit het EPD/ZSG-export: ziekteverzuim, verloop, vacatures,
// opleidingen, intervisie, werkdruk, de verzuimtrend en de BIG-registraties
// worden door de gebruiker zelf bijgehouden en centraal (Supabase) of lokaal
// (localStorage-fallback) bewaard — hetzelfde patroon als middelen (handoff 09).

// De zes geauditeerde HR-kerncijfers. De ids komen overeen met de detailId's
// van HR_METRICS (careon-hr.ts) en met de KPI-drilldownpagina's (handoff 08).
export const HR_KPI_IDS = ["verzuim", "verloop", "vacatures", "opleidingen", "intervisie", "werkdruk"] as const;

export type HrKpiId = (typeof HR_KPI_IDS)[number];

export interface HrKpiRule {
  max: number;
  integer?: boolean;
}

/** Domeingrenzen voor de handmatig bijgehouden HR-KPI's. */
export const HR_KPI_RULES: Record<HrKpiId, HrKpiRule> = {
  verzuim: { max: 100 },
  verloop: { max: 100 },
  vacatures: { max: 10_000, integer: true },
  opleidingen: { max: 10_000, integer: true },
  intervisie: { max: 100 },
  werkdruk: { max: 10 },
};

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
  trend: 12,
  /** Percentages/benchmark en trendpunten (verzuim in %). */
  percentage: 100,
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isBoundedNumber(value: unknown, max: number, integer = false): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max &&
    (!integer || Number.isInteger(value))
  );
}

function isPercentage(value: unknown): value is number {
  return isBoundedNumber(value, HR_LIMITS.percentage);
}

function isKpiWaarde(id: HrKpiId, value: unknown): value is HrKpiWaarde {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  const rule = HR_KPI_RULES[id];
  return isBoundedNumber(row.value, rule.max, rule.integer) && isBoundedNumber(row.prev, rule.max, rule.integer);
}

export function normalizeHrKpiValue(id: HrKpiId, value: number): number {
  const rule = HR_KPI_RULES[id];
  if (!Number.isFinite(value)) return 0;
  const bounded = Math.min(rule.max, Math.max(0, value));
  return rule.integer ? Math.round(bounded) : bounded;
}

export function isHrIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
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
    isHrIsoDate(row.verloopt)
  );
}

function hasUniqueBigRegistrations(rows: HrBigRegistratie[]): boolean {
  const keys = rows.map((row) => `${row.naam.trim().toLocaleLowerCase("nl-NL")}:${row.verloopt}`);
  return new Set(keys).size === keys.length;
}

export function isHrState(value: unknown): value is HrState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  if (typeof state.updatedAt !== "string" || Number.isNaN(Date.parse(state.updatedAt))) return false;
  if (typeof state.kpis !== "object" || state.kpis === null) return false;
  const kpis = state.kpis as Record<string, unknown>;
  if (!HR_KPI_IDS.every((id) => isKpiWaarde(id, kpis[id]))) return false;
  const bigRegistraties = state.bigRegistraties;
  return (
    isPercentage(state.benchmark) &&
    Array.isArray(state.verzuimTrend) &&
    state.verzuimTrend.length === HR_LIMITS.trend &&
    state.verzuimTrend.every(isPercentage) &&
    Array.isArray(bigRegistraties) &&
    bigRegistraties.length <= HR_LIMITS.big &&
    bigRegistraties.every(isBigRegistratie) &&
    hasUniqueBigRegistrations(bigRegistraties)
  );
}

/** Resterende dagen tot `verloopt` t.o.v. `vandaag` (kalenderdagen, UTC-veilig). */
export function bigDagenTot(verloopt: string, vandaag: Date): number {
  const eind = Date.parse(`${verloopt}T00:00:00Z`);
  const nu = Date.UTC(vandaag.getUTCFullYear(), vandaag.getUTCMonth(), vandaag.getUTCDate());
  return Math.round((eind - nu) / 86_400_000);
}
