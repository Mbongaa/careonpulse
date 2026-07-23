"use client";

import { useState } from "react";

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { CareonTimeframeToggle } from "@/app/(main)/dashboard/_components/careon/careon-timeframe-toggle";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { CAREON_MONTHLY } from "@/data/careon/careon-shared-charts";
import { CAREON_TIMEFRAME_LABELS, type CareonTimeframe, sliceTimeframe } from "@/data/careon/careon-timeframe";

const instroomConfig = {
  aanmeldingen: { label: "Aanmeldingen", color: "var(--chart-1)" },
  uitstroom: { label: "Uitstroom", color: "var(--chart-2)" },
} satisfies ChartConfig;

// Productie toont ook de vraagkant (binnengekomen verwijzingen) — demo kent
// die reeks niet en houdt de geauditeerde twee lijnen.
const instroomProductieConfig = {
  ...instroomConfig,
  verwijzingen: { label: "Verwijzingen", color: "var(--chart-4)" },
} satisfies ChartConfig;

// Gemeenschappelijke vorm van demo- en productiemaandpunten voor de charts.
interface MaandPunt {
  m: string;
  aanmeldingen: number;
  uitstroom: number;
  caseload: number;
  verwijzingen?: number;
}

export function InstroomUitstroomChart({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  const [timeframe, setTimeframe] = useState<CareonTimeframe>("12m");
  const data = sliceTimeframe<MaandPunt>(production ? production.monthly : CAREON_MONTHLY, timeframe);
  return (
    <CareonChartCard
      title="Instroom & uitstroom"
      sub={
        production
          ? `${CAREON_TIMEFRAME_LABELS[timeframe]} · incl. binnengekomen verwijzingen`
          : CAREON_TIMEFRAME_LABELS[timeframe]
      }
      className={className}
      titleBadge={<CareonSourceBadge page="cockpit" widget="Instroom & uitstroom" />}
      action={<CareonTimeframeToggle value={timeframe} onChange={setTimeframe} />}
      footer={
        production
          ? "Verwijzingen = vraagkant (verwijsdatum); recente maanden kunnen onvolledig zijn door invoervertraging in het EPD."
          : undefined
      }
    >
      <ChartContainer
        config={production ? instroomProductieConfig : instroomConfig}
        className="aspect-auto h-72 w-full"
      >
        <LineChart data={data} margin={{ top: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.5} />
          <XAxis dataKey="m" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} width="auto" />
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
          <ChartLegend verticalAlign="top" content={<ChartLegendContent className="mb-4 justify-end" />} />
          <Line
            dataKey="aanmeldingen"
            type="monotone"
            stroke="var(--color-aanmeldingen)"
            strokeWidth={2}
            dot={data.length < 3}
          />
          <Line
            dataKey="uitstroom"
            type="monotone"
            stroke="var(--color-uitstroom)"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={data.length < 3}
          />
          {production && (
            <Line
              dataKey="verwijzingen"
              type="monotone"
              stroke="var(--color-verwijzingen)"
              strokeWidth={2}
              strokeDasharray="2 3"
              dot={data.length < 3}
            />
          )}
        </LineChart>
      </ChartContainer>
    </CareonChartCard>
  );
}

const noshowConfig = {
  noshow: { label: "No-show", color: "var(--destructive)" },
} satisfies ChartConfig;

export function NoShowChart({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  const [timeframe, setTimeframe] = useState<CareonTimeframe>("12m");
  const agendaActief = production?.agenda != null;
  // In productie mét agenda: echte no-show-percentages per afspraakmaand.
  const data = sliceTimeframe(
    agendaActief ? production.monthly.map((point) => ({ m: point.m, noshow: point.noshowPct })) : CAREON_MONTHLY,
    timeframe,
  );
  return (
    <CareonChartCard
      title="No-show"
      sub={agendaActief ? "Per afspraakmaand · grens 5%" : "Grens 5%"}
      className={className}
      titleBadge={<CareonSourceBadge page="cockpit" widget="No-show trend" />}
      action={<CareonTimeframeToggle value={timeframe} onChange={setTimeframe} />}
    >
      <ChartContainer config={noshowConfig} className="aspect-auto h-56 w-full">
        <LineChart data={data} margin={{ top: 8, left: 0 }}>
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
          <Line dataKey="noshow" type="monotone" stroke="var(--color-noshow)" strokeWidth={2} dot={data.length < 3} />
        </LineChart>
      </ChartContainer>
    </CareonChartCard>
  );
}

const caseloadConfig = {
  caseload: { label: "Caseload", color: "var(--chart-3)" },
} satisfies ChartConfig;

export function CaseloadChart({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  const [timeframe, setTimeframe] = useState<CareonTimeframe>("12m");
  const data = sliceTimeframe<MaandPunt>(production ? production.monthly : CAREON_MONTHLY, timeframe);
  return (
    <CareonChartCard
      title="Caseload"
      sub="Actieve trajecten totaal"
      className={className}
      titleBadge={<CareonSourceBadge page="cockpit" widget="Caseload" />}
      action={<CareonTimeframeToggle value={timeframe} onChange={setTimeframe} />}
    >
      <ChartContainer config={caseloadConfig} className="aspect-auto h-56 w-full">
        <LineChart data={data} margin={{ top: 8, left: 0 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.5} />
          <XAxis dataKey="m" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
          <YAxis tickLine={false} axisLine={false} width="auto" domain={["dataMin - 20", "dataMax + 20"]} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
          <Line
            dataKey="caseload"
            type="monotone"
            stroke="var(--color-caseload)"
            strokeWidth={2}
            dot={data.length < 3}
          />
        </LineChart>
      </ChartContainer>
    </CareonChartCard>
  );
}
