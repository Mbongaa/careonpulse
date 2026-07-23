"use client";

import { useState } from "react";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonDonut, CareonDonutLegend } from "@/app/(main)/dashboard/_components/careon/careon-donut";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { CareonTimeframeToggle } from "@/app/(main)/dashboard/_components/careon/careon-timeframe-toggle";
import { URENVERDELING } from "@/data/careon/careon-planning";
import { CAREON_TIMEFRAME_LABELS, type CareonTimeframe, sliceTimeframe } from "@/data/careon/careon-timeframe";

const demoTotaal = URENVERDELING.reduce((sum, item) => sum + item.value, 0);

export function UrenverdelingPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  // Historisch toonde dit paneel alleen de laatste volle maand — dat blijft de
  // standaard; het venster sommeert de maandreeks voor langere periodes.
  const [timeframe, setTimeframe] = useState<CareonTimeframe>("1m");
  const agenda = production?.agenda ?? null;

  let data = URENVERDELING;
  if (agenda) {
    const venster = sliceTimeframe(agenda.maandreeks, timeframe);
    const som = (kies: (punt: (typeof venster)[number]) => number) =>
      venster.reduce((sum, punt) => sum + kies(punt), 0);
    data = [
      { name: "Behandeluren", value: som((punt) => punt.directeUren), color: "var(--chart-1)" },
      { name: "Indirecte uren", value: som((punt) => punt.indirecteUren), color: "var(--chart-2)" },
      { name: "Reistijd", value: som((punt) => punt.reisUren), color: "var(--chart-3)" },
      { name: "Afwezig-blokken", value: som((punt) => punt.blokUren), color: "var(--chart-4)" },
    ].filter((item) => item.value > 0);
  }
  const totaal = data.reduce((sum, item) => sum + item.value, 0);

  const vensterLabel =
    timeframe === "1m" && agenda ? agenda.meta.maandLabel : CAREON_TIMEFRAME_LABELS[timeframe].toLowerCase();

  return (
    <CareonChartCard
      title="Urenverdeling"
      sub={
        agenda
          ? `${totaal.toLocaleString("nl-NL")} geregistreerde uren in ${vensterLabel}`
          : `${demoTotaal.toLocaleString("nl-NL")} geplande uren`
      }
      className={className}
      titleBadge={<CareonSourceBadge page="planning" widget="Urenverdeling" />}
      action={agenda ? <CareonTimeframeToggle value={timeframe} onChange={setTimeframe} /> : undefined}
    >
      <div className="flex flex-col gap-4">
        <CareonDonut data={data} suffix=" uur" height={160} />
        <CareonDonutLegend data={data} />
      </div>
    </CareonChartCard>
  );
}
