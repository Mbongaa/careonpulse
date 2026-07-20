"use client";

import Link from "next/link";

import { MIDDEL_ICONS, MIDDEL_LABELS } from "@/data/careon/careon-middelen";
import { CAREON_ROUTES } from "@/data/careon/careon-pages";
import { MIDDEL_TYPES } from "@/lib/careon-middelen/types";
import { cn } from "@/lib/utils";

import { useCareonMiddelen } from "./careon-middelen-provider";

// Compacte, alleen-lezen weergave van de uitgegeven middelen van één
// medewerker (handoff 09). Bewerken gebeurt op de Middelen-pagina; de badge
// linkt daarheen.
export function CareonMiddelenBadges({ naam, className }: Readonly<{ naam: string; className?: string }>) {
  const { middelenByNaam } = useCareonMiddelen();
  const middelen = middelenByNaam.get(naam) ?? [];

  if (middelen.length === 0) {
    return <span className="text-muted-foreground/50 text-xs">—</span>;
  }

  const labels = MIDDEL_TYPES.filter((middel) => middelen.includes(middel)).map((middel) => MIDDEL_LABELS[middel]);

  return (
    <Link
      prefetch={false}
      href={CAREON_ROUTES.middelen}
      title={labels.join(" · ")}
      aria-label={`Middelen van ${naam}: ${labels.join(", ")} — open Middelen & inventaris`}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      {MIDDEL_TYPES.filter((middel) => middelen.includes(middel)).map((middel) => {
        const Icon = MIDDEL_ICONS[middel];
        return <Icon key={middel} aria-hidden="true" className="size-3.5" />;
      })}
    </Link>
  );
}

/** Geregistreerde functie van een medewerker (of null) — voor de identiteitsregel. */
export function useMedewerkerFunctie(naam: string): string | null {
  const { registratieByNaam } = useCareonMiddelen();
  return registratieByNaam.get(naam)?.functie ?? null;
}

/** Alleen-lezen taalweergave voor de Behandelaren-tabellen. */
export function CareonMedewerkerTalen({ naam, className }: Readonly<{ naam: string; className?: string }>) {
  const { registratieByNaam } = useCareonMiddelen();
  const talen = registratieByNaam.get(naam)?.talen ?? [];

  if (talen.length === 0) {
    return <span className="text-muted-foreground/50 text-xs">—</span>;
  }
  return (
    <span title={talen.join(" · ")} className={cn("text-xs", className)}>
      {talen.join(", ")}
    </span>
  );
}

/** Alleen-lezen teamtags voor de Behandelaren-tabellen. */
export function CareonMedewerkerTeams({ naam, className }: Readonly<{ naam: string; className?: string }>) {
  const { registratieByNaam } = useCareonMiddelen();
  const teams = registratieByNaam.get(naam)?.teams ?? [];

  if (teams.length === 0) {
    return <span className="text-muted-foreground/50 text-xs">—</span>;
  }
  return (
    <span title={teams.join(" · ")} className={cn("text-xs", className)}>
      {teams.join(", ")}
    </span>
  );
}
