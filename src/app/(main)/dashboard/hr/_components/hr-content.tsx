"use client";

import { useCareonHr } from "@/app/(main)/dashboard/_components/careon/careon-hr-provider";
import { CareonHrSyncLine } from "@/app/(main)/dashboard/_components/careon/careon-hr-sync-line";
import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { CareonHandmatigBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { careonDetailHref } from "@/data/careon/careon-kpi-details";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";
import { hrMetrics } from "@/lib/careon-hr/insights";

import { BigRegistratiesPanel } from "./big-registraties";
import { HrBigEditor } from "./hr-big-editor";
import { HrKpiEditor } from "./hr-kpi-editor";
import { HrVerzuimEditor } from "./hr-verzuim-editor";
import { VerzuimChart } from "./verzuim-chart";

export function HrContent() {
  const { state } = useCareonHr();
  const vandaag = new Date();

  // Kaartwaarden komen uit de handmatige registratie; label/format/drilldown-id
  // blijven de geauditeerde HR_METRICS-meta.
  const metrics = hrMetrics(state);

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title={CAREON_PAGE_META.hr.title} sub={CAREON_PAGE_META.hr.sub} />

      <div className="flex flex-wrap items-center gap-2">
        <CareonHandmatigBadge />
        <CareonHrSyncLine />
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        {metrics.map((metric) => (
          <CareonKpiCard
            key={metric.label}
            metric={metric}
            href={metric.detailId ? careonDetailHref(metric.detailId) : undefined}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-12">
        <VerzuimChart trend={state.verzuimTrend} benchmark={state.benchmark} className="lg:col-span-7" />
        <BigRegistratiesPanel registraties={state.bigRegistraties} vandaag={vandaag} className="lg:col-span-5" />
      </div>

      <HrKpiEditor />
      <HrVerzuimEditor />
      <HrBigEditor registraties={state.bigRegistraties} vandaag={vandaag} />

      <p className="text-center text-muted-foreground text-xs">
        Handmatige registratie — deze personeelscijfers komen niet uit het EPD en worden door HR zelf bijgehouden.
      </p>
    </div>
  );
}
