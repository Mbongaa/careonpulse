"use client";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonDonut, CareonDonutLegend } from "@/app/(main)/dashboard/_components/careon/careon-donut";
import { URENVERDELING } from "@/data/careon/careon-planning";

const totaal = URENVERDELING.reduce((sum, item) => sum + item.value, 0);

export function UrenverdelingPanel({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard
      title="Urenverdeling"
      sub={`${totaal.toLocaleString("nl-NL")} geplande uren`}
      className={className}
    >
      <div className="flex flex-col gap-4">
        <CareonDonut data={URENVERDELING} suffix=" uur" height={160} />
        <CareonDonutLegend data={URENVERDELING} />
      </div>
    </CareonChartCard>
  );
}
