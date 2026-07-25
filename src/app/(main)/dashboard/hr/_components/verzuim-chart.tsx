"use client";

import { useState } from "react";

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonTimeframeToggle } from "@/app/(main)/dashboard/_components/careon/careon-timeframe-toggle";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { CAREON_MONTHS } from "@/data/careon/careon-shared-charts";
import { CAREON_TIMEFRAME_LABELS, type CareonTimeframe, sliceTimeframe } from "@/data/careon/careon-timeframe";

const chartConfig = {
  verzuim: { label: "Ziekteverzuim", color: "var(--chart-1)" },
} satisfies ChartConfig;

const nl1 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Verzuimtrend uit de handmatige HR-registratie (props), niet uit de gedeelde
// CAREON_MONTHLY-reeks. De y-as en de benchmark-referentielijn volgen de
// werkelijk ingevoerde waarden zodat handmatige aanpassingen zichtbaar blijven.
export function VerzuimChart({
  trend,
  benchmark,
  className,
}: Readonly<{ trend: number[]; benchmark: number; className?: string }>) {
  const [timeframe, setTimeframe] = useState<CareonTimeframe>("12m");
  const series = CAREON_MONTHS.map((m, i) => ({ m, verzuim: trend[i] ?? 0 }));
  const data = sliceTimeframe(series, timeframe);

  const waarden = [...data.map((point) => point.verzuim), benchmark];
  const laag = Math.max(0, Math.floor(Math.min(...waarden) - 0.5));
  const hoog = Math.ceil(Math.max(...waarden) + 0.5);

  return (
    <CareonChartCard
      title="Ziekteverzuim"
      sub={`${CAREON_TIMEFRAME_LABELS[timeframe]} · GGZ-benchmark ${nl1.format(benchmark)}%`}
      className={className}
      action={<CareonTimeframeToggle value={timeframe} onChange={setTimeframe} />}
    >
      <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
        <LineChart data={data} margin={{ top: 8, left: 0 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.5} />
          <XAxis dataKey="m" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width="auto"
            domain={[laag, hoog]}
            tickFormatter={(value) => `${value}%`}
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
          <ReferenceLine
            y={benchmark}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={{
              value: `benchmark ${nl1.format(benchmark)}%`,
              position: "insideBottomRight",
              fontSize: 11,
              fill: "var(--muted-foreground)",
            }}
          />
          <Line dataKey="verzuim" type="monotone" stroke="var(--color-verzuim)" strokeWidth={2} dot={data.length < 3} />
        </LineChart>
      </ChartContainer>
    </CareonChartCard>
  );
}
