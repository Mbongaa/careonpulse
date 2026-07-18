"use client";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonDonut, CareonDonutLegend } from "@/app/(main)/dashboard/_components/careon/careon-donut";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { ZORGVORM_VERDELING } from "@/data/careon/careon-patienten";

// Demo: de geauditeerde zorgvorm-taart (SGGZ/BGGZ-mix). Productie: het
// ZPM-label is voor deze instelling 100% SGGZ, dus de eerlijke verdeling is
// de ZPM-setting — regulier ambulant (S03) vs outreachend (S04).
export function ZorgvormPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();

  if (production) {
    return (
      <CareonChartCard
        title="Zorgvorm"
        sub="ZPM-setting · actieve cliënten"
        className={className}
        titleBadge={<CareonSourceBadge page="patienten" widget="Zorgvorm" />}
        footer="Alle EPD-trajecten zijn SGGZ; de setting onderscheidt ambulant en outreachend."
      >
        <div className="flex flex-col gap-4">
          <CareonDonut data={production.zorgvorm} height={160} />
          <CareonDonutLegend data={production.zorgvorm} />
        </div>
      </CareonChartCard>
    );
  }

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
