"use client";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonDonut, CareonDonutLegend } from "@/app/(main)/dashboard/_components/careon/careon-donut";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { ZORGVORM_VERDELING } from "@/data/careon/careon-patienten";

// Blijft demo: de EPD-data van deze instelling kent alleen SGGZ, waardoor een
// zorgvorm-verdeling geen informatie draagt (zie provenance-register).
export function ZorgvormPanel({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard
      title="Zorgvorm"
      sub="Actieve trajecten"
      className={className}
      titleBadge={<CareonSourceBadge page="patienten" widget="Zorgvorm" />}
    >
      <div className="flex flex-col gap-4">
        <CareonDonut data={ZORGVORM_VERDELING} suffix="%" height={160} />
        <CareonDonutLegend data={ZORGVORM_VERDELING} suffix="%" />
      </div>
    </CareonChartCard>
  );
}
