"use client";

import { CareonBarList } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonLiveBanner } from "@/app/(main)/dashboard/_components/careon/careon-live-banner";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { BEHANDELAREN, CASELOAD_NORM } from "@/data/careon/careon-behandelaren";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

import { BehandelarenLiveTable } from "./behandelaren-live-table";
import { BehandelarenTable } from "./behandelaren-table";
import { FunctiemixPanel, TalenPanel, TeamBezettingPanel } from "./team-profiel-panels";

function voetnoot(isProduction: boolean, metAgenda: boolean): string {
  if (!isProduction) {
    return `NC = niet-complete dossiers. Rood wanneer caseload >${CASELOAD_NORM} of no-show >5%; deze gevallen verschijnen automatisch in Signaleringen.`;
  }
  if (metAgenda) {
    return `Caseload = actieve cliënten per behandelaar uit de EPD-export; rood boven de norm van ${CASELOAD_NORM}. Consulten, no-show, uren en omzet komen uit de agenda-export (laatste 12 maanden). ROM en tevredenheid volgen zodra de ROM-export gekoppeld is.`;
  }
  return `Caseload = actieve cliënten per behandelaar uit de EPD-export; rood boven de norm van ${CASELOAD_NORM}. Consulten, no-show, productiviteit, omzet, ROM en tevredenheid volgen zodra de agenda-, declaratie- en ROM-exports gekoppeld zijn.`;
}

const nlFmt = new Intl.NumberFormat("nl-NL");

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
      {production ? (
        <BehandelarenLiveTable rows={production.behandelaren} agendaStats={production.agenda?.behandelaarStats} />
      ) : (
        <BehandelarenTable rows={demoRows} />
      )}
      <p className="text-muted-foreground text-xs">{voetnoot(production !== null, production?.agenda != null)}</p>

      {/* Teamprofiel uit de handmatige registratie (Medewerkers & middelen). */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
        <TalenPanel />
        <FunctiemixPanel />
        <TeamBezettingPanel />
      </div>

      {/* Productie-exclusief (agenda-import): inzet per ZPM-beroepcode. */}
      {production?.agenda?.beroepen && (
        <CareonChartCard
          title="Inzet per ZPM-beroep"
          sub="Sessies en directe uren per beroepcode · hele export"
          titleBadge={<CareonSourceBadge page="behandelaren" widget="Beroepsmix" />}
          footer="Beroepcodes (BP) uit de agenda-export; tussen haakjes de behandelaren met de meeste sessies onder de code. Officiële ZPM-beroepslabels volgen na bevestiging van de instelling."
        >
          <CareonBarList
            items={production.agenda.beroepen.slice(0, 8).map((beroep) => ({
              label: `${beroep.code}${beroep.behandelaars.length > 0 ? ` (${beroep.behandelaars.join(", ")})` : ""}`,
              value: beroep.sessies,
              display: `${nlFmt.format(beroep.sessies)} sessies · ${nlFmt.format(beroep.directeUren)} u`,
            }))}
          />
        </CareonChartCard>
      )}
    </div>
  );
}
