"use client";

import { type FormEvent, useState } from "react";

import { MapPinPlus, X } from "lucide-react";

import { useCareonMiddelen } from "@/app/(main)/dashboard/_components/careon/careon-middelen-provider";
import { CareonHandmatigBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LocatieInventaris } from "@/lib/careon-middelen/types";

// Inventaris per locatie: behandelkamers, boeken en diagnostiekmateriaal.
// Locatierijen volgen automatisch de bekende locaties (EPD-vestigingen in
// productie, de demo-locaties anders); extra locaties (hoofdkantoor, opslag)
// zijn handmatig toe te voegen en verschijnen bewust níét in het globale
// locatiefilter — dat blijft aan de EPD/audit gebonden.

type InventarisVeld = "behandelkamers" | "boeken" | "diagnostiek";

const VELDEN: { veld: InventarisVeld; label: string }[] = [
  { veld: "behandelkamers", label: "Behandelkamers" },
  { veld: "boeken", label: "Boeken" },
  { veld: "diagnostiek", label: "Diagnostiekmateriaal" },
];

interface InventarisRij extends LocatieInventaris {
  inBron: boolean;
}

function AantalInput({ rij, veld, label }: Readonly<{ rij: InventarisRij; veld: InventarisVeld; label: string }>) {
  const { setInventarisVeld } = useCareonMiddelen();
  return (
    <Input
      type="number"
      min={0}
      value={rij[veld]}
      aria-label={`${label} — ${rij.locatie}`}
      className="h-8 w-24 text-right text-xs tabular-nums"
      onChange={(event) => setInventarisVeld(rij.locatie, veld, event.target.valueAsNumber)}
    />
  );
}

function LocatieToevoegen() {
  const { addLocatie } = useCareonMiddelen();
  const [naam, setNaam] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (addLocatie(naam)) {
      setNaam("");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 border-t p-4">
      <Input
        value={naam}
        onChange={(event) => setNaam(event.target.value)}
        placeholder="Locatie (bijv. hoofdkantoor, niet in EPD)"
        aria-label="Naam nieuwe locatie"
        className="h-8 max-w-xs text-xs"
      />
      <Button type="submit" size="sm" variant="outline" disabled={naam.trim() === ""}>
        <MapPinPlus className="size-3.5" />
        Locatie toevoegen
      </Button>
    </form>
  );
}

export function MiddelenInventarisCard({ bronLocaties }: Readonly<{ bronLocaties: string[] }>) {
  const { state, removeLocatie } = useCareonMiddelen();

  const geregistreerd = new Map(state.inventaris.map((rij) => [rij.locatie, rij]));
  const rijen: InventarisRij[] = [
    // Bronlocaties eerst (met opgeslagen aantallen of nul), daarna de
    // handmatige/verdwenen locaties uit de registratie zelf.
    ...bronLocaties.map((locatie) => ({
      ...(geregistreerd.get(locatie) ?? { locatie, behandelkamers: 0, boeken: 0, diagnostiek: 0 }),
      inBron: true,
    })),
    ...state.inventaris.filter((rij) => !bronLocaties.includes(rij.locatie)).map((rij) => ({ ...rij, inBron: false })),
  ];

  return (
    <div className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 font-medium text-sm">
          Inventaris per locatie
          <CareonHandmatigBadge />
        </h2>
        <p className="text-muted-foreground text-xs">
          Locaties volgen automatisch de databron; extra locaties voeg je hieronder toe.
        </p>
      </div>
      <Card className="py-0">
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Locatie</TableHead>
                  {VELDEN.map((veld) => (
                    <TableHead key={veld.veld} className="text-right">
                      {veld.label}
                    </TableHead>
                  ))}
                  <TableHead className="w-10 pr-4" aria-label="Acties" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rijen.map((rij) => (
                  <TableRow key={rij.locatie}>
                    <TableCell className="pl-4">
                      <span className="flex items-center gap-2">
                        {rij.locatie}
                        {!rij.inBron && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            {rij.handmatig ? "handmatig" : "niet in databron"}
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    {VELDEN.map((veld) => (
                      <TableCell key={veld.veld} className="text-right">
                        <span className="inline-flex justify-end">
                          <AantalInput rij={rij} veld={veld.veld} label={veld.label} />
                        </span>
                      </TableCell>
                    ))}
                    <TableCell className="pr-4 text-right">
                      {!rij.inBron && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground"
                          aria-label={`Verwijder locatie ${rij.locatie}`}
                          onClick={() => removeLocatie(rij.locatie)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <LocatieToevoegen />
        </CardContent>
      </Card>
    </div>
  );
}
