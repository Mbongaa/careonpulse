"use client";

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

export function BehandelarenLiveTable({ rows }: Readonly<{ rows: BehandelaarLiveRij[] }>) {
  return (
    <Card className="py-0">
      <CardContent className="px-0">
        <ul className="divide-y md:hidden">
          {rows.map((row) => (
            <li key={row.naam} className="space-y-3 p-4">
              <CareonPersonCell naam={row.naam} sub={row.loc} />
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
                <TableHead className="pr-4 text-right">Geregistreerde tijd (totaal)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.naam}>
                  <TableCell className="pl-4">
                    <CareonPersonCell naam={row.naam} sub={row.loc} />
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", CELL_TONE_TEXT[caseloadTone(row.caseload)])}>
                    {row.caseload}
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", CELL_TONE_TEXT[ncTone(row.nc)])}>
                    {row.nc}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{nl.format(row.directeTijdUren)} u</TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">{nl.format(row.totaleTijdUren)} u</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
