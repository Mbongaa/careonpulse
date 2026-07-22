"use client";

import { CareonBarList } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Productie-exclusief paneel (huisarts/verwijzer-export): het verwijsnetwerk
// met praktijkplaats, rol en Zorgmail-aansluiting. Rendert null zonder import
// zodat demo-modus pixel-identiek blijft.

const nl = new Intl.NumberFormat("nl-NL");

export function VerwijsnetwerkPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  const netwerk = production?.verwijzerNetwerk ?? null;
  if (!netwerk) {
    return null;
  }

  const top = netwerk.contacten.slice(0, 8);

  return (
    <CareonChartCard
      title="Verwijsnetwerk"
      sub={`${nl.format(netwerk.contacten.length)} verwijzers · ${nl.format(netwerk.clienten)} cliëntkoppelingen · ${netwerk.zorgmailPct}% met Zorgmail`}
      className={className}
      titleBadge={<CareonSourceBadge page="dossiersProductie" widget="Verwijsnetwerk" />}
      footer="Bron: huisarts/verwijzer-export (AGB-code als sleutel). Zorgmail-aansluiting bepaalt of terugkoppeling digitaal kan."
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Verwijzer</TableHead>
                <TableHead>Plaats</TableHead>
                <TableHead className="text-right">Cliënten</TableHead>
                <TableHead className="text-right">Zorgmail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((contact) => (
                <TableRow key={contact.agb ?? contact.naam}>
                  <TableCell className="max-w-64">
                    <p className="truncate font-medium">{contact.naam}</p>
                    <p className="truncate text-muted-foreground text-xs">{contact.rol}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{contact.plaats ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{nl.format(contact.clienten)}</TableCell>
                  <TableCell className="text-right">
                    {contact.zorgmail ? (
                      <Badge variant="outline" className="border-emerald-600/40 text-emerald-700 dark:text-emerald-400">
                        Ja
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-600/40 text-amber-700 dark:text-amber-400">
                        Nee
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-col gap-6 lg:col-span-5">
          <div>
            <p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Herkomst (cliënten per praktijkplaats)
            </p>
            <CareonBarList
              items={netwerk.plaatsen.map((groep) => ({
                label: groep.label,
                value: groep.aantal,
                display: nl.format(groep.aantal),
              }))}
            />
          </div>
          <div>
            <p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Rol van de verwijzer
            </p>
            <CareonBarList
              items={netwerk.rollen.map((groep) => ({
                label: groep.label,
                value: groep.aantal,
                display: nl.format(groep.aantal),
              }))}
            />
          </div>
        </div>
      </div>
    </CareonChartCard>
  );
}
