"use client";

import Link from "next/link";

import { CareonBarList } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import {
  WACHTLIJST_BUCKETS,
  WACHTLIJST_PER_LOCATIE,
  WACHTLIJST_SUMMARY,
} from "@/data/careon/careon-dossiers-productie";
import { CAREON_ROUTES } from "@/data/careon/careon-pages";
import { formatCareonDelta } from "@/lib/careon-format";
import { cn } from "@/lib/utils";

const nlDec1 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const DELTA_TONE: Record<string, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  bad: "text-red-700 dark:text-red-400",
  neutral: "text-muted-foreground",
};

function WachtlijstStat({
  label,
  value,
  delta,
}: Readonly<{ label: string; value: string; delta?: { text: string; tone: string } }>) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="font-medium text-xl tabular-nums leading-none">{value}</span>
        {delta && <span className={cn("text-xs tabular-nums", DELTA_TONE[delta.tone])}>{delta.text}</span>}
      </p>
    </div>
  );
}

export function WachtlijstPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  const live = production ? production.dossiersProductie.wachtlijst : null;

  const totaal = live ? live.totaal : WACHTLIJST_SUMMARY.totaal;
  const urgent = live ? live.urgent : WACHTLIJST_SUMMARY.urgent;
  const gemWachttijd = live ? live.gemWachttijdWkn : WACHTLIJST_SUMMARY.gemWachttijdWkn;
  const buckets = live ? live.buckets : WACHTLIJST_BUCKETS;
  const perLocatie = live ? live.perLocatie : WACHTLIJST_PER_LOCATIE;

  // In productie is er (nog) geen historische wachtlijstmeting — geen delta's.
  const totaalDelta = live
    ? undefined
    : formatCareonDelta({
        value: WACHTLIJST_SUMMARY.totaal,
        prev: WACHTLIJST_SUMMARY.totaalPrev,
        f: "int",
        betterLow: true,
      });
  const urgentDelta = live
    ? undefined
    : formatCareonDelta({
        value: WACHTLIJST_SUMMARY.urgent,
        prev: WACHTLIJST_SUMMARY.urgentPrev,
        f: "int",
        betterLow: true,
      });
  const wachttijdDelta = live
    ? undefined
    : formatCareonDelta({
        value: WACHTLIJST_SUMMARY.gemWachttijdWkn,
        prev: WACHTLIJST_SUMMARY.gemWachttijdPrev,
        f: "dec1",
        betterLow: true,
      });

  const drukste = [...perLocatie].sort((a, b) => b.aantal - a.aantal)[0];

  return (
    <CareonChartCard
      title="Wachtlijst"
      sub="Intake + behandeling · wachttijd en spreiding"
      className={className}
      titleBadge={<CareonSourceBadge page="dossiersProductie" widget="Wachtlijst" />}
      footer={
        live ? (
          <span>
            Wachtduur gemeten sinds episodestart of verwijsdatum;{" "}
            {/* Ook met 0 wachtenden bevat perLocatie de locatierij — check het aantal. */}
            {drukste && drukste.aantal > 0 ? `${drukste.label} draagt de meeste wachtenden` : "nog geen wachtenden"} —
            zie{" "}
            <Link prefetch={false} href={CAREON_ROUTES.signaleringen} className="underline underline-offset-2">
              Signaleringen
            </Link>
            .
          </span>
        ) : (
          <span>
            Roermond overschrijdt de Treeknorm voor intake (15,2 wkn) — zie{" "}
            <Link prefetch={false} href={CAREON_ROUTES.signaleringen} className="underline underline-offset-2">
              Signaleringen
            </Link>
            .
          </span>
        )
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
          <WachtlijstStat label="Totaal wachtend" value={`${totaal}`} delta={totaalDelta} />
          <WachtlijstStat label="Urgent" value={`${urgent}`} delta={urgentDelta} />
          <WachtlijstStat
            label="Gem. wachttijd"
            value={gemWachttijd === null ? "—" : `${nlDec1.format(gemWachttijd)} wkn`}
            delta={wachttijdDelta}
          />
        </div>
        <div>
          <p className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Wachtduur</p>
          <CareonBarList
            items={buckets.map((bucket) => ({
              label: bucket.label,
              value: bucket.aantal,
              tone: bucket.label === "60+ dagen" ? "bad" : "default",
            }))}
          />
        </div>
        <div>
          <p className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Per locatie</p>
          <CareonBarList
            items={perLocatie.map((locatie) => ({
              label: locatie.label,
              value: locatie.aantal,
              tone: !live && locatie.label === "Roermond" ? "bad" : "default",
            }))}
          />
        </div>
        {/* Fase- en taalverdeling komen uit de wachtlijstlabels van de export —
            alleen in productie beschikbaar (demo kent deze detaildata niet). */}
        {live && live.fases.length > 0 && (
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
        {live && live.talen.length > 0 && (
          <p className="text-muted-foreground text-xs">
            Taal geregistreerd: {live.talen.map((taal) => `${taal.label} ${taal.aantal}`).join(" · ")} — relevant voor
            de inzet van anderstalige behandelaren.
          </p>
        )}
      </div>
    </CareonChartCard>
  );
}
