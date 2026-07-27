"use client";

import { Database } from "lucide-react";

import { pageLiveCounts } from "@/lib/careon-production/provenance";

import { useCareon } from "./careon-provider";

// Paginabanner in productie-modus: maakt per pagina expliciet hoeveel widgets
// echte EPD-data tonen en van welke import die komt. Demo-modus: rendert null.
export function CareonLiveBanner({ page }: Readonly<{ page: string }>) {
  const { isProduction, production, filters } = useCareon();
  if (!isProduction || !production) {
    return null;
  }

  // Actieve cliënten zonder (bekende) vestiging vallen buiten elk specifiek
  // locatiefilter — zonder melding is "Tilburg + Breda + Roermond ≠ totaal"
  // niet te herleiden.
  const buitenFilter =
    filters.locatie !== "Alle locaties" && production.meta.zonderVestiging > 0 ? production.meta.zonderVestiging : null;

  const counts = pageLiveCounts(page, {
    agenda: production.agenda != null,
    agendaToekomst: production.agenda?.vooruitblik != null,
    agendaKwaliteit: production.agenda?.kwaliteit != null,
    verwijzers: production.verwijzerNetwerk != null,
    toeslagen: production.toeslagen != null,
    declaraties: production.declaraties != null,
  });
  // UTC, net als de referentiedatum van de snapshot: anders kan de banner
  // "1 aug" tonen naast KPI's die (correct) op het juni-venster staan.
  const importDate = new Date(production.meta.importedAt).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  const coverage =
    counts.live === 0
      ? "Deze pagina heeft nog geen EPD-bron — alle widgets tonen demo-data tot de aanvullende exports zijn gekoppeld."
      : `${counts.live} van ${counts.total} widgets tonen EPD-data; de rest is gemarkeerd als demo.`;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-violet-600/30 bg-violet-500/5 px-3 py-2 text-muted-foreground text-xs">
      <Database className="size-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
      <span className="font-medium text-foreground">Productie-data actief</span>
      <span>·</span>
      <span>{coverage}</span>
      <span>·</span>
      <span>
        Import {production.meta.fileName} ({importDate}) — {production.meta.totalRows} cliëntrijen
      </span>
      {production.agenda && (
        <>
          <span>·</span>
          <span>
            Agenda t/m{" "}
            {new Date(`${production.agenda.meta.bronTot}T00:00:00Z`).toLocaleDateString("nl-NL", {
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            })}{" "}
            ({production.agenda.meta.sessieRows} sessies)
          </span>
        </>
      )}
      {buitenFilter !== null && (
        <>
          <span>·</span>
          <span>{buitenFilter} actieve cliënten zonder vestigingslabel vallen buiten dit locatiefilter</span>
        </>
      )}
    </div>
  );
}
