"use client";

import { CareonInsights } from "@/app/(main)/dashboard/_components/careon/careon-insights";
import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import {
  DOSSIERS_PRODUCTIE_INSIGHTS,
  DOSSIERS_PRODUCTIE_METRICS,
  MEDEWERKER_PRODUCTIE,
} from "@/data/careon/careon-dossiers-productie";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

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

export function DossiersProductieContent() {
  const { filters } = useCareon();

  const rows = MEDEWERKER_PRODUCTIE.filter(
    (row) =>
      (filters.locatie === "Alle locaties" || row.loc === filters.locatie) &&
      (filters.team === "Alle teams" || row.team === filters.team),
  );

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title={CAREON_PAGE_META.dossiersProductie.title} sub={CAREON_PAGE_META.dossiersProductie.sub} />

      <CareonInsights messages={DOSSIERS_PRODUCTIE_INSIGHTS} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {DOSSIERS_PRODUCTIE_METRICS.map((metric) => (
          <CareonKpiCard key={metric.label} metric={metric} />
        ))}
      </div>

      <p className="text-muted-foreground text-sm">
        {rows.length} medewerkers · {filters.locatie} · {filters.team}
      </p>
      <MedewerkerProductieTable rows={rows} />

      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-12">
        <DiagnosesPanel className="lg:col-span-6" />
        <GeslachtPanel className="lg:col-span-3" />
        <LeeftijdPanel className="lg:col-span-3" />
        <VerwijzersPanel className="lg:col-span-4" />
        <PlaatsPanel className="lg:col-span-4" />
        <VerzekeraarsPanel className="lg:col-span-4" />
        <RegiebehandelaarPanel className="lg:col-span-6" />
        <WachtlijstPanel className="lg:col-span-6" />
      </div>

      <p className="text-center text-muted-foreground text-xs">
        Populatiecijfers betreffen alle actieve cliënten; de medewerkerstabel volgt de locatie- en teamfilters. Deze
        rapportage vervangt de maandelijkse Excel-berekening.
      </p>
    </div>
  );
}
