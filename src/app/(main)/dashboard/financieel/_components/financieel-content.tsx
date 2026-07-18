import { CareonBarList } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonLiveBanner } from "@/app/(main)/dashboard/_components/careon/careon-live-banner";
import { CareonOmzetChart } from "@/app/(main)/dashboard/_components/careon/careon-omzet-chart";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import {
  DECLARATIE_OUDERDOM,
  FINANCIEEL_METRICS,
  FINANCIEEL_NOTE,
  OMZET_PER_LOCATIE,
  OMZET_PER_VERZEKERAAR,
  OPENSTAAND_TOTAAL,
} from "@/data/careon/careon-financieel";
import { careonDetailHref } from "@/data/careon/careon-kpi-details";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

const nl = new Intl.NumberFormat("nl-NL");

export function FinancieelContent() {
  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title={CAREON_PAGE_META.financieel.title} sub={CAREON_PAGE_META.financieel.sub} />

      <CareonLiveBanner page="financieel" />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {FINANCIEEL_METRICS.map((metric) => (
          <CareonKpiCard
            key={metric.label}
            metric={metric}
            href={metric.detailId ? careonDetailHref(metric.detailId) : undefined}
            sourceBadge={<CareonSourceBadge page="financieel" widget={metric.label} />}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-12">
        <CareonOmzetChart className="lg:col-span-7" height="h-64" />
        <CareonChartCard title="Omzet per verzekeraar" sub="Deze maand · x € 1.000" className="lg:col-span-5">
          <CareonBarList
            items={OMZET_PER_VERZEKERAAR.map((row) => ({
              label: row.name,
              value: row.value,
              display: `€ ${row.value}K`,
            }))}
          />
        </CareonChartCard>

        <CareonChartCard title="Omzet per locatie" sub="Deze maand · x € 1.000" className="lg:col-span-5">
          <CareonBarList
            items={OMZET_PER_LOCATIE.map((row) => ({
              label: row.loc,
              value: row.omzet,
              display: `€ ${row.omzet}K`,
              tone: "accent" as const,
            }))}
          />
        </CareonChartCard>

        <CareonChartCard
          title="Ouderdom openstaande declaraties"
          sub={`€ ${nl.format(OPENSTAAND_TOTAAL)} totaal openstaand`}
          className="lg:col-span-7"
          footer={FINANCIEEL_NOTE}
        >
          <CareonBarList
            max={100}
            items={DECLARATIE_OUDERDOM.map((row, index) => ({
              label: row.label,
              value: row.pct,
              display: `${row.pct}%`,
              tone: index === DECLARATIE_OUDERDOM.length - 1 ? ("bad" as const) : ("default" as const),
            }))}
          />
        </CareonChartCard>
      </div>
    </div>
  );
}
