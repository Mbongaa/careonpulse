"use client";

import { CareonBarList } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonRing } from "@/app/(main)/dashboard/_components/careon/careon-ring";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { BEZETTING_PER_LOCATIE, BEZETTING_TOTAAL } from "@/data/careon/careon-planning";

export function BezettingPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  const agenda = production?.agenda ?? null;

  const totaal = agenda ? (agenda.bezettingTotaal ?? 0) : BEZETTING_TOTAAL;
  const rijen = agenda
    ? agenda.bezettingPerLocatie.map((row) => ({ loc: row.loc, pct: row.pct }))
    : BEZETTING_PER_LOCATIE;

  return (
    <CareonChartCard
      title="Agenda-bezetting"
      sub={agenda ? "Sessietijd-aandeel per vestiging · 12 mnd" : "Per locatie · deze maand"}
      className={className}
      titleBadge={<CareonSourceBadge page="planning" widget="Agenda-bezetting" />}
      footer={
        agenda
          ? "Sessietijd als aandeel van sessietijd + afwezig-blokken (blokken toegerekend aan de hoofdvestiging van de behandelaar). Contracturen vergen de HR-export."
          : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex justify-center">
          <CareonRing pct={totaal} value={`${totaal}%`} label="totaal" />
        </div>
        <CareonBarList
          max={100}
          items={rijen.map((row) => ({
            label: row.loc,
            value: row.pct,
            display: `${row.pct}%`,
            tone: "accent" as const,
          }))}
        />
      </div>
    </CareonChartCard>
  );
}
