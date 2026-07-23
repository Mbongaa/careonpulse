"use client";

import { useState } from "react";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonTimeframeToggle } from "@/app/(main)/dashboard/_components/careon/careon-timeframe-toggle";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { KpiDetailDef } from "@/data/careon/careon-kpi-details";
import { CAREON_MONTHS } from "@/data/careon/careon-shared-charts";
import { type CareonTimeframe, sliceTimeframe } from "@/data/careon/careon-timeframe";

const trendConfig = {
  waarde: { label: "Waarde", color: "var(--chart-1)" },
} satisfies ChartConfig;

// As-labels per KPI-formaat; eurK-reeksen staan (net als de cockpit-sparks)
// in duizenden en krijgen het K-suffix.
function tickFormatter(entry: KpiDetailDef): (value: number) => string {
  switch (entry.f) {
    case "pct":
    case "pct0":
      return (value) => `${value}%`;
    case "eurK":
      return (value) => `€ ${value}K`;
    case "eur":
      return (value) => `€ ${value}`;
    default:
      return (value) => `${value}`;
  }
}

export function KpiDetailTrend({
  entry,
  trend,
  months,
  className,
}: Readonly<{ entry: KpiDetailDef; trend?: number[]; months?: string[]; className?: string }>) {
  const [timeframe, setTimeframe] = useState<CareonTimeframe>("12m");
  const labels = months ?? CAREON_MONTHS;
  // Waarden en maandlabels samen snijden zodat het venster synchroon blijft.
  const data = sliceTimeframe(
    (trend ?? entry.trend).map((waarde, i) => ({ m: labels[i], waarde })),
    timeframe,
  );
  return (
    <CareonChartCard
      title="Trend"
      sub={entry.trendLabel}
      className={className}
      action={<CareonTimeframeToggle value={timeframe} onChange={setTimeframe} />}
    >
      <ChartContainer config={trendConfig} className="aspect-auto h-56 w-full">
        <LineChart data={data} margin={{ top: 8, left: 0 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.5} />
          <XAxis dataKey="m" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width="auto"
            domain={["auto", "auto"]}
            tickFormatter={tickFormatter(entry)}
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
          <Line dataKey="waarde" type="monotone" stroke="var(--color-waarde)" strokeWidth={2} dot={data.length < 3} />
        </LineChart>
      </ChartContainer>
    </CareonChartCard>
  );
}
