"use client";

import { useMemo } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowLeft } from "lucide-react";

import { useCareonHr } from "@/app/(main)/dashboard/_components/careon/careon-hr-provider";
import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonLiveBanner } from "@/app/(main)/dashboard/_components/careon/careon-live-banner";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { Button } from "@/components/ui/button";
import { demoDetailRows } from "@/data/careon/careon-detail-records";
import { KPI_DETAIL_BY_ID, type KpiDetailColumn } from "@/data/careon/careon-kpi-details";
import { CAREON_PAGE_META, CAREON_ROUTES } from "@/data/careon/careon-pages";
import { CAREON_MONTHS } from "@/data/careon/careon-shared-charts";
import type { CareonMetricLike } from "@/data/careon/careon-types";
import { hrMetrics, isHrKpiId } from "@/lib/careon-hr/insights";
import {
  hasProductionDetailRows,
  PRODUCTION_DETAIL_ROWS,
  productionAggDetail,
  productionDetailMetric,
  productionDetailTrend,
} from "@/lib/careon-production/detail-rows";
import { DETAIL_WAIT_NOTES } from "@/lib/careon-production/provenance";

import { KpiDetailTable } from "./kpi-detail-table";
import { KpiDetailTrend } from "./kpi-detail-trend";

const nl = new Intl.NumberFormat("nl-NL");
const HR_UPDATED_AT_FORMATTER = new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short" });

const DOSSIER_LINK_COLUMN: KpiDetailColumn = { key: "dossierUrl", header: "Dossier", format: "link", align: "right" };

