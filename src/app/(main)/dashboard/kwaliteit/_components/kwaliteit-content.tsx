"use client";

import { CareonBar } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonLiveBanner } from "@/app/(main)/dashboard/_components/careon/careon-live-banner";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonRing } from "@/app/(main)/dashboard/_components/careon/careon-ring";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { careonDetailHref } from "@/data/careon/careon-kpi-details";
import {
  complianceTone,
  KWALITEIT_COMPLIANCE,
  KWALITEIT_COUNTERS,
  KWALITEIT_NOTE,
} from "@/data/careon/careon-kwaliteit";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

const nlDec1 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const demoDossierkwaliteit = KWALITEIT_COUNTERS.find((counter) => counter.label === "Dossierkwaliteit");

export function KwaliteitContent() {
  const { production } = useCareon();

  // Productie: "Dossierkwaliteit" is de registratie-compleetheid uit de
  // EPD-export (zelfde score als dossiercontrole, op 10); de agenda-import
  // levert daarnaast drie kwaliteit-proxies (zorgplannen, evaluaties,
  // medicatiecontroles). ROM/PROM, suïcidaliteitsscreening en de tellers
  // wachten op de ROM/MIC-exports en blijven demo-gemarkeerd.
  const liveScore = production ? production.kwaliteitDossierscore : null;
  const ringWaarde = liveScore ? liveScore.value : (demoDossierkwaliteit?.value ?? 0);
  const counters = KWALITEIT_COUNTERS.map((counter) =>
    counter.label === "Dossierkwaliteit" && liveScore ? { ...liveScore, detailId: counter.detailId } : counter,
  );

  const agendaKwaliteit = production?.agenda?.kwaliteit ?? null;
  const liveCompliance: Record<string, { pct: number | null; met: number; totaal: number } | undefined> = {
    "Zorgplannen compleet": agendaKwaliteit?.zorgplan,
    "Evaluaties op tijd": agendaKwaliteit?.evaluaties,
    Medicatiecontroles: agendaKwaliteit?.medicatie,
  };
  const compliance = KWALITEIT_COMPLIANCE.map((row) => {
    const live = liveCompliance[row.label];
    return live && live.pct !== null ? { ...row, value: live.pct, teller: `${live.met} van ${live.totaal}` } : row;
  });

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title={CAREON_PAGE_META.kwaliteit.title} sub={CAREON_PAGE_META.kwaliteit.sub} />

      <CareonLiveBanner page="kwaliteit" />

      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-12">
        <CareonChartCard
          title="Compliance op metingen en plannen"
          sub="Huidig percentage t.o.v. het ingestelde doel"
          className="lg:col-span-8"
          footer={KWALITEIT_NOTE}
        >
          <div className="space-y-4">
            {compliance.map((row) => (
              <div key={row.label} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5">
                    {row.label}
                    <CareonSourceBadge page="kwaliteit" widget={row.label} />
                  </span>
                  <span className="tabular-nums">
                    <b>{row.value}%</b>
                    {"teller" in row && <span className="text-muted-foreground text-xs"> ({row.teller})</span>}
                    <span className="text-muted-foreground text-xs"> · doel {row.doel}%</span>
                  </span>
                </div>
                <CareonBar pct={row.value} tone={complianceTone(row.value, row.doel)} />
              </div>
            ))}
          </div>
        </CareonChartCard>

        <CareonChartCard
          title="Dossierkwaliteit"
          sub={liveScore ? "Registratie-compleetheid (EPD-export)" : "Nachtelijke audit-score"}
          className="lg:col-span-4"
          titleBadge={<CareonSourceBadge page="kwaliteit" widget="Dossierkwaliteit" />}
        >
          <div className="flex h-full flex-col items-center justify-center gap-2 py-4">
            <CareonRing pct={ringWaarde * 10} value={nlDec1.format(ringWaarde)} label="van 10" size={140} />
            <p className="text-muted-foreground text-xs">
              {liveScore
                ? "zelfde compleetheidsscore als Dossiercontrole"
                : `vorige maand ${nlDec1.format(demoDossierkwaliteit?.prev ?? 0)}`}
            </p>
          </div>
        </CareonChartCard>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {counters.map((counter) => (
          <CareonKpiCard
            key={counter.label}
            metric={counter}
            href={counter.detailId ? careonDetailHref(counter.detailId) : undefined}
            sourceBadge={<CareonSourceBadge page="kwaliteit" widget={counter.label} />}
          />
        ))}
      </div>
    </div>
  );
}
