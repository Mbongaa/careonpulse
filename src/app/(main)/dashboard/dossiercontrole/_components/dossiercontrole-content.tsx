"use client";

import Link from "next/link";

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
import { careonDetailHref } from "@/data/careon/careon-kpi-details";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

import { demoKpiWaarde } from "../../details/_lib/kpi-demo-waarde";

const nl = new Intl.NumberFormat("nl-NL");
const nlDec1 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const SEV_BAR_TONE = { kritiek: "bad", hoog: "warn", middel: "accent" } as const;

export function DossiercontroleContent() {
  const { production, overrides, factor } = useCareon();

  // Eén tegel-definitie voor beide modi: alleen waarde en subtekst wisselen.
  const controle = production ? production.dossiercontrole : null;
  // Twee tegels dragen een cockpit-KPI ("Gecontroleerde dossiers" = actief,
  // "Niet compleet" = dossiersnc); die volgen in demo dezelfde rekenregel als
  // de cockpit- en drilldown-kaart, anders tonen ze onder een locatiefilter een
  // ander getal dan de detailpagina die ze openen. Compliance en de
  // dossierkwaliteitsscore zijn niet-schaalbaar en blijven dus ongewijzigd.
  const demoTegel = (detailId: string, waarde: number) =>
    demoKpiWaarde(detailId, { value: waarde, prev: null }, overrides, factor).value;
  // Elke tegel opent zijn KPI-drilldown (handoff 08); de tegel-opmaak zelf
  // blijft het geauditeerde origineel.
  const summaryTiles = [
    {
      label: "Dossier-compliance",
      value: `${nlDec1.format(controle ? controle.compliancePct : DOSSIER_SUMMARY.compliancePct)}%`,
      sub: controle ? "compleet (EPD-controles)" : "compleet",
      widget: "Dossier-compliance",
      detailId: "dossier-compliance",
    },
    {
      label: "Gecontroleerde dossiers",
      value: nl.format(controle ? controle.gecontroleerd : demoTegel("actief", DOSSIER_SUMMARY.gecontroleerd)),
      sub: "actieve dossiers",
      widget: "Gecontroleerde dossiers",
      detailId: "actief",
    },
    {
      label: "Niet compleet",
      value: nl.format(controle ? controle.nietCompleet : demoTegel("dossiersnc", DOSSIER_SUMMARY.nietCompleet)),
      sub: controle ? "mist diagnose, typering of verwijzer" : "kritieke items",
      widget: "Niet compleet",
      detailId: "dossiersnc",
    },
    {
      // Productie: zelfde registratie-compleetheidsscore als de Kwaliteit-
      // pagina (op 10) — geen inhoudelijke audit, dus zonder "(audit)".
      label: production ? "Dossierkwaliteit" : "Dossierkwaliteit (audit)",
      value: nlDec1.format(production ? production.kwaliteitDossierscore.value : DOSSIER_SUMMARY.auditScore),
      sub: production ? "van 10 · registratie-compleetheid" : "van 10",
      widget: "Dossierkwaliteit",
      detailId: "dossierkwaliteit",
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
            ? `${production.dossiercontrole.checks.length} controles zijn berekend uit de cliëntendata-export; aanvullende controles volgen zodra dossieritem-data beschikbaar is.`
            : "Twaalf controles worden bij iedere databronverversing op de actieve dossiers berekend."
        }
      />

      <CareonLiveBanner page="dossiers" />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {summaryTiles.map((tile) => (
          <Link
            key={tile.label}
            prefetch={false}
            href={careonDetailHref(tile.detailId)}
            aria-label={tile.label}
            className="block h-full rounded-xl outline-none"
          >
            <Card className="h-full py-4 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring">
              <CardContent className="flex flex-col gap-1 px-4">
                <CardDescription className="flex items-center gap-1.5 text-xs">
                  {tile.label}
                  <CareonSourceBadge page="dossiers" widget={tile.widget} />
                </CardDescription>
                <span className="font-medium text-2xl tabular-nums leading-none tracking-tight">{tile.value}</span>
                <span className="text-muted-foreground text-xs">{tile.sub}</span>
              </CardContent>
            </Card>
          </Link>
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
