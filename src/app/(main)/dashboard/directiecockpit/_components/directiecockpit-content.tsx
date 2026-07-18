"use client";

import { CareonInsights } from "@/app/(main)/dashboard/_components/careon/careon-insights";
import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonLiveBanner } from "@/app/(main)/dashboard/_components/careon/careon-live-banner";
import { CareonOmzetChart } from "@/app/(main)/dashboard/_components/careon/careon-omzet-chart";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { careonDetailHref } from "@/data/careon/careon-kpi-details";
import { COCKPIT_INSIGHTS } from "@/data/careon/careon-kpis";

import { CaseloadChart, InstroomUitstroomChart, NoShowChart } from "./cockpit-charts";
import { DossiersProductieSummary } from "./dossiers-productie-summary";
import { UrgentAlertsPanel } from "./urgent-alerts";

export function DirectiecockpitContent() {
  const { filters, kpis, production } = useCareon();

  const scope = filters.locatie === "Alle locaties" ? "binnen TGC Groep" : `binnen locatie ${filters.locatie}`;

  // In productie-modus vervangen EPD-waarden de demo-constanten voor de
  // live/afgeleide KPI's; demo-KPI's behouden hun waarde en krijgen een badge.
  const displayKpis = kpis.map((kpi) => {
    const live = production?.cockpitKpis[kpi.id];
    if (!live) {
      return kpi;
    }
    return {
      ...kpi,
      value: live.value,
      prev: live.prev,
      spark: live.spark,
      windowLabel: live.windowLabel,
    };
  });

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title="Directiecockpit" sub={`Welkom terug — dit speelt er vandaag ${scope}.`} />
      <CareonLiveBanner page="cockpit" />
      <CareonInsights
        messages={production ? production.cockpitInsights : COCKPIT_INSIGHTS}
        badge={<CareonSourceBadge page="cockpit" widget="Careon Insights" />}
      />
      <div className="careon-kpi-grid grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {/* Kaarten openen sinds handoff 08 hun KPI-drilldown; de detailpagina
            linkt zelf door naar de betreffende domeinpagina. */}
        {displayKpis.map((kpi) => (
          <CareonKpiCard
            key={kpi.id}
            metric={kpi}
            href={careonDetailHref(kpi.id)}
            sourceBadge={<CareonSourceBadge page="cockpit" widget={kpi.label} />}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-12">
        <InstroomUitstroomChart className="lg:col-span-8" />
        <UrgentAlertsPanel className="lg:col-span-4" />
        <DossiersProductieSummary className="lg:col-span-12" />
        <CareonOmzetChart className="lg:col-span-6" provenancePage="cockpit" />
        <NoShowChart className="lg:col-span-3" />
        <CaseloadChart className="lg:col-span-3" />
      </div>
    </div>
  );
}
