import { HR_METRICS } from "../../data/careon/careon-hr";
import type { CareonAlert, CareonMetric } from "../../data/careon/careon-types";
import { bigDagenTot, HR_KPI_IDS, type HrBigRegistratie, type HrKpiId, type HrState } from "./types";

export const HR_BIG_ALERT_TITLE = "BIG-registratie verloopt <90 dgn";

const datumFormatter = new Intl.DateTimeFormat("nl-NL", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export interface HrBigMetDagen extends HrBigRegistratie {
  dagen: number;
}

export function isHrKpiId(value: string): value is HrKpiId {
  return (HR_KPI_IDS as readonly string[]).includes(value);
}

export function hrMetrics(state: HrState): CareonMetric[] {
  return HR_METRICS.map((meta) => {
    const id = meta.detailId as HrKpiId;
    return { ...meta, ...state.kpis[id] };
  });
}

/** Eén definitie van het BIG-venster voor zowel het HR-paneel als de
    signalering; die liepen uiteen (`<= 90` naast `< 90`), waardoor een
    registratie die precies over 90 dagen verloopt wél in het paneel stond maar
    niet in de melding. `inclusiefVerlopen` is het enige verschil dat blijft: het
    paneel toont ook al verlopen registraties, de melding heet "<90 dgn". */
export function hrBigVenster(
  registraties: readonly HrBigRegistratie[],
  vandaag: Date,
  { grens = 90, inclusiefVerlopen = false }: { grens?: number; inclusiefVerlopen?: boolean } = {},
): HrBigMetDagen[] {
  return registraties
    .map((registratie) => ({ ...registratie, dagen: bigDagenTot(registratie.verloopt, vandaag) }))
    .filter((registratie) => registratie.dagen < grens && (inclusiefVerlopen ? true : registratie.dagen >= 0))
    .sort((a, b) => a.dagen - b.dagen || a.naam.localeCompare(b.naam, "nl"));
}

export function hrBigBinnenDagen(state: HrState, vandaag: Date, grens = 90): HrBigMetDagen[] {
  return hrBigVenster(state.bigRegistraties, vandaag, { grens });
}

export function formatHrDate(value: string): string {
  return datumFormatter.format(new Date(`${value}T00:00:00Z`));
}

export function buildHrBigAlert(state: HrState, vandaag: Date): CareonAlert | null {
  const registraties = hrBigBinnenDagen(state, vandaag);
  if (registraties.length === 0) return null;
  const formatter = new Intl.ListFormat("nl-NL", { style: "long", type: "conjunction" });
  return {
    sev: "hoog",
    titel: HR_BIG_ALERT_TITLE,
    unit: "medewerkers",
    detail: `${formatter.format(registraties.map((row) => `${row.naam} (${row.dagen} dgn)`))}.`,
    n: registraties.length,
    page: "hr",
  };
}
