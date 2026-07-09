"use client";

import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { BEHANDELAREN, CASELOAD_NORM } from "@/data/careon/careon-behandelaren";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

import { BehandelarenTable } from "./behandelaren-table";

export function BehandelarenContent() {
  const { filters } = useCareon();

  const rows = BEHANDELAREN.filter(
    (row) =>
      (filters.locatie === "Alle locaties" || row.loc === filters.locatie) &&
      (filters.team === "Alle teams" || row.team === filters.team),
  );

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader
        title={CAREON_PAGE_META.behandelaren.title}
        sub={`${CAREON_PAGE_META.behandelaren.sub} De caseloadnorm is ${CASELOAD_NORM} cliënten.`}
      />
      <p className="text-muted-foreground text-sm">
        {rows.length} behandelaren · {filters.locatie} · {filters.team}
      </p>
      <BehandelarenTable rows={rows} />
      <p className="text-muted-foreground text-xs">
        NC = niet-complete dossiers. Rood wanneer caseload &gt;{CASELOAD_NORM} of no-show &gt;5%; deze gevallen
        verschijnen automatisch in Signaleringen.
      </p>
    </div>
  );
}
