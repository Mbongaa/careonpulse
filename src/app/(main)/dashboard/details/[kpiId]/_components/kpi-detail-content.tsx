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
import { demoDetailRows, type KpiDetailRow } from "@/data/careon/careon-detail-records";
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
import { isTgcDossierUrl } from "@/lib/careon-production/tgc-dossier-url";

import { demoKpiTrend, demoKpiWaarde } from "../../_lib/kpi-demo-waarde";
import { KpiDetailTable } from "./kpi-detail-table";
import { KpiDetailTrend } from "./kpi-detail-trend";

const nl = new Intl.NumberFormat("nl-NL");
const HR_UPDATED_AT_FORMATTER = new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short" });

const DOSSIER_LINK_COLUMN: KpiDetailColumn = { key: "dossierUrl", header: "Dossier", format: "link", align: "right" };

export function KpiDetailContent({ kpiId }: Readonly<{ kpiId: string }>) {
  const entry = KPI_DETAIL_BY_ID.get(kpiId);
  const router = useRouter();
  const { filters, overrides, factor, production } = useCareon();
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
  // `locatieOpRijen` legt vast of het locatiefilter daadwerkelijk op deze rijen
  // is toegepast — het bijschrift mag anders geen locatie claimen.
  const { rows, locatieOpRijen } = useMemo<{ rows: KpiDetailRow[]; locatieOpRijen: boolean }>(() => {
    if (!entry) {
      return { rows: [], locatieOpRijen: false };
    }
    if (isHrDetail && hrMetric) {
      return {
        rows: [
          {
            key: "Handmatige HR-registratie",
            value: hrMetric.value,
            prev: hrMetric.prev,
            updatedAt: HR_UPDATED_AT_FORMATTER.format(new Date(hrState.updatedAt)),
          },
        ],
        locatieOpRijen: false,
      };
    }
    if (aggDetail) {
      return { rows: aggDetail.rows, locatieOpRijen: true };
    }
    if (production && hasProductionDetailRows(entry.id, production)) {
      return { rows: PRODUCTION_DETAIL_ROWS[entry.id](production), locatieOpRijen: true };
    }
    const demo = demoDetailRows(entry.id);
    // Terugval op de demo-set in productie: bewust ongefilterd, want de
    // demo-records kennen de vestigingen van deze klant niet.
    if (production) {
      return { rows: demo, locatieOpRijen: false };
    }
    const heeftLocatie = demo.some((row) => Boolean(row.loc));
    if (filters.locatie === "Alle locaties") {
      return { rows: demo, locatieOpRijen: heeftLocatie };
    }
    return { rows: demo.filter((row) => !row.loc || row.loc === filters.locatie), locatieOpRijen: heeftLocatie };
  }, [entry, production, filters.locatie, aggDetail, isHrDetail, hrMetric, hrState.updatedAt]);

  if (!entry) {
    return null;
  }

  // Kop volgt de aangeklikte kaart: productie → live metric; demo → dezelfde
  // rekenregel als élke KPI-kaart (CSV-override, daarna de locatieschaal voor
  // schaalbare KPI's). Cockpit, eigenaarspagina en drilldown lopen zo alle drie
  // door demoKpiWaarde en tonen per definitie hetzelfde getal.
  const liveMetric = !isHrDetail && production ? productionDetailMetric(production, entry.id) : null;
  let metric: CareonMetricLike;
  if (hrMetric) {
    metric = hrMetric;
  } else if (liveMetric) {
    metric = { ...liveMetric, label: entry.title };
  } else {
    const basis = demoKpiWaarde(entry.id, { value: entry.value, prev: entry.prev }, overrides, factor);
    metric = {
      label: entry.title,
      value: basis.value,
      prev: basis.prev,
      f: entry.f,
      betterLow: entry.betterLow,
      neutralDown: entry.neutralDown,
    };
  }

  // Trend: productie alleen wanneer de export een echte reeks kent; demo volgt
  // de kopwaarde, dus dezelfde schaalvlag — anders eindigt de grafiek op een
  // ander getal dan de kaart erboven.
  const liveTrend = !isHrDetail && production ? productionDetailTrend(production, entry.id) : null;
  let hrTrend: number[] | null = null;
  let trendMonths = liveTrend?.labels;
  if (isHrDetail && hrMetric) {
    hrTrend = kpiId === "verzuim" ? hrState.verzuimTrend : [hrMetric.prev, hrMetric.value];
    trendMonths = kpiId === "verzuim" ? CAREON_MONTHS : ["Vorige maand", "Huidig"];
  }
  const trend = hrTrend ?? (liveTrend ? liveTrend.values : demoKpiTrend(entry.id, entry.trend, factor));
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
  } else if (liveRows && rows.some((row) => isTgcDossierUrl(row.dossierUrl))) {
    columns = [...entry.columns, DOSSIER_LINK_COLUMN];
  }

  const locatieGekozen = filters.locatie !== "Alle locaties";
  const teamNote =
    !production && filters.team !== "Alle teams" ? " · teamfilter niet van toepassing op deze detailweergave" : "";
  // Alleen een locatie noemen waar de rijen er ook echt op zijn gefilterd.
  let caption = `${nl.format(rows.length)} records · ${locatieOpRijen ? filters.locatie : "Alle locaties"}${teamNote}`;
  if (isHrDetail) {
    caption = "1 handmatige HR-registratie · dezelfde waarde als op de HR-pagina";
  } else if (aggDetail) {
    caption = `${nl.format(aggDetail.rowCount ?? rows.length)} ${aggDetail.eenheid} · geaggregeerd (losse afspraakregels worden uit privacy-oogpunt niet bewaard)`;
  }

  const noten: string[] = [];
  if (isHrDetail) {
    noten.push("De handmatige registratie bevat totaalwaarden; team- en persoonsregels worden niet afgeleid.");
  } else if (production && !liveRows) {
    // Niet elke eigenaarspagina heeft een wachtnotitie.
    const wachtNote: string | undefined = DETAIL_WAIT_NOTES[entry.page];
    if (wachtNote) {
      noten.push(wachtNote);
    }
    if (locatieGekozen) {
      noten.push(`Het locatiefilter (${filters.locatie}) is niet toegepast op deze demo-records.`);
    }
  } else if (!production && locatieGekozen && locatieOpRijen) {
    // Schaalbare KPI: kop én tabel gelden voor de gekozen vestiging, gelijk aan
    // de kaart waarop is geklikt. Niet-schaalbare KPI's houden de geauditeerde
    // organisatiebrede waarde terwijl de tabel wél filtert — dat verschil moet
    // benoemd worden, anders lezen kop en tabel als twee tegenstrijdige cijfers.
    noten.push(
      entry.scale
        ? `Waarde én records gelden voor ${filters.locatie} — hetzelfde getal als op de kaart waarop u klikte.`
        : `De waarde hierboven geldt organisatiebreed — gelijk aan de kaart op ${CAREON_PAGE_META[entry.page].title}; deze tabel toont alleen ${filters.locatie}.`,
    );
  }
  const waitNote = noten.length > 0 ? noten.join(" ") : undefined;

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
