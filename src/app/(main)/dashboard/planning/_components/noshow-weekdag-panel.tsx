"use client";

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { NOSHOW_PER_WEEKDAG, PLANNING_INSIGHT } from "@/data/careon/careon-planning";

const chartConfig = {
  pct: { label: "No-show", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function NoShowWeekdagPanel({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard
      title="No-show per weekdag"
      sub="Vrijdag is de risicodag"
      className={className}
      footer={PLANNING_INSIGHT}
    >
      <ChartContainer config={chartConfig} className="aspect-auto h-52 w-full">
        <BarChart data={NOSHOW_PER_WEEKDAG} margin={{ top: 8, left: 0 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.5} />
          <XAxis dataKey="dag" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width="auto"
            domain={[0, 6]}
            tickFormatter={(value) => `${value}%`}
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
            {NOSHOW_PER_WEEKDAG.map((row) => (
              <Cell key={row.dag} fill={row.dag === "vr" ? "var(--destructive)" : "var(--chart-1)"} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </CareonChartCard>
  );
}
