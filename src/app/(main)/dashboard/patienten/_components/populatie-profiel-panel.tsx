"use client";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";

// Productie-exclusief paneel: statistisch profiel van de actieve populatie
// (gemiddelde/mediane leeftijd, geslacht, dossierduur). Rendert null in demo
// zodat de geauditeerde pagina pixel-identiek blijft.

const nl = new Intl.NumberFormat("nl-NL");

function Stat({ label, waarde, sub }: Readonly<{ label: string; waarde: string; sub?: string }>) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <p className="font-semibold text-lg tabular-nums leading-tight">{waarde}</p>
      <p className="text-muted-foreground text-xs">{label}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function PopulatieProfielPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  if (!production) {
    return null;
  }
  const profiel = production.populatieProfiel;
  const fmt = (waarde: number | null, suffix = "") => (waarde === null ? "—" : `${nl.format(waarde)}${suffix}`);

  return (
    <CareonChartCard
      title="Populatieprofiel"
      sub={`Statistiek over ${nl.format(profiel.n)} actieve cliënten`}
      className={className}
      titleBadge={<CareonSourceBadge page="patienten" widget="Populatieprofiel" />}
      footer="Dossierduur = dagen sinds de start van de lopende episode. Leeftijden buiten 0–110 zijn uitgesloten (registratiefouten)."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Gem. leeftijd" waarde={fmt(profiel.gemLeeftijd, " jr")} />
        <Stat label="Mediane leeftijd" waarde={fmt(profiel.mediaanLeeftijd, " jr")} />
        <Stat
          label="Vrouw / man"
          waarde={profiel.vrouwPct === null ? "—" : `${profiel.vrouwPct}% / ${100 - profiel.vrouwPct}%`}
        />
        <Stat label="Gem. dossierduur" waarde={fmt(profiel.gemDuurDagen, " dgn")} />
        <Stat label="Mediane dossierduur" waarde={fmt(profiel.mediaanDuurDagen, " dgn")} />
        <Stat label="Actieve cliënten" waarde={fmt(profiel.n)} />
      </div>
    </CareonChartCard>
  );
}
