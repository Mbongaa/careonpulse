"use client";

import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonLiveBanner } from "@/app/(main)/dashboard/_components/careon/careon-live-banner";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { careonDetailHref } from "@/data/careon/careon-kpi-details";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";
import { PATIENTEN_METRICS } from "@/data/careon/careon-patienten";

import { demoKpiMetric } from "../../details/_lib/kpi-demo-waarde";
import { PopulatieProfielPanel } from "./populatie-profiel-panel";
import { TreeknormPanel } from "./treeknorm-panel";
import { VraagtAandachtPanel } from "./vraagt-aandacht";
import { WachttijdTrendPanel } from "./wachttijd-trend-panel";
import { ZorgvormPanel } from "./zorgvorm-panel";

export function PatientenContent() {
  const { production, overrides, factor } = useCareon();

  // Productie: live metrics (op label) vervangen de demo-constanten; KPI's
  // zonder EPD-bron behouden demo-waarden en dragen een demo-badge. De
  // detailId reist expliciet mee zodat de drill-down in beide modi werkt.
  // Demo: dezelfde rekenregel als de cockpit en de drilldown (CSV-override +
  // locatieschaal voor schaalbare KPI's), anders toont "Actieve patiënten" hier
  // 1.248 waar de cockpit en de detailpagina 549 tonen.
  const metrics = PATIENTEN_METRICS.map((metric) => {
    const live = production?.patientenMetrics[metric.label];
    return live ? { ...live, detailId: metric.detailId } : demoKpiMetric(metric, overrides, factor);
  });

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title={CAREON_PAGE_META.patienten.title} sub={CAREON_PAGE_META.patienten.sub} />
      <CareonLiveBanner page="patienten" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {metrics.map((metric) => (
          <CareonKpiCard
            key={metric.label}
            metric={metric}
            href={metric.detailId ? careonDetailHref(metric.detailId) : undefined}
            sourceBadge={<CareonSourceBadge page="patienten" widget={metric.label} />}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-12">
        <TreeknormPanel className="lg:col-span-5" />
        <ZorgvormPanel className="lg:col-span-3" />
        <VraagtAandachtPanel className="lg:col-span-4" />
        {/* Productie-exclusief (geen demo-tegenhanger): rendert null in demo. */}
        <WachttijdTrendPanel className="lg:col-span-12" />
        {/* Productie-exclusief: statistisch populatieprofiel (rendert null in demo). */}
        <PopulatieProfielPanel className="lg:col-span-12" />
      </div>
    </div>
  );
}
