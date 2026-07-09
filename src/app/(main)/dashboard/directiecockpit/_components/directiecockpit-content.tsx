"use client";

import { CareonInsights } from "@/app/(main)/dashboard/_components/careon/careon-insights";
import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonOmzetChart } from "@/app/(main)/dashboard/_components/careon/careon-omzet-chart";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { COCKPIT_INSIGHTS } from "@/data/careon/careon-kpis";
import { CAREON_ROUTES } from "@/data/careon/careon-pages";

import { CaseloadChart, InstroomUitstroomChart, NoShowChart } from "./cockpit-charts";
import { DossiersProductieSummary } from "./dossiers-productie-summary";
import { UrgentAlertsPanel } from "./urgent-alerts";

export function DirectiecockpitContent() {
  const { filters, kpis } = useCareon();

  const scope = filters.locatie === "Alle locaties" ? "binnen TGC Groep" : `binnen locatie ${filters.locatie}`;

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title="Directiecockpit" sub={`Welkom terug — dit speelt er vandaag ${scope}.`} />
      <CareonInsights messages={COCKPIT_INSIGHTS} />
      <div className="careon-kpi-grid grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <CareonKpiCard key={kpi.id} metric={kpi} href={CAREON_ROUTES[kpi.page]} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-12">
        <InstroomUitstroomChart className="lg:col-span-8" />
        <UrgentAlertsPanel className="lg:col-span-4" />
        <DossiersProductieSummary className="lg:col-span-12" />
        <CareonOmzetChart className="lg:col-span-6" />
        <NoShowChart className="lg:col-span-3" />
        <CaseloadChart className="lg:col-span-3" />
      </div>
    </div>
  );
}
