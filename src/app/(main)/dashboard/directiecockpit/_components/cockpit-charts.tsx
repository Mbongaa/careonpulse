"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { CAREON_MONTHLY } from "@/data/careon/careon-shared-charts";

const instroomConfig = {
  aanmeldingen: { label: "Aanmeldingen", color: "var(--chart-1)" },
  uitstroom: { label: "Uitstroom", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function InstroomUitstroomChart({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard title="Instroom & uitstroom" sub="Laatste 12 maanden" className={className}>
      <ChartContainer config={instroomConfig} className="aspect-auto h-72 w-full">
        <LineChart data={CAREON_MONTHLY} margin={{ top: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.5} />
          <XAxis dataKey="m" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} width="auto" />
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
          <ChartLegend verticalAlign="top" content={<ChartLegendContent className="mb-4 justify-end" />} />
          <Line dataKey="aanmeldingen" type="monotone" stroke="var(--color-aanmeldingen)" strokeWidth={2} dot={false} />
          <Line
            dataKey="uitstroom"
            type="monotone"
            stroke="var(--color-uitstroom)"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
          />
        </LineChart>
      </ChartContainer>
    </CareonChartCard>
  );
}

const noshowConfig = {
  noshow: { label: "No-show", color: "var(--destructive)" },
} satisfies ChartConfig;

export function NoShowChart({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard title="No-show" sub="Grens 5%" className={className}>
      <ChartContainer config={noshowConfig} className="aspect-auto h-56 w-full">
        <LineChart data={CAREON_MONTHLY} margin={{ top: 8, left: 0 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.5} />
          <XAxis dataKey="m" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width="auto"
            domain={[0, 6]}
            tickFormatter={(value) => `${value}%`}
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
          <ReferenceLine
            y={5}
            stroke="var(--destructive)"
            strokeDasharray="4 4"
            label={{ value: "grens 5%", position: "insideTopRight", fontSize: 11, fill: "var(--destructive)" }}
          />
          <Line dataKey="noshow" type="monotone" stroke="var(--color-noshow)" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
    </CareonChartCard>
  );
}

const caseloadConfig = {
  caseload: { label: "Caseload", color: "var(--chart-3)" },
} satisfies ChartConfig;

export function CaseloadChart({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard title="Caseload" sub="Actieve trajecten totaal" className={className}>
      <ChartContainer config={caseloadConfig} className="aspect-auto h-56 w-full">
        <LineChart data={CAREON_MONTHLY} margin={{ top: 8, left: 0 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.5} />
          <XAxis dataKey="m" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
          <YAxis tickLine={false} axisLine={false} width="auto" domain={["dataMin - 20", "dataMax + 20"]} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
          <Line dataKey="caseload" type="monotone" stroke="var(--color-caseload)" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
    </CareonChartCard>
  );
}
