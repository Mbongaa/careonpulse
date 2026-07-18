"use client";

import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonLiveBanner } from "@/app/(main)/dashboard/_components/careon/careon-live-banner";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { careonDetailHref } from "@/data/careon/careon-kpi-details";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";
import { PLANNING_METRICS } from "@/data/careon/careon-planning";

import { BezettingPanel } from "./bezetting-panel";
import { NoShowWeekdagPanel } from "./noshow-weekdag-panel";
import { UrenverdelingPanel } from "./urenverdeling-panel";

export function PlanningContent() {
  const { production } = useCareon();

  // Alleen "Gem. wachttijd (wkn)" is uit de cliëntendata-export berekenbaar;
  // de overige planning-KPI's wachten op de agenda- en urenexports.
  const metrics = PLANNING_METRICS.map((metric) =>
    production && metric.label === "Gem. wachttijd (wkn)"
      ? { ...production.gemWachttijdWkn, detailId: metric.detailId }
      : metric,
  );

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title={CAREON_PAGE_META.planning.title} sub={CAREON_PAGE_META.planning.sub} />
      <CareonLiveBanner page="planning" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {metrics.map((metric) => (
          <CareonKpiCard
            key={metric.label}
            metric={metric}
            href={metric.detailId ? careonDetailHref(metric.detailId) : undefined}
            sourceBadge={<CareonSourceBadge page="planning" widget={metric.label} />}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
        <BezettingPanel />
        <UrenverdelingPanel />
        <NoShowWeekdagPanel />
      </div>
    </div>
  );
}
