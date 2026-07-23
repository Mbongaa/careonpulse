"use client";

import { useState } from "react";

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
import { type CareonTimeframe, sliceTimeframe } from "@/data/careon/careon-timeframe";

import { CareonChartCard } from "./careon-chart-card";
import { useCareon } from "./careon-provider";
import { CareonSourceBadge } from "./careon-source-badge";
import { CareonTimeframeToggle } from "./careon-timeframe-toggle";

const omzetConfig = {
  omzetVerz: { label: "Verzekeraars", color: "var(--chart-1)" },
  omzetInfo: { label: "Infomedics", color: "var(--chart-2)" },
} satisfies ChartConfig;

const omzetAgendaConfig = {
  omzetVecozo: { label: "Vecozo (VGZ + DSW)", color: "var(--chart-1)" },
  omzetSb: { label: "Servicebureau", color: "var(--chart-2)" },
  omzetRmo: { label: "RMO/RMA", color: "var(--chart-3)" },
} satisfies ChartConfig;

const nl = new Intl.NumberFormat("nl-NL");

// Gedeelde reeksvorm voor demo (omzetVerz/omzetInfo) en productie
// (omzetVecozo/omzetSb/omzetRmo) — de actieve balken kiezen hun eigen keys.
interface OmzetReeksPunt {
  m: string;
  omzetVerz?: number | null;
  omzetInfo?: number | null;
  omzetVecozo?: number | null;
  omzetSb?: number | null;
  omzetRmo?: number | null;
}

// Stacked monthly revenue chart, shared by Directiecockpit and Financieel.
// In productie mét agenda-import: gefactureerde omzet per BEHANDELMAAND,
// excl. toeslagen, in de driedeling van het klantoverzicht — Vecozo
// (VGZ + DSW direct), servicebureau (Infomedics) en RMO/RMA (Uzovi 3355).
export function CareonOmzetChart({
  className,
  height = "h-56",
  provenancePage = "financieel",
}: Readonly<{ className?: string; height?: string; provenancePage?: string }>) {
  const { production } = useCareon();
  const [timeframe, setTimeframe] = useState<CareonTimeframe>("12m");
  const agendaActief = production?.agenda != null;
  const data: OmzetReeksPunt[] = production?.agenda
    ? sliceTimeframe(
        production.monthly.map((point) => ({
          m: point.m,
          omzetVecozo: point.omzetVecozo === null ? null : Math.round(point.omzetVecozo / 1000),
          omzetSb: point.omzetServicebureau === null ? null : Math.round(point.omzetServicebureau / 1000),
          omzetRmo: point.omzetRmoRma === null ? null : Math.round(point.omzetRmoRma / 1000),
        })),
        timeframe,
      )
    : sliceTimeframe(CAREON_MONTHLY, timeframe);

  // Behandelmaand-bucketing telt alleen gefactureerde sessies: de jongste
  // maand loopt nog op totdat de facturatierun (begin volgende maand) is
  // geweest. Toon wat er nog aankomt zodat een "lage" maand niet misleidt.
  const laatsteMaand = production?.agenda ? production.agenda.maandreeks.at(-1) : undefined;
  const onderhandenNoot =
    laatsteMaand && laatsteMaand.onderhanden > 0
      ? ` € ${nl.format(Math.round(laatsteMaand.onderhanden))} aan sessiewaarde van ${laatsteMaand.label} wacht nog op de facturatierun.`
      : "";

  return (
    <CareonChartCard
      title="Omzetontwikkeling"
      sub={agendaActief ? "Per behandelmaand · excl. toeslagen · x € 1.000" : "Verzekeraars + Infomedics · x € 1.000"}
      className={className}
      titleBadge={<CareonSourceBadge page={provenancePage} widget="Omzetontwikkeling" />}
      action={<CareonTimeframeToggle value={timeframe} onChange={setTimeframe} />}
      footer={
        agendaActief
          ? `Gefactureerde sessiewaarde per behandelmaand, verdeeld zoals het facturatie-overzicht: Vecozo, servicebureau (Infomedics) en RMO/RMA.${onderhandenNoot}`
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
          {agendaActief ? (
            <>
              <Bar dataKey="omzetVecozo" stackId="omzet" fill="var(--color-omzetVecozo)" radius={[0, 0, 4, 4]} />
              <Bar dataKey="omzetSb" stackId="omzet" fill="var(--color-omzetSb)" />
              <Bar dataKey="omzetRmo" stackId="omzet" fill="var(--color-omzetRmo)" radius={[4, 4, 0, 0]} />
            </>
          ) : (
            <>
              <Bar dataKey="omzetVerz" stackId="omzet" fill="var(--color-omzetVerz)" radius={[0, 0, 4, 4]} />
              <Bar dataKey="omzetInfo" stackId="omzet" fill="var(--color-omzetInfo)" radius={[4, 4, 0, 0]} />
            </>
          )}
        </BarChart>
      </ChartContainer>
    </CareonChartCard>
  );
}
