"use client";

import { CareonLiveBanner } from "@/app/(main)/dashboard/_components/careon/careon-live-banner";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { BEHANDELAREN, CASELOAD_NORM } from "@/data/careon/careon-behandelaren";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

import { BehandelarenLiveTable } from "./behandelaren-live-table";
import { BehandelarenTable } from "./behandelaren-table";

export function BehandelarenContent() {
  const { filters, production } = useCareon();

  const demoRows = BEHANDELAREN.filter(
    (row) =>
      (filters.locatie === "Alle locaties" || row.loc === filters.locatie) &&
      (filters.team === "Alle teams" || row.team === filters.team),
  );
  const rowCount = production ? production.behandelaren.length : demoRows.length;

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader
        title={CAREON_PAGE_META.behandelaren.title}
        sub={`${CAREON_PAGE_META.behandelaren.sub} De caseloadnorm is ${CASELOAD_NORM} cliënten.`}
      />
      <CareonLiveBanner page="behandelaren" />
      <p className="text-muted-foreground text-sm">
        {rowCount} behandelaren · {filters.locatie}
        {production ? "" : ` · ${filters.team}`}
      </p>
      {production ? <BehandelarenLiveTable rows={production.behandelaren} /> : <BehandelarenTable rows={demoRows} />}
      <p className="text-muted-foreground text-xs">
        {production
          ? `Caseload = actieve cliënten per behandelaar uit de EPD-export; rood boven de norm van ${CASELOAD_NORM}. Consulten, no-show, productiviteit, omzet, ROM en tevredenheid volgen zodra de agenda-, declaratie- en ROM-exports gekoppeld zijn.`
          : `NC = niet-complete dossiers. Rood wanneer caseload >${CASELOAD_NORM} of no-show >5%; deze gevallen verschijnen automatisch in Signaleringen.`}
      </p>
    </div>
  );
}
