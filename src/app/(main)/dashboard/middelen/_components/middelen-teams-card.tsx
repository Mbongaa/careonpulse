"use client";

import { type FormEvent, useState } from "react";

import { Plus, X } from "lucide-react";

import { useCareonMiddelen } from "@/app/(main)/dashboard/_components/careon/careon-middelen-provider";
import { CareonHandmatigBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// Teamstructuur van TGC Groep: teams per (Vektis-)locatie, volledig door de
// gebruiker te beheren — de klant gaf aan dat de structuur binnen maanden kan
// wijzigen. Verwijderen haalt alleen de structuurrij weg; teamtags op
// medewerkers blijven staan en zijn per medewerker uit te zetten.

function TeamToevoegen({ locatie }: Readonly<{ locatie: string }>) {
  const { addTeam } = useCareonMiddelen();
  const [naam, setNaam] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (addTeam(locatie, naam)) {
      setNaam("");
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <Input
        value={naam}
        onChange={(event) => setNaam(event.target.value)}
        placeholder="Nieuw team…"
        aria-label={`Nieuw team — ${locatie}`}
        className="h-7 w-36 text-xs"
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="h-7 px-2"
        aria-label={`Team toevoegen aan ${locatie}`}
        disabled={naam.trim() === ""}
      >
        <Plus className="size-3.5" />
      </Button>
    </form>
  );
}

export function MiddelenTeamsCard({ bronLocaties }: Readonly<{ bronLocaties: string[] }>) {
  const { state, removeTeam } = useCareonMiddelen();
  const teams = state.teams ?? [];

  // Secties voor élke bekende locatie (structuur ∪ databron ∪ inventaris):
  // ook een locatie waarvan alle teams zijn verwijderd blijft bewerkbaar.
  const locaties = [
    ...new Set([...teams.map((team) => team.locatie), ...bronLocaties, ...state.inventaris.map((rij) => rij.locatie)]),
  ];
  const tagTelling = new Map<string, number>();
  for (const rij of state.medewerkers) {
    for (const tag of rij.teams ?? []) {
      tagTelling.set(tag, (tagTelling.get(tag) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 font-medium text-sm">
          Teams per locatie
          <CareonHandmatigBadge />
        </h2>
        <p className="text-muted-foreground text-xs">
          Moederbedrijf TGC Groep · locaties zoals in Vektis geregistreerd. Beheer de structuur hier; tag medewerkers in
          de tabel hierboven.
        </p>
      </div>
      <Card className="py-0">
        <CardContent className="divide-y px-0">
          {locaties.map((locatie) => (
            <div key={locatie} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
              <span className="w-28 shrink-0 font-medium text-sm">{locatie}</span>
              <div className="flex flex-1 flex-wrap items-center gap-2">
                {teams
                  .filter((team) => team.locatie === locatie)
                  .map((team) => {
                    const getagd = tagTelling.get(team.naam) ?? 0;
                    return (
                      <span
                        key={team.naam}
                        className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
                      >
                        {team.naam}
                        <button
                          type="button"
                          aria-label={`Verwijder team ${team.naam} (${locatie})`}
                          title={
                            getagd > 0
                              ? `${getagd} medewerker(s) dragen deze tag — tags blijven staan en zijn per medewerker uit te zetten.`
                              : "Verwijder dit team uit de structuur."
                          }
                          onClick={() => removeTeam(locatie, team.naam)}
                          className="text-muted-foreground/60 transition-colors hover:text-foreground"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    );
                  })}
                <TeamToevoegen locatie={locatie} />
              </div>
            </div>
          ))}
          {locaties.length === 0 && (
            <p className="p-4 text-muted-foreground text-sm">
              Nog geen teamstructuur — voeg eerst een locatie toe bij de inventaris hieronder.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
