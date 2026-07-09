import type { ReactNode } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type CellTone, caseloadTone } from "@/data/careon/careon-behandelaren";
import type { MedewerkerProductie } from "@/data/careon/careon-dossiers-productie";
import { cn, getInitials } from "@/lib/utils";

const nl = new Intl.NumberFormat("nl-NL");

const TONE_TEXT: Record<CellTone, string> = {
  bad: "text-red-700 dark:text-red-400 font-semibold",
  warn: "text-amber-700 dark:text-amber-400 font-medium",
  good: "text-emerald-700 dark:text-emerald-400",
  none: "",
};

function MedewerkerIdentity({ row }: Readonly<{ row: MedewerkerProductie }>) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar className="size-7">
        <AvatarFallback className="text-foreground text-xs">{getInitials(row.naam)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-medium leading-tight">{row.naam}</p>
        <p className="truncate text-muted-foreground text-xs">
          {row.team} · {row.loc}
        </p>
      </div>
    </div>
  );
}

function MobileMetric({ label, value, className }: Readonly<{ label: string; value: ReactNode; className?: string }>) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">{label}</dt>
      <dd className={cn("truncate text-sm tabular-nums", className)}>{value}</dd>
    </div>
  );
}

export function MedewerkerProductieTable({ rows }: Readonly<{ rows: MedewerkerProductie[] }>) {
  return (
    <Card className="py-0">
      <CardContent className="px-0">
        {/* Mobile: one compact card per medewerker instead of the wide table. */}
        <ul className="divide-y md:hidden">
          {rows.map((row) => (
            <li key={row.naam} className="space-y-3 p-4">
              <MedewerkerIdentity row={row} />
              <dl className="grid grid-cols-3 gap-x-3 gap-y-2.5">
                <MobileMetric
                  label="Open dossiers"
                  value={row.caseload}
                  className={TONE_TEXT[caseloadTone(row.caseload)]}
                />
                <MobileMetric label="Afsluitingen" value={row.afsluitingen} />
                <MobileMetric label="Prod. uren" value={nl.format(row.productieUren)} />
                <MobileMetric label="Declarabel" value={`${row.declU} u`} />
                <MobileMetric label="Indirect" value={`${row.indirU} u`} />
                <MobileMetric label="Product." value={`${row.productiviteit}%`} />
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
                <TableHead className="text-right">Afsluitingen</TableHead>
                <TableHead className="text-right">Productie-uren</TableHead>
                <TableHead className="text-right">Declarabel</TableHead>
                <TableHead className="text-right">Indirect</TableHead>
                <TableHead className="pr-4 text-right">Productiviteit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.naam}>
                  <TableCell className="pl-4">
                    <MedewerkerIdentity row={row} />
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", TONE_TEXT[caseloadTone(row.caseload)])}>
                    {row.caseload}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.afsluitingen}</TableCell>
                  <TableCell className="text-right tabular-nums">{nl.format(row.productieUren)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.declU} u</TableCell>
                  <TableCell className="text-right tabular-nums">{row.indirU} u</TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">{row.productiviteit}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
