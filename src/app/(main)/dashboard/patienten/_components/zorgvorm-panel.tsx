"use client";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonDonut, CareonDonutLegend } from "@/app/(main)/dashboard/_components/careon/careon-donut";
import { ZORGVORM_VERDELING } from "@/data/careon/careon-patienten";

export function ZorgvormPanel({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard title="Zorgvorm" sub="Actieve trajecten" className={className}>
      <div className="flex flex-col gap-4">
        <CareonDonut data={ZORGVORM_VERDELING} suffix="%" height={160} />
        <CareonDonutLegend data={ZORGVORM_VERDELING} suffix="%" />
      </div>
    </CareonChartCard>
  );
}
