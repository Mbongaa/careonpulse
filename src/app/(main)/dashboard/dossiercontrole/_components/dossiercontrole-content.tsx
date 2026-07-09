import { MoonStar } from "lucide-react";

import { CareonBar } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { CareonSeverityBadge } from "@/app/(main)/dashboard/_components/careon/careon-severity";
import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DOSSIER_CHECKS, DOSSIER_SUMMARY } from "@/data/careon/careon-dossiercontrole";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";

const nl = new Intl.NumberFormat("nl-NL");
const nlDec1 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const SUMMARY_TILES = [
  { label: "Dossier-compliance", value: `${nlDec1.format(DOSSIER_SUMMARY.compliancePct)}%`, sub: "compleet" },
  { label: "Gecontroleerde dossiers", value: nl.format(DOSSIER_SUMMARY.gecontroleerd), sub: "actieve dossiers" },
  { label: "Niet compleet", value: `${DOSSIER_SUMMARY.nietCompleet}`, sub: "kritieke items" },
  { label: "Dossierkwaliteit (audit)", value: nlDec1.format(DOSSIER_SUMMARY.auditScore), sub: "van 10" },
];

const maxCheck = Math.max(...DOSSIER_CHECKS.map((check) => check.n));

const SEV_BAR_TONE = { kritiek: "bad", hoog: "warn", middel: "accent" } as const;

export function DossiercontroleContent() {
  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader
        title={CAREON_PAGE_META.dossiers.title}
        sub="Twaalf automatische controles draaien elke nacht op alle actieve dossiers."
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {SUMMARY_TILES.map((tile) => (
          <Card key={tile.label} className="py-4">
            <CardContent className="flex flex-col gap-1 px-4">
              <CardDescription className="text-xs">{tile.label}</CardDescription>
              <span className="font-medium text-2xl tabular-nums leading-none tracking-tight">{tile.value}</span>
              <span className="text-muted-foreground text-xs">{tile.sub}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="flex items-center gap-2 text-muted-foreground text-sm">
        <MoonStar className="size-4" />
        Laatste controle {DOSSIER_SUMMARY.laatsteCheck} · volgende controle {DOSSIER_SUMMARY.volgendeCheck}
      </p>

      <CareonChartCard title="Open actiepunten per controle" sub="Aantal dossiers waar het item ontbreekt">
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
            {DOSSIER_CHECKS.map((check) => (
              <TableRow key={check.check}>
                <TableCell className="whitespace-normal font-medium">{check.check}</TableCell>
                <TableCell className="text-right tabular-nums">{check.n}</TableCell>
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
