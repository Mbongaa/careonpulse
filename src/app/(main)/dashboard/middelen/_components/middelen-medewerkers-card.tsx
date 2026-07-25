"use client";

import { type FormEvent, useState } from "react";

import { Check, Languages, UserRoundPlus, UsersRound, X } from "lucide-react";

import { useCareonMiddelen } from "@/app/(main)/dashboard/_components/careon/careon-middelen-provider";
import { CareonHandmatigBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { CareonPersonCell } from "@/app/(main)/dashboard/_components/careon/careon-table-cells";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FUNCTIE_OPTIES, MIDDEL_ICONS, MIDDEL_LABELS, TAAL_OPTIES } from "@/data/careon/careon-middelen";
import { MIDDEL_TYPES, type MiddelType } from "@/lib/careon-middelen/types";
import { cn } from "@/lib/utils";

import type { MiddelenBronRij } from "./middelen-content";

// Medewerkerregistratie: functie en talen (voor de teamstatistieken op
// Behandelaren), toggle-tags per uitgegeven middel, vrije notitie en
// handmatig toe te voegen personen buiten de behandelarenbron.

interface MiddelenRij {
  naam: string;
  sub: string;
  functie: string;
  talen: string[];
  teams: string[];
  middelen: MiddelType[];
  notitie: string;
  uitDienst: boolean;
  verwijderbaar: boolean;
}

