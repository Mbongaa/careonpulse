"use client";

import {
  CareonMedewerkerTalen,
  CareonMedewerkerTeams,
  CareonMiddelenBadges,
  useMedewerkerFunctie,
} from "@/app/(main)/dashboard/_components/careon/careon-middelen-badges";
import { CareonPersonCell, CELL_TONE_TEXT } from "@/app/(main)/dashboard/_components/careon/careon-table-cells";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { caseloadTone, ncTone } from "@/data/careon/careon-behandelaren";
import { cn } from "@/lib/utils";

// Productie-variant van de behandelarentabel: alleen kolommen die uit de
// cliëntendata-export volgen (caseload, dossiers zonder diagnose, cumulatief
// geregistreerde tijd). Consulten, no-show, productiviteit, omzet, ROM en
// tevredenheid volgen zodra de bijbehorende exports gekoppeld zijn.

const nl = new Intl.NumberFormat("nl-NL");

export interface BehandelaarLiveRij {
  naam: string;
  loc: string;
  caseload: number;
  nc: number;
  directeTijdUren: number;
  totaleTijdUren: number;
}

function LivePersoon({ row }: Readonly<{ row: BehandelaarLiveRij }>) {
  // Handmatig geregistreerde functie (Medewerkers & middelen) vóór de vestiging.
  const functie = useMedewerkerFunctie(row.naam);
  return <CareonPersonCell naam={row.naam} sub={functie ? `${functie} · ${row.loc}` : row.loc} />;
}

export function BehandelarenLiveTable({ rows }: Readonly<{ rows: BehandelaarLiveRij[] }>) {
  return (
    <Card className="py-0">
      <CardContent className="px-0">
        <ul className="divide-y md:hidden">
          {rows.map((row) => (
            <li key={row.naam} className="space-y-3 p-4">
              <LivePersoon row={row} />
              <dl className="grid grid-cols-3 gap-x-3 gap-y-2.5">
                <div className="min-w-0">
                  <dt className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">Caseload</dt>
                  <dd className={cn("truncate text-sm tabular-nums", CELL_TONE_TEXT[caseloadTone(row.caseload)])}>
                    {row.caseload}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">Z. diagnose</dt>
                  <dd className={cn("truncate text-sm tabular-nums", CELL_TONE_TEXT[ncTone(row.nc)])}>{row.nc}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">Tijd (totaal)</dt>
                  <dd className="truncate text-sm tabular-nums">{nl.format(row.totaleTijdUren)} u</dd>
                </div>
                <div className="min-w-0">
                  <dt className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">Talen</dt>
                  <dd className="truncate text-sm">
                    <CareonMedewerkerTalen naam={row.naam} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">Teams</dt>
                  <dd className="truncate text-sm">
                    <CareonMedewerkerTeams naam={row.naam} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">Middelen</dt>
                  <dd className="truncate text-sm">
                    <CareonMiddelenBadges naam={row.naam} />
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>

        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Behandelaar</TableHead>
                <TableHead className="text-right">Caseload</TableHead>
                <TableHead className="text-right">Dossiers zonder diagnose</TableHead>
                <TableHead className="text-right">Directe tijd</TableHead>
                <TableHead className="text-right">Geregistreerde tijd (totaal)</TableHead>
                <TableHead className="text-right">Talen</TableHead>
                <TableHead className="text-right">Teams</TableHead>
                <TableHead className="pr-4 text-right">Middelen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.naam}>
                  <TableCell className="pl-4">
                    <LivePersoon row={row} />
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", CELL_TONE_TEXT[caseloadTone(row.caseload)])}>
                    {row.caseload}
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", CELL_TONE_TEXT[ncTone(row.nc)])}>
                    {row.nc}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{nl.format(row.directeTijdUren)} u</TableCell>
                  <TableCell className="text-right tabular-nums">{nl.format(row.totaleTijdUren)} u</TableCell>
                  <TableCell className="max-w-36 truncate text-right">
                    <CareonMedewerkerTalen naam={row.naam} />
                  </TableCell>
                  <TableCell className="max-w-36 truncate text-right">
                    <CareonMedewerkerTeams naam={row.naam} />
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <CareonMiddelenBadges naam={row.naam} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
