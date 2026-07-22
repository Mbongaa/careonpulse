"use client";

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { NOSHOW_PER_WEEKDAG, PLANNING_INSIGHT } from "@/data/careon/careon-planning";

const chartConfig = {
  pct: { label: "No-show", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function NoShowWeekdagPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  const agenda = production?.agenda ?? null;

  // Agenda-data: alle 7 dagen (de praktijk draait ook weekenddiensten).
  const data = agenda ? agenda.noshowWeekdagen : NOSHOW_PER_WEEKDAG;
  const risicoDag = data.reduce((max, row) => (row.pct > max.pct ? row : max), data[0]);

  return (
    <CareonChartCard
      title="No-show per weekdag"
      sub={agenda ? `Hoogste risico op ${risicoDag.dag} · hele export` : "Vrijdag is de risicodag"}
      className={className}
      titleBadge={<CareonSourceBadge page="planning" widget="No-show per weekdag" />}
      footer={
        agenda
          ? "Percentages over alle sessies in de agenda-export; weekendzorg hoort bij het reguliere rooster van deze praktijk."
          : PLANNING_INSIGHT
      }
    >
      <ChartContainer config={chartConfig} className="aspect-auto h-52 w-full">
        <BarChart data={data} margin={{ top: 8, left: 0 }}>
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
            {data.map((row) => (
              <Cell key={row.dag} fill={row.dag === risicoDag.dag ? "var(--destructive)" : "var(--chart-1)"} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </CareonChartCard>
  );
}
