"use client";

import { useState } from "react";

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonTimeframeToggle } from "@/app/(main)/dashboard/_components/careon/careon-timeframe-toggle";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { CAREON_MONTHLY, GGZ_VERZUIM_BENCHMARK } from "@/data/careon/careon-shared-charts";
import { CAREON_TIMEFRAME_LABELS, type CareonTimeframe, sliceTimeframe } from "@/data/careon/careon-timeframe";

const chartConfig = {
  verzuim: { label: "Ziekteverzuim", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function VerzuimChart({ className }: Readonly<{ className?: string }>) {
  const [timeframe, setTimeframe] = useState<CareonTimeframe>("12m");
  const data = sliceTimeframe(CAREON_MONTHLY, timeframe);
  return (
    <CareonChartCard
      title="Ziekteverzuim"
      sub={`${CAREON_TIMEFRAME_LABELS[timeframe]} · GGZ-benchmark 6,2%`}
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
            domain={[5, 8]}
            tickFormatter={(value) => `${value}%`}
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
          <ReferenceLine
            y={GGZ_VERZUIM_BENCHMARK}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={{
              value: "benchmark 6,2%",
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
