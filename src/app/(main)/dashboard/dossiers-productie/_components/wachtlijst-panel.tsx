import Link from "next/link";

import { CareonBarList } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
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
  const totaalDelta = formatCareonDelta({
    value: WACHTLIJST_SUMMARY.totaal,
    prev: WACHTLIJST_SUMMARY.totaalPrev,
    f: "int",
    betterLow: true,
  });
  const urgentDelta = formatCareonDelta({
    value: WACHTLIJST_SUMMARY.urgent,
    prev: WACHTLIJST_SUMMARY.urgentPrev,
    f: "int",
    betterLow: true,
  });
  const wachttijdDelta = formatCareonDelta({
    value: WACHTLIJST_SUMMARY.gemWachttijdWkn,
    prev: WACHTLIJST_SUMMARY.gemWachttijdPrev,
    f: "dec1",
    betterLow: true,
  });

  return (
    <CareonChartCard
      title="Wachtlijst"
      sub="Intake + behandeling · wachttijd en spreiding"
      className={className}
      footer={
        <span>
          Roermond overschrijdt de Treeknorm voor intake (15,2 wkn) — zie{" "}
          <Link prefetch={false} href={CAREON_ROUTES.signaleringen} className="underline underline-offset-2">
            Signaleringen
          </Link>
          .
        </span>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
          <WachtlijstStat label="Totaal wachtend" value={`${WACHTLIJST_SUMMARY.totaal}`} delta={totaalDelta} />
          <WachtlijstStat label="Urgent" value={`${WACHTLIJST_SUMMARY.urgent}`} delta={urgentDelta} />
          <WachtlijstStat
            label="Gem. wachttijd"
            value={`${nlDec1.format(WACHTLIJST_SUMMARY.gemWachttijdWkn)} wkn`}
            delta={wachttijdDelta}
          />
        </div>
        <div>
          <p className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Wachtduur</p>
          <CareonBarList
            items={WACHTLIJST_BUCKETS.map((bucket) => ({
              label: bucket.label,
              value: bucket.aantal,
              tone: bucket.label === "60+ dagen" ? "bad" : "default",
            }))}
          />
        </div>
        <div>
          <p className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Per locatie</p>
          <CareonBarList
            items={WACHTLIJST_PER_LOCATIE.map((locatie) => ({
              label: locatie.label,
              value: locatie.aantal,
              tone: locatie.label === "Roermond" ? "bad" : "default",
            }))}
          />
        </div>
      </div>
    </CareonChartCard>
  );
}
