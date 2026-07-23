"use client";

import type { LucideIcon } from "lucide-react";
import { BookOpen, Car, ClipboardList, DoorClosed, DoorOpen, Fuel, KeyRound, Laptop, Smartphone } from "lucide-react";

import { useCareonMiddelen } from "@/app/(main)/dashboard/_components/careon/careon-middelen-provider";
import { CareonMiddelenSyncLine } from "@/app/(main)/dashboard/_components/careon/careon-middelen-sync-line";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonHandmatigBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { BEHANDELAREN } from "@/data/careon/careon-behandelaren";
import { CAREON_LOCATIONS } from "@/data/careon/careon-filters";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";
import type { MiddelType } from "@/lib/careon-middelen/types";

import { MiddelenInventarisCard } from "./middelen-inventaris-card";
import { MiddelenMedewerkersCard } from "./middelen-medewerkers-card";
import { MiddelenTeamsCard } from "./middelen-teams-card";

const nl = new Intl.NumberFormat("nl-NL");

// Bronrij: medewerker uit de actieve databron (EPD-medewerkers in productie,
// de geauditeerde behandelaren in demo). De registratie zelf kan daarnaast
// handmatig toegevoegde personen bevatten (kantoorpersoneel e.d.).
export interface MiddelenBronRij {
  naam: string;
  sub: string;
}

function MiddelenStat({
  label,
  value,
  sub,
  icon: Icon,
}: Readonly<{ label: string; value: string; sub: string; icon: LucideIcon }>) {
  return (
    <Card className="gap-3 py-4">
      <div className="flex items-center justify-between gap-2 px-4">
        <CardDescription className="truncate text-xs">{label}</CardDescription>
        <CardTitle>
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
            <Icon className="size-3.5" />
          </div>
        </CardTitle>
      </div>
      <CardContent className="flex flex-col gap-1.5 px-4">
        <div className="font-medium text-2xl tabular-nums leading-none tracking-tight">{value}</div>
        <p className="text-muted-foreground text-xs">{sub}</p>
      </CardContent>
    </Card>
  );
}

const UITGEGEVEN_TEGELS: { middel: MiddelType; label: string; icon: LucideIcon }[] = [
  { middel: "auto", label: "Uitgegeven auto's", icon: Car },
  { middel: "tankpas", label: "Tankpassen", icon: Fuel },
  { middel: "sleutel", label: "Sleutels", icon: KeyRound },
  { middel: "telefoon", label: "Telefoons", icon: Smartphone },
  { middel: "laptop", label: "Laptops", icon: Laptop },
  { middel: "toegang", label: "Toegang gebouw", icon: DoorOpen },
];

export function MiddelenContent() {
  const { production } = useCareon();
  const { state } = useCareonMiddelen();

  const bronMedewerkers: MiddelenBronRij[] = production
    ? production.dossiersProductie.medewerkers.map((medewerker) => ({ naam: medewerker.naam, sub: medewerker.loc }))
    : BEHANDELAREN.map((behandelaar) => ({ naam: behandelaar.naam, sub: `${behandelaar.team} · ${behandelaar.loc}` }));

  // Locaties uit de cliëntrecords (élke vestiging in de export), niet uit de
  // medewerkerslijst — die draagt per medewerker alleen de meest voorkomende
  // vestiging en zou locaties laten wegvallen.
  const bronLocaties = production
    ? [...new Set(production.records.map((record) => record.vestiging).filter((vestiging) => vestiging !== null))].sort(
        (a, b) => a.localeCompare(b, "nl"),
      )
    : CAREON_LOCATIONS.filter((locatie) => locatie !== "Alle locaties");

  // Totaal personen in de administratie: bronmedewerkers ∪ geregistreerde
  // (incl. handmatig toegevoegde) personen.
  const bronNamen = new Set(bronMedewerkers.map((rij) => rij.naam));
  const totaalPersonen = bronNamen.size + state.medewerkers.filter((rij) => !bronNamen.has(rij.naam)).length;

  const uitgegeven = (middel: MiddelType) => state.medewerkers.filter((rij) => rij.middelen.includes(middel)).length;

  const inventarisLocaties = new Set([...state.inventaris.map((rij) => rij.locatie), ...bronLocaties]).size;
  const inventarisSom = (veld: "behandelkamers" | "boeken" | "diagnostiek" | "laptops") =>
    state.inventaris.reduce((som, rij) => som + (rij[veld] ?? 0), 0);

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title={CAREON_PAGE_META.middelen.title} sub={CAREON_PAGE_META.middelen.sub} />

      <div className="flex flex-wrap items-center gap-2">
        <CareonHandmatigBadge />
        <CareonMiddelenSyncLine />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {UITGEGEVEN_TEGELS.map((tegel) => (
          <MiddelenStat
            key={tegel.middel}
            label={tegel.label}
            value={nl.format(uitgegeven(tegel.middel))}
            sub={`van ${nl.format(totaalPersonen)} medewerkers`}
            icon={tegel.icon}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MiddelenStat
          label="Behandelkamers"
          value={nl.format(inventarisSom("behandelkamers"))}
          sub={`beschikbaar over ${nl.format(inventarisLocaties)} locaties`}
          icon={DoorClosed}
        />
        <MiddelenStat
          label="Boeken inventaris"
          value={nl.format(inventarisSom("boeken"))}
          sub={`over ${nl.format(inventarisLocaties)} locaties`}
          icon={BookOpen}
        />
        <MiddelenStat
          label="Diagnostiekmateriaal"
          value={nl.format(inventarisSom("diagnostiek"))}
          sub={`over ${nl.format(inventarisLocaties)} locaties`}
          icon={ClipboardList}
        />
        <MiddelenStat
          label="Laptops op voorraad"
          value={nl.format(inventarisSom("laptops"))}
          sub={`over ${nl.format(inventarisLocaties)} locaties`}
          icon={Laptop}
        />
      </div>

      <MiddelenMedewerkersCard bronMedewerkers={bronMedewerkers} />
      <MiddelenTeamsCard bronLocaties={bronLocaties} />
      <MiddelenInventarisCard bronLocaties={bronLocaties} />

      <p className="text-center text-muted-foreground text-xs">
        Handmatige registratie — deze gegevens komen niet uit het EPD en tellen niet mee in de zorg-KPI&apos;s.
      </p>
    </div>
  );
}
