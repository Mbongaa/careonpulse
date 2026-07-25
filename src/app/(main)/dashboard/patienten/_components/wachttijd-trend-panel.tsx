"use client";

import { useState } from "react";

import { CareonBarList } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { CareonTimeframeToggle } from "@/app/(main)/dashboard/_components/careon/careon-timeframe-toggle";
import { TREEKNORM_WEKEN } from "@/data/careon/careon-patienten";
import { CAREON_TIMEFRAME_LABELS, type CareonTimeframe, sliceTimeframe } from "@/data/careon/careon-timeframe";

// Productie-exclusief: mediaan gerealiseerde wachttijd per startmaand. Het
// kwartaalgemiddelde op deze pagina verbergt de trend; dit paneel toont hem.
// Demo kent deze reeks niet en rendert null (pixel-identiek).

const nl = new Intl.NumberFormat("nl-NL");
const TREEKNORM_DAGEN = TREEKNORM_WEKEN * 7;

export function WachttijdTrendPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  const [timeframe, setTimeframe] = useState<CareonTimeframe>("12m");
  if (!production) {
    return null;
  }

  const trend = sliceTimeframe(production.wachttijdTrendFull, timeframe);
  const totaalOverTreek = trend.reduce((sum, maand) => sum + maand.overTreek, 0);

  return (
    <CareonChartCard
      title="Wachttijd-trend"
      sub="Mediaan gerealiseerde wachttijd (verwijzing → start) per startmaand"
      className={className}
      titleBadge={<CareonSourceBadge page="patienten" widget="Wachttijd-trend" />}
      action={<CareonTimeframeToggle value={timeframe} onChange={setTimeframe} />}
      footer={`Rood = maanden met starters boven de Treeknorm (${TREEKNORM_WEKEN} wkn); ${nl.format(totaalOverTreek)} starter(s) overschreden de norm (${CAREON_TIMEFRAME_LABELS[timeframe].toLowerCase()}). Kleine aantallen per maand: lees de n mee.`}
    >
      <CareonBarList
        items={trend.map((maand) => {
          let tone: "bad" | "warn" | undefined;
          if (maand.mediaanDagen !== null && maand.mediaanDagen > TREEKNORM_DAGEN) tone = "bad";
          else if (maand.overTreek > 0) tone = "warn";
          return {
            label: maand.m,
            value: maand.mediaanDagen ?? 0,
            display:
              maand.mediaanDagen === null
                ? "— · n=0"
                : `${nl.format(maand.mediaanDagen)} dgn · n=${nl.format(maand.n)}${maand.overTreek > 0 ? ` · ${maand.overTreek}× >norm` : ""}`,
            tone,
          };
        })}
      />
    </CareonChartCard>
  );
}