// Dienstverband-toggle: uit dienst laat de registratie staan (historie) —
// de assistent-tool zet_dienstverband doet hetzelfde en neemt bovendien de
// middelen in; handmatig innemen kan hier per toggle.
function DienstKnop({ rij }: Readonly<{ rij: MiddelenRij }>) {
  const { setUitDienst } = useCareonMiddelen();
  return (
    <button
      type="button"
      aria-pressed={rij.uitDienst}
      aria-label={`${rij.naam} ${rij.uitDienst ? "weer in dienst zetten" : "uit dienst zetten"}`}
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs transition-colors ${
        rij.uitDienst
          ? "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300"
          : "text-muted-foreground hover:bg-muted"
      }`}
      onClick={() => setUitDienst(rij.naam, !rij.uitDienst)}
    >
      {rij.uitDienst ? "Uit dienst" : "In dienst"}
    </button>
  );
}

function MiddelToggles({ naam, middelen }: Readonly<{ naam: string; middelen: MiddelType[] }>) {
  const { toggleMiddel } = useCareonMiddelen();
  return (
    <div className="flex items-center gap-1">
      {MIDDEL_TYPES.map((middel) => {
        const Icon = MIDDEL_ICONS[middel];
        const actief = middelen.includes(middel);
        return (
          <button
            key={middel}
            type="button"
            title={MIDDEL_LABELS[middel]}
            aria-label={`${MIDDEL_LABELS[middel]} — ${naam}`}
            aria-pressed={actief}
            onClick={() => toggleMiddel(naam, middel)}
            className={cn(
              "flex size-7 items-center justify-center rounded-md border transition-colors",
              actief
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-transparent text-muted-foreground/40 hover:border-border hover:text-muted-foreground",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}

function FunctieSelect({ naam, functie }: Readonly<{ naam: string; functie: string }>) {
  const { setFunctie } = useCareonMiddelen();
  const bekend = (FUNCTIE_OPTIES as readonly string[]).includes(functie);
  return (
    <NativeSelect
      size="sm"
      className="w-full max-w-44"
      value={functie}
      aria-label={`Functie — ${naam}`}
      onChange={(event) => setFunctie(naam, event.target.value)}
    >
      <NativeSelectOption value="">—</NativeSelectOption>
      {FUNCTIE_OPTIES.map((optie) => (
        <NativeSelectOption key={optie} value={optie}>
          {optie}
        </NativeSelectOption>
      ))}
      {/* Een eerder vrij geregistreerde functie blijft geldig en zichtbaar. */}
      {functie !== "" && !bekend && <NativeSelectOption value={functie}>{functie}</NativeSelectOption>}
    </NativeSelect>
  );
}

function TalenEditor({ naam, talen }: Readonly<{ naam: string; talen: string[] }>) {
  const { toggleTaal } = useCareonMiddelen();
  const [custom, setCustom] = useState("");

  // Gecureerde opties eerst; eerder toegevoegde vrije talen blijven zichtbaar.
  const opties = [...TAAL_OPTIES, ...talen.filter((taal) => !(TAAL_OPTIES as readonly string[]).includes(taal))];

  function submitCustom(event: FormEvent) {
    event.preventDefault();
    const schoon = custom.trim();
    if (schoon && !talen.includes(schoon)) {
      toggleTaal(naam, schoon);
      setCustom("");
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-full max-w-44 justify-start px-2 font-normal text-xs"
          aria-label={`Talen — ${naam}`}
        >
          <Languages className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{talen.length > 0 ? talen.join(", ") : "—"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <div className="flex flex-col gap-0.5">
          {opties.map((taal) => {
            const actief = talen.includes(taal);
            return (
              <button
                key={taal}
                type="button"
                aria-pressed={actief}
                onClick={() => toggleTaal(naam, taal)}
                className={cn(
                  "flex items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted",
                  actief && "bg-primary/10 font-medium text-primary",
                )}
              >
                {taal}
                {actief && <Check className="size-3.5" />}
              </button>
            );
          })}
        </div>
        <form onSubmit={submitCustom} className="mt-2 flex items-center gap-1.5 border-t pt-2">
          <Input
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            placeholder="Andere taal…"
            aria-label={`Andere taal — ${naam}`}
            className="h-7 text-xs"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={custom.trim() === ""}
          >
            Voeg toe
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function TeamsEditor({ naam, tags }: Readonly<{ naam: string; tags: string[] }>) {
  const { state, toggleTeamTag } = useCareonMiddelen();

  // Structuurteams (gededupliceerd over locaties) + bestaande tags die niet
  // (meer) in de structuur staan — die blijven uitzetbaar.
  const structuur = [...new Set((state.teams ?? []).map((team) => team.naam))];
  const opties = [...structuur, ...tags.filter((tag) => !structuur.includes(tag))];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-full max-w-44 justify-start px-2 font-normal text-xs"
          aria-label={`Teams — ${naam}`}
        >
          <UsersRound className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{tags.length > 0 ? tags.join(", ") : "—"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <div className="flex flex-col gap-0.5">
          {opties.map((team) => {
            const actief = tags.includes(team);
            const inStructuur = structuur.includes(team);
            return (
              <button
                key={team}
                type="button"
                aria-pressed={actief}
                onClick={() => toggleTeamTag(naam, team)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted",
                  actief && "bg-primary/10 font-medium text-primary",
                )}
              >
                <span className="truncate">
                  {team}
                  {!inStructuur && <span className="text-muted-foreground"> · niet in structuur</span>}
                </span>
                {actief && <Check className="size-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
        <p className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
          Teams beheer je in &quot;Teams per locatie&quot; hieronder.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function NotitieInput({ naam, notitie }: Readonly<{ naam: string; notitie: string }>) {
  const { setNotitie } = useCareonMiddelen();
  return (
    <Input
      key={`${naam}:${notitie}`}
      defaultValue={notitie}
      placeholder="Notitie (kenteken, nummer …)"
      aria-label={`Notitie — ${naam}`}
      className="h-8 text-xs"
      onBlur={(event) => {
        if (event.target.value !== notitie) {
          setNotitie(naam, event.target.value);
        }
      }}
    />
  );
}

function VerwijderKnop({ rij }: Readonly<{ rij: MiddelenRij }>) {
  const { removePersoon } = useCareonMiddelen();
  if (!rij.verwijderbaar) {
    return null;
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground"
      aria-label={`Verwijder ${rij.naam} uit de registratie`}
      onClick={() => removePersoon(rij.naam)}
    >
      <X className="size-3.5" />
    </Button>
  );
}

function PersoonToevoegen() {
  const { addPersoon } = useCareonMiddelen();
  const [naam, setNaam] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (addPersoon(naam)) {
      setNaam("");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 border-t p-4">
      <Input
        value={naam}
        onChange={(event) => setNaam(event.target.value)}
        placeholder="Naam (bijv. officemanager, niet in EPD)"
        aria-label="Naam nieuwe persoon"
        className="h-8 max-w-xs text-xs"
      />
      <Button type="submit" size="sm" variant="outline" disabled={naam.trim() === ""}>
        <UserRoundPlus className="size-3.5" />
        Persoon toevoegen
      </Button>
    </form>
  );
}

export function MiddelenMedewerkersCard({ bronMedewerkers }: Readonly<{ bronMedewerkers: MiddelenBronRij[] }>) {
  const { state } = useCareonMiddelen();

  const registratieByNaam = new Map(state.medewerkers.map((rij) => [rij.naam, rij]));
  const bronNamen = new Set(bronMedewerkers.map((rij) => rij.naam));

  const rijen: MiddelenRij[] = [
    ...bronMedewerkers.map((bron) => {
      const registratie = registratieByNaam.get(bron.naam);
      return {
        naam: bron.naam,
        sub: bron.sub,
        functie: registratie?.functie ?? "",
        talen: registratie?.talen ?? [],
        teams: registratie?.teams ?? [],
        middelen: registratie?.middelen ?? [],
        notitie: registratie?.notitie ?? "",
        uitDienst: registratie?.uitDienst === true,
        verwijderbaar: false,
      };
    }),
    // Geregistreerde personen buiten de bron: handmatig toegevoegd, of een
    // medewerker die uit een latere EPD-export is verdwenen. Nooit stil
    // weggooien — wel verwijderbaar maken.
    ...state.medewerkers
      .filter((rij) => !bronNamen.has(rij.naam))
      .map((rij) => ({
        naam: rij.naam,
        sub: rij.handmatig ? "Handmatig toegevoegd" : "Niet in huidige databron",
        functie: rij.functie ?? "",
        talen: rij.talen ?? [],
        teams: rij.teams ?? [],
        middelen: rij.middelen,
        notitie: rij.notitie ?? "",
        uitDienst: rij.uitDienst === true,
        verwijderbaar: true,
      })),
  ];

  return (
    <div className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 font-medium text-sm">
          Medewerkers — functie, talen &amp; middelen
          <CareonHandmatigBadge />
        </h2>
        <p className="text-muted-foreground text-xs">
          Functie en talen voeden de teamstatistieken op Behandelaren; wijzigingen worden direct opgeslagen.
        </p>
      </div>
      <Card className="py-0">
        <CardContent className="px-0">
          <ul className="divide-y md:hidden">
            {rijen.map((rij) => (
              <li key={rij.naam} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <CareonPersonCell naam={rij.naam} sub={rij.sub} />
                  <span className="flex items-center gap-1.5">
                    <DienstKnop rij={rij} />
                    <VerwijderKnop rij={rij} />
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <FunctieSelect naam={rij.naam} functie={rij.functie} />
                  <TalenEditor naam={rij.naam} talen={rij.talen} />
                  <TeamsEditor naam={rij.naam} tags={rij.teams} />
                </div>
                <MiddelToggles naam={rij.naam} middelen={rij.middelen} />
                <NotitieInput naam={rij.naam} notitie={rij.notitie} />
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Medewerker</TableHead>
                  <TableHead>Functie</TableHead>
                  <TableHead>Talen</TableHead>
                  <TableHead>Teams</TableHead>
                  <TableHead>Middelen</TableHead>
                  <TableHead className="w-56">Notitie</TableHead>
                  <TableHead className="w-10 pr-4" aria-label="Acties" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rijen.map((rij) => (
                  <TableRow key={rij.naam}>
                    <TableCell className="pl-4">
                      <CareonPersonCell naam={rij.naam} sub={rij.sub} />
                    </TableCell>
                    <TableCell>
                      <FunctieSelect naam={rij.naam} functie={rij.functie} />
                    </TableCell>
                    <TableCell>
                      <TalenEditor naam={rij.naam} talen={rij.talen} />
                    </TableCell>
                    <TableCell>
                      <TeamsEditor naam={rij.naam} tags={rij.teams} />
                    </TableCell>
                    <TableCell>
                      <MiddelToggles naam={rij.naam} middelen={rij.middelen} />
                    </TableCell>
                    <TableCell>
                      <NotitieInput naam={rij.naam} notitie={rij.notitie} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <DienstKnop rij={rij} />
                        <VerwijderKnop rij={rij} />
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PersoonToevoegen />
        </CardContent>
      </Card>
    </div>
  );
}
