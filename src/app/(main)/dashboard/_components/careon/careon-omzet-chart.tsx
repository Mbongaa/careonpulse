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
import { useCareon } from "./careon-provider";
import { CareonSourceBadge } from "./careon-source-badge";

const omzetConfig = {
  omzetVerz: { label: "Verzekeraars", color: "var(--chart-1)" },
  omzetInfo: { label: "Infomedics", color: "var(--chart-2)" },
} satisfies ChartConfig;

const omzetAgendaConfig = {
  omzetVerz: { label: "Gefactureerd", color: "var(--chart-1)" },
} satisfies ChartConfig;

// Stacked monthly revenue chart, shared by Directiecockpit and Financieel.
// In productie mét agenda-import: gefactureerde omzet per factuurmaand uit de
// agenda-export (één reeks; Infomedics vereist de declaratie-export).
export function CareonOmzetChart({
  className,
  height = "h-56",
  provenancePage = "financieel",
}: Readonly<{ className?: string; height?: string; provenancePage?: string }>) {
  const { production } = useCareon();
  const agendaActief = production?.agenda != null;
  const data = agendaActief
    ? production.monthly.map((point) => ({
        m: point.m,
        omzetVerz: point.omzet === null ? null : Math.round(point.omzet / 1000),
      }))
    : CAREON_MONTHLY;

  return (
    <CareonChartCard
      title="Omzetontwikkeling"
      sub={agendaActief ? "Gefactureerd per factuurmaand · x € 1.000" : "Verzekeraars + Infomedics · x € 1.000"}
      className={className}
      titleBadge={<CareonSourceBadge page={provenancePage} widget="Omzetontwikkeling" />}
      footer={
        agendaActief
          ? "Facturatie loopt in batches: maanden met € 0 zijn maanden zonder factuurronde, niet zonder productie."
          : undefined
      }
    >
      <ChartContainer
        config={agendaActief ? omzetAgendaConfig : omzetConfig}
        className={`aspect-auto w-full ${height}`}
      >
        <BarChart data={data} margin={{ top: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.5} />
          <XAxis dataKey="m" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} width="auto" />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <ChartLegend verticalAlign="top" content={<ChartLegendContent className="mb-4 justify-end" />} />
          <Bar dataKey="omzetVerz" stackId="omzet" fill="var(--color-omzetVerz)" radius={[0, 0, 4, 4]} />
          {!agendaActief && (
            <Bar dataKey="omzetInfo" stackId="omzet" fill="var(--color-omzetInfo)" radius={[4, 4, 0, 0]} />
          )}
        </BarChart>
      </ChartContainer>
    </CareonChartCard>
  );
}
