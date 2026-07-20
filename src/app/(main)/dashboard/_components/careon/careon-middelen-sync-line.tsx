"use client";

import { cn } from "@/lib/utils";

import { type MiddelenSyncStatus, useCareonMiddelen } from "./careon-middelen-provider";

// Opslagstatus van de handmatige middelenregistratie: gebruikers moeten zien
// of hun wijzigingen gedeeld worden met collega's (centraal) of alleen in
// deze browser staan (lokaal / fout).
const STATUS_TEKST: Record<MiddelenSyncStatus, string> = {
  laden: "Registratie laden…",
  centraal: "Wijzigingen worden centraal opgeslagen en gedeeld met collega's.",
  lokaal: "Alleen lokaal opgeslagen in deze browser — centrale opslag is niet geconfigureerd.",
  fout: "Centrale opslag mislukt — wijzigingen staan alleen lokaal in deze browser.",
};

export function CareonMiddelenSyncLine({ className }: Readonly<{ className?: string }>) {
  const { syncStatus } = useCareonMiddelen();
  return (
    <p
      className={cn(
        "text-muted-foreground text-xs",
        syncStatus === "fout" && "text-red-700 dark:text-red-400",
        syncStatus === "lokaal" && "text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      {STATUS_TEKST[syncStatus]}
    </p>
  );
}
