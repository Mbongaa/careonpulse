"use client";

import { CareonPersonCell, CELL_TONE_TEXT } from "@/app/(main)/dashboard/_components/careon/careon-table-cells";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { caseloadTone, ncTone } from "@/data/careon/careon-behandelaren";
import { cn } from "@/lib/utils";

// Productie-variant van de medewerkerstabel: alleen kolommen die uit de
// cliëntendata-export berekend kunnen worden. Uren/productiviteit volgen
// zodra de urenregistratie-export gekoppeld is (bewust geen demo-kolommen
// tussen echte kolommen — geen gemengde herkomst binnen één tabelrij).

export interface MedewerkerLiveRij {
  naam: string;
  loc: string;
  caseload: number;
  afsluitingen: number;
  nc: number;
}

export function MedewerkerProductieLiveTable({ rows }: Readonly<{ rows: MedewerkerLiveRij[] }>) {
  return (
    <Card className="py-0">
      <CardContent className="px-0">
        <ul className="divide-y md:hidden">
          {rows.map((row) => (
            <li key={row.naam} className="space-y-3 p-4">
              <CareonPersonCell naam={row.naam} sub={row.loc} />
              <dl className="grid grid-cols-3 gap-x-3 gap-y-2.5">
                <div className="min-w-0">
                  <dt className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">Open dossiers</dt>
                  <dd className={cn("truncate text-sm tabular-nums", CELL_TONE_TEXT[caseloadTone(row.caseload)])}>
                    {row.caseload}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">Afsluitingen</dt>
                  <dd className="truncate text-sm tabular-nums">{row.afsluitingen}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">Z. diagnose</dt>
                  <dd className={cn("truncate text-sm tabular-nums", CELL_TONE_TEXT[ncTone(row.nc)])}>{row.nc}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>

        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Medewerker</TableHead>
                <TableHead className="text-right">Open dossiers</TableHead>
                <TableHead className="text-right">Afsluitingen (laatste maand)</TableHead>
                <TableHead className="pr-4 text-right">Dossiers zonder diagnose</TableHead>
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
                  <TableCell className="text-right tabular-nums">{row.afsluitingen}</TableCell>
                  <TableCell className={cn("pr-4 text-right tabular-nums", CELL_TONE_TEXT[ncTone(row.nc)])}>
                    {row.nc}
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
