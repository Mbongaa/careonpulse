"use client";

import { CareonInsights } from "@/app/(main)/dashboard/_components/careon/careon-insights";
import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonLiveBanner } from "@/app/(main)/dashboard/_components/careon/careon-live-banner";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import {
  DOSSIERS_PRODUCTIE_INSIGHTS,
  DOSSIERS_PRODUCTIE_METRICS,
  MEDEWERKER_PRODUCTIE,
} from "@/data/careon/careon-dossiers-productie";
import { careonDetailHref } from "@/data/careon/careon-kpi-details";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

import { MedewerkerProductieLiveTable } from "./medewerker-productie-live-table";
import { MedewerkerProductieTable } from "./medewerker-productie-table";
import {
  DiagnosesPanel,
  GeslachtPanel,
  LeeftijdPanel,
  PlaatsPanel,
  VerwijzersPanel,
  VerzekeraarsPanel,
} from "./population-breakdown";
import { RegiebehandelaarPanel } from "./regiebehandelaar-panel";
import { WachtlijstPanel } from "./wachtlijst-panel";
import { BehandelduurPanel, ZorgvraagtyperingPanel } from "./zorg-analyse-panels";

export function DossiersProductieContent() {
  const { filters, production } = useCareon();

  // Demo: tabel volgt locatie- en teamfilter. Productie: de snapshot is al op
  // vestiging gefilterd (teamfilter is verborgen — alle EPD-trajecten zijn SGGZ).
  const demoRows = MEDEWERKER_PRODUCTIE.filter(
    (row) =>
      (filters.locatie === "Alle locaties" || row.loc === filters.locatie) &&
      (filters.team === "Alle teams" || row.team === filters.team),
  );
  const medewerkerCount = production ? production.dossiersProductie.medewerkers.length : demoRows.length;

  const metrics = DOSSIERS_PRODUCTIE_METRICS.map((metric) => {
    if (!production) {
      return metric;
    }
    // De detailId reist expliciet mee zodat de drill-down in beide modi werkt.
    const live = production.dossiersProductie.metrics[metric.label] ?? metric;
    return { ...live, detailId: metric.detailId };
  });

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title={CAREON_PAGE_META.dossiersProductie.title} sub={CAREON_PAGE_META.dossiersProductie.sub} />

      <CareonLiveBanner page="dossiersProductie" />

      <CareonInsights
        messages={production ? production.dossiersProductie.insights : DOSSIERS_PRODUCTIE_INSIGHTS}
        badge={<CareonSourceBadge page="dossiersProductie" widget="Careon Insights" />}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {metrics.map((metric) => (
          <CareonKpiCard
            key={metric.label}
            metric={metric}
            href={metric.detailId ? careonDetailHref(metric.detailId) : undefined}
            sourceBadge={<CareonSourceBadge page="dossiersProductie" widget={metric.label} />}
          />
        ))}
      </div>

      <p className="text-muted-foreground text-sm">
        {medewerkerCount} medewerkers · {filters.locatie}
        {production ? "" : ` · ${filters.team}`}
      </p>
      {production ? (
        <MedewerkerProductieLiveTable rows={production.dossiersProductie.medewerkers} />
      ) : (
        <MedewerkerProductieTable rows={demoRows} />
      )}

      {/* Populatiegrid volgens de Claude Design-handoff "Dossiers en Productie":
          twee rijen — 6/3/3 en 4/4/4. De regie- en wachtlijstpanelen zijn uit
          het demo-ontwerp geschrapt (hun kerncijfers zitten al in de KPI-strip,
          insights en drill-downs) en renderen net als zorgvraagtypering en
          behandelduur alleen nog bij een actieve EPD-import. */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-12">
        <DiagnosesPanel className="lg:col-span-6" />
        <GeslachtPanel className="lg:col-span-3" />
        <LeeftijdPanel className="lg:col-span-3" />
        <VerwijzersPanel className="lg:col-span-4" />
        <PlaatsPanel className="lg:col-span-4" />
        <VerzekeraarsPanel className="lg:col-span-4" />
        <ZorgvraagtyperingPanel className="lg:col-span-6" />
        <BehandelduurPanel className="lg:col-span-6" />
        <RegiebehandelaarPanel className="lg:col-span-6" />
        <WachtlijstPanel className="lg:col-span-6" />
      </div>

      <p className="text-center text-muted-foreground text-xs">
        {production
          ? `Populatiecijfers betreffen de actieve cliënten uit de EPD-export${filters.locatie === "Alle locaties" ? "" : ` (vestiging ${filters.locatie})`}; uren- en productiviteitskolommen volgen zodra de urenregistratie-export gekoppeld is.`
          : "Populatiecijfers betreffen alle actieve cliënten; de medewerkerstabel volgt de locatie- en teamfilters. Deze rapportage vervangt de maandelijkse Excel-berekening."}
      </p>
    </div>
  );
}
