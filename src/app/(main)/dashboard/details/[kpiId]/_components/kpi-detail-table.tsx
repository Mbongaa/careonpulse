"use client";

import { useState } from "react";

import { ExternalLink } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { KpiDetailRow } from "@/data/careon/careon-detail-records";
import type { KpiDetailColumn } from "@/data/careon/careon-kpi-details";
import { cn, getInitials } from "@/lib/utils";

const nl = new Intl.NumberFormat("nl-NL");
const nlDec1 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const PAGE_SIZE = 50;

const TONE_TEXT = {
  bad: "text-red-700 dark:text-red-400 font-semibold",
  warn: "text-amber-700 dark:text-amber-400 font-medium",
  none: "",
};

function cellTone(column: KpiDetailColumn, row: KpiDetailRow): keyof typeof TONE_TEXT {
  if (!column.tone) {
    return "none";
  }
  const value = Number(row[column.key] ?? 0);
  if (value >= column.tone.bad) {
    return "bad";
  }
  if (value >= column.tone.warn) {
    return "warn";
  }
  return "none";
}

function formatCell(column: KpiDetailColumn, row: KpiDetailRow): string {
  const raw = row[column.key];
  if (raw === null || raw === undefined || raw === "") {
    return "—";
  }
  switch (column.format) {
    case "int":
      return nl.format(Number(raw));
    case "eur":
      return `€ ${nl.format(Number(raw))}`;
    case "dec1":
      return nlDec1.format(Number(raw));
    case "pct":
      return `${nlDec1.format(Number(raw))}%`;
    case "pct0":
      return `${nl.format(Number(raw))}%`;
    default:
      return String(raw);
  }
}

// Identiteitscellen zoals de behandelaren-tabel: naam met contextregel eronder.
function IdentityCell({ column, row }: Readonly<{ column: KpiDetailColumn; row: KpiDetailRow }>) {
  const naam = String(row.naam ?? row.key);
  const sub = column.format === "person" ? [row.team, row.loc] : [row.key === naam ? null : row.key, row.team];
  return (
    <div className="flex items-center gap-2.5">
      <Avatar className="size-7">
        <AvatarFallback className="text-foreground text-xs">{getInitials(naam)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-medium leading-tight">{naam}</p>
        <p className="truncate text-muted-foreground text-xs">{sub.filter(Boolean).join(" · ")}</p>
      </div>
    </div>
  );
}

function CellContent({ column, row }: Readonly<{ column: KpiDetailColumn; row: KpiDetailRow }>) {
  if (column.format === "client" || column.format === "person") {
    return <IdentityCell column={column} row={row} />;
  }
  if (column.format === "link") {
    const href = row[column.key];
    if (typeof href !== "string" || !href.startsWith("https://")) {
      return <span className="text-muted-foreground">—</span>;
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
      >
        Dossier
        <ExternalLink className="size-3" aria-hidden />
      </a>
    );
  }
  return <>{formatCell(column, row)}</>;
}

export function KpiDetailTable({
  rows,
  columns,
  caption,
  note,
}: Readonly<{ rows: KpiDetailRow[]; columns: KpiDetailColumn[]; caption: string; note?: string }>) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const dataRows = rows.filter((row) => row.rowKind !== "total");
  const totalRows = rows.filter((row) => row.rowKind === "total");
  // Samenvattingsrijen blijven altijd als laatste zichtbaar, onafhankelijk van
  // de paginering van de onderliggende maand- of recordregels.
  const shown = [...dataRows.slice(0, visible), ...totalRows];
  const identityColumn = columns.find((c) => c.format === "client" || c.format === "person");
  const mobileColumns = columns.filter((c) => c !== identityColumn && !c.hideOnMobile);

  return (
    <Card className="py-0">
      <CardContent className="px-0">
        <p className="border-b px-4 py-3 text-muted-foreground text-xs">{caption}</p>

        {/* Een KPI mag legitiem nul records hebben (filter, of niets te melden);
            kale kolomkoppen lezen dan als een laadfout. */}
        {dataRows.length === 0 && (
          <p className="px-4 py-8 text-center text-muted-foreground text-sm">
            Geen records voor deze selectie — er zijn geen onderliggende regels bij dit cijfer.
          </p>
        )}

        {/* Mobiel: één compacte kaart per record in plaats van de brede tabel. */}
        <ul className={cn("divide-y md:hidden", dataRows.length === 0 && "hidden")}>
          {shown.map((row) => (
            <li key={row.key} className={cn("space-y-3 p-4", row.rowKind === "total" && "bg-muted/60 font-semibold")}>
              {identityColumn ? (
                <IdentityCell column={identityColumn} row={row} />
              ) : (
                <p className="font-medium leading-tight">{String(row[columns[0].key] ?? row.key)}</p>
              )}
              <dl className="grid grid-cols-3 gap-x-3 gap-y-2.5">
                {mobileColumns.map((column) => (
                  <div key={column.key} className="min-w-0">
                    <dt className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">
                      {column.header}
                    </dt>
                    <dd className={cn("truncate text-sm tabular-nums", TONE_TEXT[cellTone(column, row)])}>
                      <CellContent column={column} row={row} />
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>

        <div className={cn("hidden", dataRows.length > 0 && "md:block")}>
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column, index) => (
                  <TableHead
                    key={column.key}
                    className={cn(
                      index === 0 && "pl-4",
                      index === columns.length - 1 && "pr-4",
                      column.align === "right" && "text-right",
                    )}
                  >
                    {column.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => (
                <TableRow
                  key={row.key}
                  className={cn(row.rowKind === "total" && "border-t-2 bg-muted/60 font-semibold hover:bg-muted/60")}
                >
                  {columns.map((column, index) => (
                    <TableCell
                      key={column.key}
                      className={cn(
                        index === 0 && "pl-4",
                        index === columns.length - 1 && "pr-4",
                        column.align === "right" && "text-right tabular-nums",
                        TONE_TEXT[cellTone(column, row)],
                      )}
                    >
                      <CellContent column={column} row={row} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {(dataRows.length > visible || note) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
            {note ? <p className="text-muted-foreground text-xs">{note}</p> : <span />}
            {dataRows.length > visible && (
              <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                Toon {Math.min(PAGE_SIZE, dataRows.length - visible)} meer ({nl.format(dataRows.length - visible)}{" "}
                resterend)
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
