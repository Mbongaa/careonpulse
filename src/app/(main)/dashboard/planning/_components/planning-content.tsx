"use client";

import { CareonBarList } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonLiveBanner } from "@/app/(main)/dashboard/_components/careon/careon-live-banner";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { careonDetailHref } from "@/data/careon/careon-kpi-details";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";
import { PLANNING_METRICS } from "@/data/careon/careon-planning";

import { BezettingPanel } from "./bezetting-panel";
import { NoShowWeekdagPanel } from "./noshow-weekdag-panel";
import { UrenverdelingPanel } from "./urenverdeling-panel";

const nl = new Intl.NumberFormat("nl-NL");

export function PlanningContent() {
  const { production } = useCareon();
  const agenda = production?.agenda ?? null;

  // Vervangings-patroon: agenda-metrics zijn gesleuteld op de demo-labels.
  // Agenda-gedreven kaarten linken niet naar de KPI-drilldown — de import
  // bewaart alleen aggregaten, dus er zijn geen echte afspraakregels om te tonen.
  const metrics = PLANNING_METRICS.map((metric) => {
    if (production && metric.label === "Gem. wachttijd (wkn)") {
      return { metric: { ...production.gemWachttijdWkn }, detailId: metric.detailId };
    }
    const live = agenda?.planningMetrics[metric.label];
    if (live) {
      return { metric: live, detailId: undefined, demoLabel: metric.label };
    }
    return { metric, detailId: metric.detailId };
  });

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title={CAREON_PAGE_META.planning.title} sub={CAREON_PAGE_META.planning.sub} />
      <CareonLiveBanner page="planning" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {metrics.map((item, index) => (
          <CareonKpiCard
            key={PLANNING_METRICS[index].label}
            metric={item.metric}
            href={item.detailId ? careonDetailHref(item.detailId) : undefined}
            sourceBadge={<CareonSourceBadge page="planning" widget={PLANNING_METRICS[index].label} />}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
        <BezettingPanel />
        <UrenverdelingPanel />
        <NoShowWeekdagPanel />
      </div>

      {/* Productie-exclusief (agenda-import mét toekomstvenster): vooruitblik. */}
      {agenda?.vooruitblik && (
        <CareonChartCard
          title="Vooruitblik — geplande afspraken"
          sub={`${nl.format(agenda.vooruitblik.sessies)} geplande sessies · ${nl.format(agenda.vooruitblik.clienten)} cliënten met vervolgafspraak${agenda.vooruitblik.tot ? ` · t/m ${new Date(`${agenda.vooruitblik.tot}T00:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}` : ""}`}
          titleBadge={<CareonSourceBadge page="planning" widget="Vooruitblik" />}
          footer={`${nl.format(agenda.vooruitblik.zonderVervolg)} actieve cliënten hebben géén geplande vervolgafspraak — zie Signaleringen en de KPI-drilldown "Zonder vervolgafspraak".`}
        >
          <CareonBarList
            items={agenda.vooruitblik.maanden.map((maand) => ({
              label: `${maand.label} '${maand.key.slice(2, 4)}`,
              value: maand.sessies,
              display: `${nl.format(maand.sessies)} · ${nl.format(maand.uren)} u`,
            }))}
          />
        </CareonChartCard>
      )}

      {/* Productie-exclusief (agenda-import): sessievormen en afzegredenen. */}
      {agenda && (
        <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
          <CareonChartCard
            title="Online vs. op locatie"
            sub="Sessies · laatste 12 maanden"
            titleBadge={<CareonSourceBadge page="planning" widget="No-show per weekdag" />}
          >
            <CareonBarList
              items={agenda.modality.map((row) => ({
                label: row.name,
                value: row.value,
                display: nl.format(row.value),
              }))}
            />
          </CareonChartCard>
          <CareonChartCard
            title="Afzegredenen"
            sub="Tijdig afgezegde afspraken · hele export"
            titleBadge={<CareonSourceBadge page="planning" widget="Geannuleerd" />}
          >
            {agenda.afzegRedenen.length > 0 ? (
              <CareonBarList
                items={agenda.afzegRedenen.map((row) => ({
                  label: row.label,
                  value: row.aantal,
                  display: nl.format(row.aantal),
                }))}
              />
            ) : (
              <p className="text-muted-foreground text-sm">Geen afzegredenen geregistreerd in de export.</p>
            )}
          </CareonChartCard>
          <CareonChartCard
            title="Meest voorkomende sessietypen"
            sub="Hele export"
            titleBadge={<CareonSourceBadge page="planning" widget="Afspraken deze maand" />}
          >
            <CareonBarList
              items={agenda.sessieTypen.slice(0, 8).map((row) => ({
                label: row.label,
                value: row.aantal,
                display: nl.format(row.aantal),
              }))}
            />
          </CareonChartCard>
        </div>
      )}
    </div>
  );
}
