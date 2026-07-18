import { CareonBar } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonLiveBanner } from "@/app/(main)/dashboard/_components/careon/careon-live-banner";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { CareonRing } from "@/app/(main)/dashboard/_components/careon/careon-ring";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import {
  complianceTone,
  KWALITEIT_COMPLIANCE,
  KWALITEIT_COUNTERS,
  KWALITEIT_NOTE,
} from "@/data/careon/careon-kwaliteit";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

const nlDec1 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const dossierkwaliteit = KWALITEIT_COUNTERS.find((counter) => counter.label === "Dossierkwaliteit");

export function KwaliteitContent() {
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
            {KWALITEIT_COMPLIANCE.map((row) => (
              <div key={row.label} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span>{row.label}</span>
                  <span className="tabular-nums">
                    <b>{row.value}%</b>
                    <span className="text-muted-foreground text-xs"> · doel {row.doel}%</span>
                  </span>
                </div>
                <CareonBar pct={row.value} tone={complianceTone(row.value, row.doel)} />
              </div>
            ))}
          </div>
        </CareonChartCard>

        <CareonChartCard title="Dossierkwaliteit" sub="Nachtelijke audit-score" className="lg:col-span-4">
          <div className="flex h-full flex-col items-center justify-center gap-2 py-4">
            <CareonRing
              pct={(dossierkwaliteit?.value ?? 0) * 10}
              value={nlDec1.format(dossierkwaliteit?.value ?? 0)}
              label="van 10"
              size={140}
            />
            <p className="text-muted-foreground text-xs">vorige maand {nlDec1.format(dossierkwaliteit?.prev ?? 0)}</p>
          </div>
        </CareonChartCard>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {KWALITEIT_COUNTERS.map((counter) => (
          <CareonKpiCard
            key={counter.label}
            metric={counter}
            sourceBadge={<CareonSourceBadge page="kwaliteit" widget={counter.label} />}
          />
        ))}
      </div>
    </div>
  );
}
