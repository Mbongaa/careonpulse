"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { type HrSyncStatus, useCareonHr } from "./careon-hr-provider";

// Opslagstatus van de handmatige HR-registratie: de gebruiker moet zien of
// wijzigingen gedeeld worden met collega's (centraal) of alleen in deze browser
// staan (lokaal / fout). Zelfde patroon als de middelen-sync-lijn.
const STATUS_TEKST: Record<HrSyncStatus, string> = {
  laden: "HR-registratie laden…",
  centraal: "Wijzigingen worden centraal opgeslagen en gedeeld met collega's.",
  lokaal: "Alleen lokaal opgeslagen in deze browser — centrale opslag is niet geconfigureerd.",
  fout: "Centrale opslag mislukt — wijzigingen staan lokaal en worden automatisch opnieuw aangeboden.",
  conflict: "Er is tegelijk elders gewijzigd. Kies welke versie leidend moet zijn.",
};

export function CareonHrSyncLine({ className }: Readonly<{ className?: string }>) {
  const { syncStatus, retrySync, resolveConflict, hasCentralConflictVersion } = useCareonHr();
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 text-muted-foreground text-xs",
        syncStatus === "fout" && "text-red-700 dark:text-red-400",
        (syncStatus === "lokaal" || syncStatus === "conflict") && "text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      <span>{STATUS_TEKST[syncStatus]}</span>
      {syncStatus === "conflict" && (
        <span className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            disabled={!hasCentralConflictVersion}
            onClick={() => resolveConflict("centraal")}
          >
            Centrale versie
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={() => resolveConflict("lokaal")}
          >
            Mijn versie
          </Button>
        </span>
      )}
      {syncStatus === "fout" && (
        <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={retrySync}>
          Nu opnieuw proberen
        </Button>
      )}
    </div>
  );
}
