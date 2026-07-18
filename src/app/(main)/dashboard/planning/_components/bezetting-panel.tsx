import { CareonBarList } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonRing } from "@/app/(main)/dashboard/_components/careon/careon-ring";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { BEZETTING_PER_LOCATIE, BEZETTING_TOTAAL } from "@/data/careon/careon-planning";

export function BezettingPanel({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard
      title="Agenda-bezetting"
      sub="Per locatie · deze maand"
      className={className}
      titleBadge={<CareonSourceBadge page="planning" widget="Agenda-bezetting" />}
    >
      <div className="flex flex-col gap-5">
        <div className="flex justify-center">
          <CareonRing pct={BEZETTING_TOTAAL} value={`${BEZETTING_TOTAAL}%`} label="totaal" />
        </div>
        <CareonBarList
          max={100}
          items={BEZETTING_PER_LOCATIE.map((row) => ({
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
