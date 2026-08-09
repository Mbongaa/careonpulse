// Eén rekenregel voor de demo-waarde van een KPI, gedeeld door de
// eigenaarspagina's (Patiënten, Financieel, Dossiercontrole) en de
// KPI-drilldown. De Directiecockpit past dezelfde regel al inline toe in
// careon-provider (`kpis`).
//
// Zonder een gedeelde regel toont dezelfde KPI één klik verderop een ander
// getal: de cockpit verwerkt de Databron-CSV en schaalt op locatie, de
// eigenaarspagina's deden geen van beide. De drilldown kan het niet met twee
// verschillende kaarten tegelijk eens zijn, dus lopen alle drie nu via deze
// module.
//
// De regel is de geauditeerde regel uit de bron-bundle: eerst de
// CSV-override op KPI-id, daarna de locatieschaal — en alleen voor KPI's die
// als schaalbaar zijn gemarkeerd. Percentages en scores schalen nooit mee.
// Bewaakt door verify:careon (sectie "kaart ≡ drilldown").

import { KPI_DETAIL_BY_ID } from "@/data/careon/careon-kpi-details";
import type { CareonKpiOverrides, CareonMetricLike } from "@/data/careon/careon-types";

export interface KpiDemoBasis {
  value: number;
  prev: number | null;
}

/** True zodra deze KPI met het locatiefilter mee mag schalen (geauditeerde vlag). */
export function isSchaalbareKpi(detailId: string | undefined): boolean {
  return Boolean(detailId && KPI_DETAIL_BY_ID.get(detailId)?.scale);
}

export function demoKpiWaarde(
  detailId: string | undefined,
  basis: KpiDemoBasis,
  overrides: CareonKpiOverrides,
  factor: number,
): KpiDemoBasis {
  const override = detailId ? overrides[detailId] : undefined;
  const value = override ? override.value : basis.value;
  const prev = override ? override.prev : basis.prev;
  if (!isSchaalbareKpi(detailId) || factor === 1) {
    return { value, prev };
  }
  // Afronding gelijk aan de cockpit-provider, anders wijkt de kaart op de
  // eigenaarspagina alsnog een eenheid af van dezelfde kaart op de cockpit.
  return { value: Math.round(value * factor), prev: prev === null ? null : Math.round(prev * factor) };
}

/** Kaartvariant: laat label, formaat en delta-vlaggen ongemoeid. */
export function demoKpiMetric(
  metric: CareonMetricLike,
  overrides: CareonKpiOverrides,
  factor: number,
): CareonMetricLike {
  const afgeleid = demoKpiWaarde(metric.detailId, { value: metric.value, prev: metric.prev }, overrides, factor);
  if (afgeleid.value === metric.value && afgeleid.prev === metric.prev) {
    return metric;
  }
  return { ...metric, value: afgeleid.value, prev: afgeleid.prev };
}

/**
 * Trendreeks van de drilldown: volgt de kopwaarde, dus dezelfde schaalvlag.
 * Telformaten ronden op hele eenheden af — anders eindigt de grafiek op 549,1
 * waar de kaart erboven 549 toont.
 */
export function demoKpiTrend(detailId: string | undefined, trend: readonly number[], factor: number): number[] {
  if (!isSchaalbareKpi(detailId) || factor === 1) {
    return [...trend];
  }
  const heleEenheden = detailId ? KPI_DETAIL_BY_ID.get(detailId)?.f === "int" : false;
  return trend.map((punt) => (heleEenheden ? Math.round(punt * factor) : Math.round(punt * factor * 10) / 10));
}
