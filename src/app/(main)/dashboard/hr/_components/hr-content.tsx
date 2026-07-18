import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonLiveBanner } from "@/app/(main)/dashboard/_components/careon/careon-live-banner";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { HR_METRICS } from "@/data/careon/careon-hr";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

import { BigRegistratiesPanel } from "./big-registraties";
import { VerzuimChart } from "./verzuim-chart";

export function HrContent() {
  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title={CAREON_PAGE_META.hr.title} sub={CAREON_PAGE_META.hr.sub} />

      <CareonLiveBanner page="hr" />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        {HR_METRICS.map((metric) => (
          <CareonKpiCard
            key={metric.label}
            metric={metric}
            sourceBadge={<CareonSourceBadge page="hr" widget={metric.label} />}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-12">
        <VerzuimChart className="lg:col-span-7" />
        <BigRegistratiesPanel className="lg:col-span-5" />
      </div>
    </div>
  );
}
