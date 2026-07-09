import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";
import { PLANNING_METRICS } from "@/data/careon/careon-planning";

import { BezettingPanel } from "./bezetting-panel";
import { NoShowWeekdagPanel } from "./noshow-weekdag-panel";
import { UrenverdelingPanel } from "./urenverdeling-panel";

export function PlanningContent() {
  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title={CAREON_PAGE_META.planning.title} sub={CAREON_PAGE_META.planning.sub} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {PLANNING_METRICS.map((metric) => (
          <CareonKpiCard key={metric.label} metric={metric} />
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