export function KpiDetailContent({ kpiId }: Readonly<{ kpiId: string }>) {
  const entry = KPI_DETAIL_BY_ID.get(kpiId);
  const router = useRouter();
  const { filters, kpis, factor, production } = useCareon();
  const { state: hrState } = useCareonHr();
  const isHrDetail = entry?.page === "hr" && isHrKpiId(kpiId);
  const hrMetric = useMemo(
    () => (isHrDetail ? hrMetrics(hrState).find((metric) => metric.detailId === kpiId) : undefined),
    [hrState, isHrDetail, kpiId],
  );

  // Agenda-/declaratie-gedreven kaarten hebben (bewust) geen losse records:
  // hun detailtabel toont de eerlijke aggregaten per maand of per debiteur.
  const aggDetail = production && entry ? productionAggDetail(production, entry.id) : null;
  const liveRows = production && entry && (hasProductionDetailRows(entry.id, production) || aggDetail !== null);

  // Records: in productie de echte (al op vestiging gefilterde) ClientRecords,
  // anders de deterministische demo-set met client-side locatiefilter.
  const rows = useMemo(() => {
    if (!entry) {
      return [];
    }
    if (isHrDetail && hrMetric) {
      return [
        {
          key: "Handmatige HR-registratie",
          value: hrMetric.value,
          prev: hrMetric.prev,
          updatedAt: HR_UPDATED_AT_FORMATTER.format(new Date(hrState.updatedAt)),
        },
      ];
    }
    if (aggDetail) {
      return aggDetail.rows;
    }
    if (production && hasProductionDetailRows(entry.id, production)) {
      return PRODUCTION_DETAIL_ROWS[entry.id](production);
    }
    const demo = demoDetailRows(entry.id);
    if (production || filters.locatie === "Alle locaties") {
      return demo;
    }
    return demo.filter((row) => !row.loc || row.loc === filters.locatie);
  }, [entry, production, filters.locatie, aggDetail, isHrDetail, hrMetric, hrState.updatedAt]);

  if (!entry) {
    return null;
  }

  // Kop volgt de aangeklikte kaart: productie → live metric; demo → cockpit-KPI
  // (inclusief locatieschaal en CSV-overrides) of de geauditeerde constante.
  const liveMetric = !isHrDetail && production ? productionDetailMetric(production, entry.id) : null;
  const cockpitKpi = kpis.find((k) => k.id === entry.id);
  let metric: CareonMetricLike;
  if (hrMetric) {
    metric = hrMetric;
  } else if (liveMetric) {
    metric = { ...liveMetric, label: entry.title };
  } else {
    metric = {
      label: entry.title,
      value: cockpitKpi && !production ? cockpitKpi.value : entry.value,
      prev: cockpitKpi && !production ? cockpitKpi.prev : entry.prev,
      f: entry.f,
      betterLow: entry.betterLow,
      neutralDown: entry.neutralDown,
    };
  }

  // Trend: productie alleen wanneer de export een echte reeks kent; demo
  // schaalt de geauditeerde reeks mee met het locatiefilter.
  const liveTrend = !isHrDetail && production ? productionDetailTrend(production, entry.id) : null;
  const demoTrend =
    entry.scale && factor !== 1 ? entry.trend.map((point) => Math.round(point * factor * 10) / 10) : entry.trend;
  let hrTrend: number[] | null = null;
  let trendMonths = liveTrend?.labels;
  if (isHrDetail && hrMetric) {
    hrTrend = kpiId === "verzuim" ? hrState.verzuimTrend : [hrMetric.prev, hrMetric.value];
    trendMonths = kpiId === "verzuim" ? CAREON_MONTHS : ["Vorige maand", "Huidig"];
  }
  const trend = hrTrend ?? (liveTrend ? liveTrend.values : demoTrend);
  const trendEntry =
    hrTrend && kpiId !== "verzuim" ? { ...entry, trendLabel: "Vorige maand en huidige waarde" } : entry;
  const showTrend = isHrDetail || !production || liveTrend !== null;

  // Productie-rijen dragen EPD-deeplinks — dan verschijnt de dossierkolom.
  // Geaggregeerde drilldowns brengen hun eigen kolommen mee.
  let columns = entry.columns;
  if (isHrDetail) {
    columns = [
      { key: "key", header: "Bron" },
      { key: "value", header: "Huidige waarde", format: entry.f as KpiDetailColumn["format"], align: "right" },
      { key: "prev", header: "Vorige maand", format: entry.f as KpiDetailColumn["format"], align: "right" },
      { key: "updatedAt", header: "Laatst bijgewerkt", align: "right" },
    ];
  } else if (aggDetail) {
    columns = aggDetail.columns;
  } else if (
    liveRows &&
    rows.some((row) => typeof row.dossierUrl === "string" && row.dossierUrl.startsWith("https://"))
  ) {
    columns = [...entry.columns, DOSSIER_LINK_COLUMN];
  }

  const teamNote =
    !production && filters.team !== "Alle teams" ? " · teamfilter niet van toepassing op deze detailweergave" : "";
  let caption = `${nl.format(rows.length)} records · ${filters.locatie}${teamNote}`;
  if (isHrDetail) {
    caption = "1 handmatige HR-registratie · dezelfde waarde als op de HR-pagina";
  } else if (aggDetail) {
    caption = `${nl.format(rows.length)} ${aggDetail.eenheid} · geaggregeerd (losse afspraakregels worden uit privacy-oogpunt niet bewaard)`;
  }
  let waitNote: string | undefined;
  if (isHrDetail) {
    waitNote = "De handmatige registratie bevat totaalwaarden; team- en persoonsregels worden niet afgeleid.";
  } else if (production && !liveRows) {
    waitNote = DETAIL_WAIT_NOTES[entry.page];
  }

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader
        title={entry.title}
        sub={
          isHrDetail
            ? "Handmatig bijgehouden HR-waarde; wijzigingen op de HR-pagina werken hier direct door."
            : entry.sub
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                // Terug naar de pagina waarvandaan de kaart is aangeklikt;
                // bij een directe link (geen historie) naar de eigenaarspagina.
                if (window.history.length > 1) {
                  router.back();
                } else {
                  router.push(CAREON_ROUTES[entry.page]);
                }
              }}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Terug
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link prefetch={false} href={CAREON_ROUTES[entry.page]}>
                Open {CAREON_PAGE_META[entry.page].title}
              </Link>
            </Button>
          </div>
        }
      />
      <CareonLiveBanner page={entry.page} />
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-12">
        <CareonKpiCard
          metric={metric}
          className={showTrend ? "lg:col-span-4" : "lg:col-span-12"}
          sourceBadge={<CareonSourceBadge page={entry.provenance.page} widget={entry.provenance.widget} />}
        />
        {showTrend && (
          <KpiDetailTrend entry={trendEntry} trend={trend} months={trendMonths} className="lg:col-span-8" />
        )}
      </div>
      <KpiDetailTable rows={rows} columns={columns} caption={caption} note={waitNote} />
    </div>
  );
}
