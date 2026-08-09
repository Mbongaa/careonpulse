"use client";

import { useState } from "react";

import { useCareonHr } from "@/app/(main)/dashboard/_components/careon/careon-hr-provider";
import { CareonHandmatigBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HR_METRICS } from "@/data/careon/careon-hr";
import type { CareonKpiFormat } from "@/data/careon/careon-types";
import { formatCareonValue } from "@/lib/careon-format";
import { HR_KPI_RULES, type HrKpiId } from "@/lib/careon-hr/types";

// Kerncijfers bijwerken: huidige en vorige-maand-waarde per KPI. De delta op de
// kaarten hierboven wordt hieruit afgeleid. Meta (label, format, id) komt uit de
// geauditeerde HR_METRICS; alleen de waarden zijn handmatig.
const HELE_GETALLEN: CareonKpiFormat[] = ["int", "pct0"];

function stap(f: CareonKpiFormat): string {
  return HELE_GETALLEN.includes(f) ? "1" : "0.1";
}

function WaardeInput({
  id,
  veld,
  waarde,
  f,
  label,
}: Readonly<{ id: HrKpiId; veld: "value" | "prev"; waarde: number; f: CareonKpiFormat; label: string }>) {
  const { setKpi } = useCareonHr();
  // Tussenstanden tijdens het typen ("", "6,", "6.") zijn geen geldig getal.
  // Zonder eigen tekststaat werd zo'n toetsaanslag als 0 vastgelegd én centraal
  // gepusht, waardoor "6.2" eindigde als 2. De ruwe tekst blijft daarom lokaal
  // staan tot er een geldige waarde uit komt; bij verlaten van het veld valt de
  // invoer terug op de laatst opgeslagen waarde.
  const [ruw, setRuw] = useState<string | null>(null);

  return (
    <Input
      type="number"
      min={0}
      max={HR_KPI_RULES[id].max}
      step={stap(f)}
      value={ruw ?? String(waarde)}
      aria-label={`${label} — ${veld === "value" ? "huidige waarde" : "vorige maand"}`}
      className="h-8 w-28 text-right text-xs tabular-nums"
      onChange={(event) => {
        setRuw(event.target.value);
        const getal = event.target.valueAsNumber;
        if (Number.isFinite(getal)) {
          setKpi(id, veld, getal);
        }
      }}
      onBlur={() => setRuw(null)}
    />
  );
}

export function HrKpiEditor() {
  const { state } = useCareonHr();

  return (
    <div className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 font-medium text-sm">
          HR-kerncijfers bijwerken
          <CareonHandmatigBadge />
        </h2>
        <p className="text-muted-foreground text-xs">
          Vul de huidige en vorige-maand-waarde in; wijzigingen worden direct opgeslagen.
        </p>
      </div>
      <Card className="py-0">
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">KPI</TableHead>
                  <TableHead className="text-right">Huidige waarde</TableHead>
                  <TableHead className="text-right">Vorige maand</TableHead>
                  <TableHead className="pr-4 text-right">Nu getoond</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {HR_METRICS.map((meta) => {
                  const id = meta.detailId as HrKpiId;
                  const waarde = state.kpis[id];
                  return (
                    <TableRow key={meta.label}>
                      <TableCell className="pl-4 font-medium">{meta.label}</TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex justify-end">
                          <WaardeInput id={id} veld="value" waarde={waarde.value} f={meta.f} label={meta.label} />
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex justify-end">
                          <WaardeInput id={id} veld="prev" waarde={waarde.prev} f={meta.f} label={meta.label} />
                        </span>
                      </TableCell>
                      <TableCell className="pr-4 text-right text-muted-foreground tabular-nums">
                        {formatCareonValue(waarde.value, meta.f)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
