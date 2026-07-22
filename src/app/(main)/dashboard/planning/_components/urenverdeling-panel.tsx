"use client";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonDonut, CareonDonutLegend } from "@/app/(main)/dashboard/_components/careon/careon-donut";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { URENVERDELING } from "@/data/careon/careon-planning";

const demoTotaal = URENVERDELING.reduce((sum, item) => sum + item.value, 0);

export function UrenverdelingPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  const agenda = production?.agenda ?? null;

  const data = agenda ? agenda.urenverdeling : URENVERDELING;
  const totaal = agenda ? data.reduce((sum, item) => sum + item.value, 0) : demoTotaal;

  return (
    <CareonChartCard
      title="Urenverdeling"
      sub={
        agenda
          ? `${totaal.toLocaleString("nl-NL")} geregistreerde uren in ${agenda.meta.maandLabel}`
          : `${totaal.toLocaleString("nl-NL")} geplande uren`
      }
      className={className}
      titleBadge={<CareonSourceBadge page="planning" widget="Urenverdeling" />}
    >
      <div className="flex flex-col gap-4">
        <CareonDonut data={data} suffix=" uur" height={160} />
        <CareonDonutLegend data={data} />
      </div>
    </CareonChartCard>
  );
}
