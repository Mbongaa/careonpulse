import type { ReactNode } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Behandelaar, type CellTone, caseloadTone, ncTone, noshowTone } from "@/data/careon/careon-behandelaren";
import { cn, getInitials } from "@/lib/utils";

const nl = new Intl.NumberFormat("nl-NL");
const nlDec1 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const TONE_TEXT: Record<CellTone, string> = {
  bad: "text-red-700 dark:text-red-400 font-semibold",
  warn: "text-amber-700 dark:text-amber-400 font-medium",
  good: "text-emerald-700 dark:text-emerald-400",
  none: "",
};

function BehandelaarIdentity({ row }: Readonly<{ row: Behandelaar }>) {
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

export function BehandelarenTable({ rows }: Readonly<{ rows: Behandelaar[] }>) {
  return (
    <Card className="py-0">
      <CardContent className="px-0">
        {/* Mobile: one compact card per behandelaar instead of the wide table. */}
        <ul className="divide-y md:hidden">
          {rows.map((row) => (
            <li key={row.naam} className="space-y-3 p-4">
              <BehandelaarIdentity row={row} />
              <dl className="grid grid-cols-3 gap-x-3 gap-y-2.5">
                <MobileMetric label="Caseload" value={row.caseload} className={TONE_TEXT[caseloadTone(row.caseload)]} />
                <MobileMetric label="Consulten" value={row.consulten} />
                <MobileMetric
                  label="No-show"
                  value={`${nlDec1.format(row.noshow)}%`}
                  className={TONE_TEXT[noshowTone(row.noshow)]}
                />
                <MobileMetric label="Product." value={`${row.productiviteit}%`} />
                <MobileMetric label="Decl. uren" value={`${row.declU} / ${row.indirU} ind.`} />
                <MobileMetric label="Omzet" value={`€ ${nl.format(row.omzet)}`} />
                <MobileMetric label="ROM" value={nlDec1.format(row.rom)} />
                <MobileMetric label="Dossiers NC" value={row.nc} className={TONE_TEXT[ncTone(row.nc)]} />
                <MobileMetric label="Tevr." value={nlDec1.format(row.tevr)} />
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
                <TableHead className="text-right">Consulten</TableHead>
                <TableHead className="text-right">No-show</TableHead>
                <TableHead className="text-right">Productiviteit</TableHead>
                <TableHead className="text-right">Decl. uren</TableHead>
                <TableHead className="text-right">Omzet</TableHead>
                <TableHead className="text-right">ROM</TableHead>
                <TableHead className="text-right">Dossiers NC</TableHead>
                <TableHead className="pr-4 text-right">Tevredenheid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.naam}>
                  <TableCell className="pl-4">
                    <BehandelaarIdentity row={row} />
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", TONE_TEXT[caseloadTone(row.caseload)])}>
                    {row.caseload}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.consulten}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", TONE_TEXT[noshowTone(row.noshow)])}>
                    {nlDec1.format(row.noshow)}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.productiviteit}%</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.declU} / {row.indirU} ind.
                  </TableCell>
                  <TableCell className="text-right tabular-nums">€ {nl.format(row.omzet)}</TableCell>
                  <TableCell className="text-right tabular-nums">{nlDec1.format(row.rom)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", TONE_TEXT[ncTone(row.nc)])}>{row.nc}</TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">{nlDec1.format(row.tevr)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
