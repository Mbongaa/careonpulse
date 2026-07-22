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
import { caseloadTone, ncTone, noshowTone } from "@/data/careon/careon-behandelaren";
import type { ProductionAgendaSnapshot } from "@/lib/careon-production/types";
import { cn } from "@/lib/utils";

// Productie-variant van de behandelarentabel. Basis: kolommen uit de
// cliëntendata-export (caseload, dossiers zonder diagnose, cumulatieve tijd).
// Mét agenda-import komen daar consulten, no-show, 12-maands-uren en omzet
// bij; ROM en tevredenheid vergen de ROM-export.

const nl = new Intl.NumberFormat("nl-NL");

export interface BehandelaarLiveRij {
  naam: string;
  loc: string;
  caseload: number;
  nc: number;
  directeTijdUren: number;
  totaleTijdUren: number;
}

type AgendaStats = ProductionAgendaSnapshot["behandelaarStats"];

function LivePersoon({ row }: Readonly<{ row: BehandelaarLiveRij }>) {
  // Handmatig geregistreerde functie (Medewerkers & middelen) vóór de vestiging.
  const functie = useMedewerkerFunctie(row.naam);
  return <CareonPersonCell naam={row.naam} sub={functie ? `${functie} · ${row.loc}` : row.loc} />;
}

function noshowCel(pct: number | null | undefined): { tekst: string; klasse: string } {
  if (pct === null || pct === undefined) return { tekst: "—", klasse: "text-muted-foreground" };
  return { tekst: `${String(pct).replace(".", ",")}%`, klasse: CELL_TONE_TEXT[noshowTone(pct)] };
}

export function BehandelarenLiveTable({
  rows,
  agendaStats = null,
}: Readonly<{ rows: BehandelaarLiveRij[]; agendaStats?: AgendaStats | null }>) {
  const metAgenda = agendaStats !== null;

  return (
    <Card className="py-0">
      <CardContent className="px-0">
        <ul className="divide-y md:hidden">
          {rows.map((row) => {
            const stats = agendaStats?.[row.naam];
            const noshow = noshowCel(stats?.noShowPct);
            return (
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
                  {metAgenda ? (
                    <>
                      <div className="min-w-0">
                        <dt className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">
                          Consulten 12m
                        </dt>
                        <dd className="truncate text-sm tabular-nums">{stats ? nl.format(stats.sessies) : "—"}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">No-show</dt>
                        <dd className={cn("truncate text-sm tabular-nums", noshow.klasse)}>{noshow.tekst}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">Uren 12m</dt>
                        <dd className="truncate text-sm tabular-nums">
                          {stats ? `${nl.format(stats.totaleUren)} u` : "—"}
                        </dd>
                      </div>
                    </>
                  ) : (
                    <div className="min-w-0">
                      <dt className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">
                        Tijd (totaal)
                      </dt>
                      <dd className="truncate text-sm tabular-nums">{nl.format(row.totaleTijdUren)} u</dd>
                    </div>
                  )}
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
            );
          })}
        </ul>

        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Behandelaar</TableHead>
                <TableHead className="text-right">Caseload</TableHead>
                <TableHead className="text-right">Dossiers zonder diagnose</TableHead>
                {metAgenda ? (
                  <>
                    <TableHead className="text-right">Consulten (12m)</TableHead>
                    <TableHead className="text-right">No-show</TableHead>
                    <TableHead className="text-right">Uren 12m (direct)</TableHead>
                    <TableHead className="text-right">Omzet 12m</TableHead>
                  </>
                ) : (
                  <>
                    <TableHead className="text-right">Directe tijd</TableHead>
                    <TableHead className="text-right">Geregistreerde tijd (totaal)</TableHead>
                  </>
                )}
                <TableHead className="text-right">Talen</TableHead>
                <TableHead className="text-right">Teams</TableHead>
                <TableHead className="pr-4 text-right">Middelen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const stats = agendaStats?.[row.naam];
                const noshow = noshowCel(stats?.noShowPct);
                return (
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
                    {metAgenda ? (
                      <>
                        <TableCell className="text-right tabular-nums">
                          {stats ? nl.format(stats.sessies) : "—"}
                        </TableCell>
                        <TableCell className={cn("text-right tabular-nums", noshow.klasse)}>{noshow.tekst}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {stats ? `${nl.format(stats.directeUren)} u` : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {stats ? `€ ${nl.format(stats.omzet)}` : "—"}
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="text-right tabular-nums">{nl.format(row.directeTijdUren)} u</TableCell>
                        <TableCell className="text-right tabular-nums">{nl.format(row.totaleTijdUren)} u</TableCell>
                      </>
                    )}
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
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
