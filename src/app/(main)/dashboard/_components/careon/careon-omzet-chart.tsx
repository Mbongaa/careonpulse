"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { CAREON_MONTHLY } from "@/data/careon/careon-shared-charts";

import { CareonChartCard } from "./careon-chart-card";

const omzetConfig = {
  omzetVerz: { label: "Verzekeraars", color: "var(--chart-1)" },
  omzetInfo: { label: "Infomedics", color: "var(--chart-2)" },
} satisfies ChartConfig;

// Stacked monthly revenue chart, shared by Directiecockpit and Financieel.
export function CareonOmzetChart({ className, height = "h-56" }: Readonly<{ className?: string; height?: string }>) {
  return (
    <CareonChartCard title="Omzetontwikkeling" sub="Verzekeraars + Infomedics · x € 1.000" className={className}>
      <ChartContainer config={omzetConfig} className={`aspect-auto w-full ${height}`}>
        <BarChart data={CAREON_MONTHLY} margin={{ top: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.5} />
          <XAxis dataKey="m" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} width="auto" />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <ChartLegend verticalAlign="top" content={<ChartLegendContent className="mb-4 justify-end" />} />
          <Bar dataKey="omzetVerz" stackId="omzet" fill="var(--color-omzetVerz)" radius={[0, 0, 4, 4]} />
          <Bar dataKey="omzetInfo" stackId="omzet" fill="var(--color-omzetInfo)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </CareonChartCard>
  );
}
