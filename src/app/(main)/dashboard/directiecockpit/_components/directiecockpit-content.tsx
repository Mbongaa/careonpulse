"use client";

import { HeartHandshake } from "lucide-react";

import { CareonInsights } from "@/app/(main)/dashboard/_components/careon/careon-insights";
import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonLiveBanner } from "@/app/(main)/dashboard/_components/careon/careon-live-banner";
import { CareonOmzetChart } from "@/app/(main)/dashboard/_components/careon/careon-omzet-chart";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { useCareonSessionInfo } from "@/app/(main)/dashboard/_components/careon/careon-session-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { careonDetailHref } from "@/data/careon/careon-kpi-details";
import { COCKPIT_INSIGHTS } from "@/data/careon/careon-kpis";

import { CaseloadChart, InstroomUitstroomChart, NoShowChart } from "./cockpit-charts";
import { DossiersProductieSummary } from "./dossiers-productie-summary";
import { UrgentAlertsPanel } from "./urgent-alerts";

export function DirectiecockpitContent() {
  const { filters, kpis, production } = useCareon();
  // Financiële rolregel: voor leden verdwijnen de omzetkaarten, de
  // omzetgrafiek en het omzet-insight volledig (klantbesluit 28-07-2026).
  const { financieelZichtbaar } = useCareonSessionInfo();

  const scope = filters.locatie === "Alle locaties" ? "binnen TGC Groep" : `binnen locatie ${filters.locatie}`;

  // In productie-modus vervangen EPD-waarden de demo-constanten voor de
  // live/afgeleide KPI's; demo-KPI's behouden hun waarde en krijgen een badge.
  // De bron-badge blijft gesleuteld op het demo-label, ook als de live metric
  // de kaart een productielabel geeft (bijv. "Omzet Vecozo (VGZ + DSW)").
  const zichtbareKpis = financieelZichtbaar ? kpis : kpis.filter((kpi) => kpi.page !== "financieel");
  const displayKpis = zichtbareKpis.map((kpi) => {
    const live = production?.cockpitKpis[kpi.id];
    if (!live) {
      return { kpi, badgeWidget: kpi.label };
    }
    return {
      kpi: {
        ...kpi,
        label: live.label ?? kpi.label,
        value: live.value,
        prev: live.prev,
        spark: live.spark,
        windowLabel: live.windowLabel,
        secondary: live.secondary,
      },
      badgeWidget: kpi.label,
    };
  });

  // Productie-exclusief (driedeling van het facturatie-overzicht van de
  // klant): RMO/RMA-omzet als eigen kaart, direct na de servicebureau-kaart.
  const rmoLive = production && financieelZichtbaar ? production.cockpitKpis.omzetrmo : undefined;
  if (rmoLive) {
    displayKpis.splice(displayKpis.findIndex((item) => item.kpi.id === "omzetinfo") + 1, 0, {
      kpi: {
        id: "omzetrmo",
        label: rmoLive.label ?? "Omzet RMO/RMA",
        icon: HeartHandshake,
        value: rmoLive.value,
        prev: rmoLive.prev,
        f: "eurK",
        spark: rmoLive.spark,
        windowLabel: rmoLive.windowLabel,
        secondary: rmoLive.secondary,
        page: "financieel",
      },
      badgeWidget: "Omzet RMO/RMA",
    });
  }

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title="Directiecockpit" sub={`Welkom terug — dit speelt er vandaag ${scope}.`} />
      <CareonLiveBanner page="cockpit" />
      <CareonInsights
        messages={(production ? production.cockpitInsights : COCKPIT_INSIGHTS).filter(
          (bericht) => financieelZichtbaar || !/omzet|declarat|factur|infomedics|€/i.test(bericht),
        )}
        badge={<CareonSourceBadge page="cockpit" widget="Careon Insights" />}
      />
      <div className="careon-kpi-grid grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {/* Kaarten openen sinds handoff 08 hun KPI-drilldown; de detailpagina
            linkt zelf door naar de betreffende domeinpagina. */}
        {displayKpis.map(({ kpi, badgeWidget }) => (
          <CareonKpiCard
            key={kpi.id}
            metric={kpi}
            href={careonDetailHref(kpi.id)}
            sourceBadge={<CareonSourceBadge page="cockpit" widget={badgeWidget} />}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-12">
        <InstroomUitstroomChart className="lg:col-span-8" />
        <UrgentAlertsPanel className="lg:col-span-4" />
        <DossiersProductieSummary className="lg:col-span-12" />
        {financieelZichtbaar && <CareonOmzetChart className="lg:col-span-6" provenancePage="cockpit" />}
        <NoShowChart className={financieelZichtbaar ? "lg:col-span-3" : "lg:col-span-6"} />
        <CaseloadChart className={financieelZichtbaar ? "lg:col-span-3" : "lg:col-span-6"} />
      </div>
    </div>
  );
}
