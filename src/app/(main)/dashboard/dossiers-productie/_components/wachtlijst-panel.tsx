"use client";

import Link from "next/link";

import { CareonBarList } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { CAREON_ROUTES } from "@/data/careon/careon-pages";

// Productie-exclusief sinds de Claude Design-handoff "Dossiers en Productie":
// in demo is dit paneel geschrapt (totaal en urgent staan al in de KPI-strip,
// de verdieping in de drill-downs); met een actieve EPD-import toont het de
// echte wachtduur-, locatie-, fase- en taalverdeling.

const nlDec1 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function WachtlijstStat({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-medium text-xl tabular-nums leading-none">{value}</p>
    </div>
  );
}

export function WachtlijstPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  if (!production) {
    return null;
  }

  const live = production.dossiersProductie.wachtlijst;
  const drukste = [...live.perLocatie].sort((a, b) => b.aantal - a.aantal)[0];

  return (
    <CareonChartCard
      title="Wachtlijst"
      sub="Intake + behandeling · wachttijd en spreiding"
      className={className}
      titleBadge={<CareonSourceBadge page="dossiersProductie" widget="Wachtlijst" />}
      footer={
        <span>
          Wachtduur gemeten sinds episodestart of verwijsdatum;{" "}
          {/* Ook met 0 wachtenden bevat perLocatie de locatierij — check het aantal. */}
          {drukste && drukste.aantal > 0 ? `${drukste.label} draagt de meeste wachtenden` : "nog geen wachtenden"} — zie{" "}
          <Link prefetch={false} href={CAREON_ROUTES.signaleringen} className="underline underline-offset-2">
            Signaleringen
          </Link>
          .
        </span>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
          <WachtlijstStat label="Totaal wachtend" value={`${live.totaal}`} />
          <WachtlijstStat label="Urgent" value={`${live.urgent}`} />
          <WachtlijstStat
            label="Gem. wachttijd"
            value={live.gemWachttijdWkn === null ? "—" : `${nlDec1.format(live.gemWachttijdWkn)} wkn`}
          />
        </div>
        <div>
          <p className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Wachtduur</p>
          <CareonBarList
            items={live.buckets.map((bucket) => ({
              label: bucket.label,
              value: bucket.aantal,
              tone: bucket.label === "60+ dagen" ? "bad" : "default",
            }))}
          />
        </div>
        <div>
          <p className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Per locatie</p>
          <CareonBarList
            items={live.perLocatie.map((locatie) => ({
              label: locatie.label,
              value: locatie.aantal,
            }))}
          />
        </div>
        {/* Fase- en taalverdeling komen uit de wachtlijstlabels van de export. */}
        {live.fases.length > 0 && (
          <div>
            <p className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Per fase</p>
            <CareonBarList
              items={live.fases.map((fase) => ({
                label: fase.label,
                value: fase.aantal,
                tone: fase.label === "Behandeling" ? "accent" : "default",
              }))}
            />
          </div>
        )}
        {live.talen.length > 0 && (
          <p className="text-muted-foreground text-xs">
            Taal geregistreerd: {live.talen.map((taal) => `${taal.label} ${taal.aantal}`).join(" · ")} — relevant voor
            de inzet van anderstalige behandelaren.
          </p>
        )}
      </div>
    </CareonChartCard>
  );
}
