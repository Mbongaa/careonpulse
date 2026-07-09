"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { CAREON_MONTHLY, GGZ_VERZUIM_BENCHMARK } from "@/data/careon/careon-shared-charts";

const chartConfig = {
  verzuim: { label: "Ziekteverzuim", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function VerzuimChart({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard title="Ziekteverzuim" sub="Laatste 12 maanden · GGZ-benchmark 6,2%" className={className}>
      <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
        <LineChart data={CAREON_MONTHLY} margin={{ top: 8, left: 0 }}>
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
          <Line dataKey="verzuim" type="monotone" stroke="var(--color-verzuim)" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
    </CareonChartCard>
  );
}
