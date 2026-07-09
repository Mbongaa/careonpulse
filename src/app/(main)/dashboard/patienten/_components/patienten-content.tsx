import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";
import { PATIENTEN_METRICS } from "@/data/careon/careon-patienten";

import { TreeknormPanel } from "./treeknorm-panel";
import { VraagtAandachtPanel } from "./vraagt-aandacht";
import { ZorgvormPanel } from "./zorgvorm-panel";

export function PatientenContent() {
  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title={CAREON_PAGE_META.patienten.title} sub={CAREON_PAGE_META.patienten.sub} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {PATIENTEN_METRICS.map((metric) => (
          <CareonKpiCard key={metric.label} metric={metric} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-12">
        <TreeknormPanel className="lg:col-span-5" />
        <ZorgvormPanel className="lg:col-span-3" />
        <VraagtAandachtPanel className="lg:col-span-4" />
      </div>
    </div>
  );
}
