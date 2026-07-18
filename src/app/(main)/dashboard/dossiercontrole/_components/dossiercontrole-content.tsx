"use client";

import { Database, MoonStar } from "lucide-react";

import { CareonBar } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonLiveBanner } from "@/app/(main)/dashboard/_components/careon/careon-live-banner";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSeverityBadge } from "@/app/(main)/dashboard/_components/careon/careon-severity";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DOSSIER_CHECKS, DOSSIER_SUMMARY } from "@/data/careon/careon-dossiercontrole";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

const nl = new Intl.NumberFormat("nl-NL");
const nlDec1 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const SEV_BAR_TONE = { kritiek: "bad", hoog: "warn", middel: "accent" } as const;

export function DossiercontroleContent() {
  const { production } = useCareon();

  // Eén tegel-definitie voor beide modi: alleen waarde en subtekst wisselen.
  const controle = production ? production.dossiercontrole : null;
  const summaryTiles = [
    {
      label: "Dossier-compliance",
      value: `${nlDec1.format(controle ? controle.compliancePct : DOSSIER_SUMMARY.compliancePct)}%`,
      sub: controle ? "compleet (EPD-controles)" : "compleet",
      widget: "Dossier-compliance",
    },
    {
      label: "Gecontroleerde dossiers",
      value: nl.format(controle ? controle.gecontroleerd : DOSSIER_SUMMARY.gecontroleerd),
      sub: "actieve dossiers",
      widget: "Gecontroleerde dossiers",
    },
    {
      label: "Niet compleet",
      value: nl.format(controle ? controle.nietCompleet : DOSSIER_SUMMARY.nietCompleet),
      sub: controle ? "mist diagnose, typering of verwijzer" : "kritieke items",
      widget: "Niet compleet",
    },
    {
      label: "Dossierkwaliteit (audit)",
      value: nlDec1.format(DOSSIER_SUMMARY.auditScore),
      sub: "van 10",
      widget: "Dossierkwaliteit",
    },
  ];

  const checks = production ? production.dossiercontrole.checks : DOSSIER_CHECKS;
  const maxCheck = Math.max(1, ...checks.map((check) => check.n));

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader
        title={CAREON_PAGE_META.dossiers.title}
        sub={
          production
            ? "Drie controles zijn berekend uit de cliëntendata-export; de overige negen volgen zodra dossieritem-data beschikbaar is."
            : "Twaalf automatische controles draaien elke nacht op alle actieve dossiers."
        }
      />

      <CareonLiveBanner page="dossiers" />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {summaryTiles.map((tile) => (
          <Card key={tile.label} className="py-4">
            <CardContent className="flex flex-col gap-1 px-4">
              <CardDescription className="flex items-center gap-1.5 text-xs">
                {tile.label}
                <CareonSourceBadge page="dossiers" widget={tile.widget} />
              </CardDescription>
              <span className="font-medium text-2xl tabular-nums leading-none tracking-tight">{tile.value}</span>
              <span className="text-muted-foreground text-xs">{tile.sub}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {production ? (
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <Database className="size-4" />
          Controles uitgevoerd op import {production.meta.fileName} · referentiedatum {production.meta.referenceDate}
        </p>
      ) : (
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <MoonStar className="size-4" />
          Laatste controle {DOSSIER_SUMMARY.laatsteCheck} · volgende controle {DOSSIER_SUMMARY.volgendeCheck}
        </p>
      )}

      <CareonChartCard
        title="Open actiepunten per controle"
        sub={
          production
            ? "Controles op basis van de EPD-export; overige controles volgen met dossieritem-data"
            : "Aantal dossiers waar het item ontbreekt"
        }
        titleBadge={<CareonSourceBadge page="dossiers" widget="Open actiepunten" />}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Controle</TableHead>
              <TableHead className="w-14 text-right md:w-24">Dossiers</TableHead>
              {/* The size bar is desktop-only; on mobile name + count + urgency must fit the viewport. */}
              <TableHead className="hidden w-40 md:table-cell">Omvang</TableHead>
              <TableHead className="w-20 md:w-28">Urgentie</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {checks.map((check) => (
              <TableRow key={check.check}>
                <TableCell className="whitespace-normal font-medium">{check.check}</TableCell>
                <TableCell className="text-right tabular-nums">{nl.format(check.n)}</TableCell>
                <TableCell className="hidden md:table-cell">
                  <CareonBar pct={(check.n / maxCheck) * 100} tone={SEV_BAR_TONE[check.sev]} />
                </TableCell>
                <TableCell>
                  <CareonSeverityBadge sev={check.sev} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CareonChartCard>
    </div>
  );
}
