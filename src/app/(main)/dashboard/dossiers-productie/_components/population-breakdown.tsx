"use client";

import { CareonBarList } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonDonut, CareonDonutLegend } from "@/app/(main)/dashboard/_components/careon/careon-donut";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import {
  type AantalGroep,
  ACTIEVE_CLIENTEN,
  DIAGNOSE_GROEPEN,
  GESLACHT_VERDELING,
  LEEFTIJD_GROEPEN,
  PLAATS_VERDELING,
  VERWIJZERS,
  VERZEKERAAR_VERDELING,
} from "@/data/careon/careon-dossiers-productie";

const nl = new Intl.NumberFormat("nl-NL");

// Bar-list rows showing "count · percentage-of-base".
function toBarItems(groepen: AantalGroep[], base: number) {
  return groepen.map((groep) => ({
    label: groep.label,
    value: groep.aantal,
    display: `${nl.format(groep.aantal)} · ${Math.round((groep.aantal / Math.max(1, base)) * 100)}%`,
  }));
}

function badge(widget: string) {
  return <CareonSourceBadge page="dossiersProductie" widget={widget} />;
}

export function DiagnosesPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  const groepen = production ? production.dossiersProductie.diagnoseGroepen : DIAGNOSE_GROEPEN;
  const basis = production ? production.meta.activeClients : ACTIEVE_CLIENTEN;

  return (
    <CareonChartCard
      title="Diagnoses binnen de instelling"
      sub={`Actieve cliënten per diagnosegroep · totaal ${nl.format(basis)}`}
      className={className}
      titleBadge={badge("Diagnoses")}
      footer="Gebaseerd op de primaire diagnose per actief dossier."
    >
      <CareonBarList items={toBarItems(groepen, basis)} />
    </CareonChartCard>
  );
}

export function GeslachtPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  const data = production ? production.dossiersProductie.geslacht : GESLACHT_VERDELING;

  return (
    <CareonChartCard
      title="Geslacht"
      sub="Actieve cliënten in behandeling"
      className={className}
      titleBadge={badge("Geslacht")}
    >
      <div className="flex flex-col gap-3">
        <CareonDonut data={data} height={160} />
        <CareonDonutLegend data={data} />
      </div>
    </CareonChartCard>
  );
}

export function LeeftijdPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  const groepen = production ? production.dossiersProductie.leeftijdGroepen : LEEFTIJD_GROEPEN;
  const basis = production ? production.meta.activeClients : ACTIEVE_CLIENTEN;

  return (
    <CareonChartCard
      title="Leeftijd doelgroep"
      sub="Actieve cliënten per leeftijdsgroep"
      className={className}
      titleBadge={badge("Leeftijd")}
    >
      <CareonBarList items={toBarItems(groepen, basis)} />
    </CareonChartCard>
  );
}

export function VerwijzersPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  const groepen = production ? production.dossiersProductie.verwijzers : VERWIJZERS;
  const totaal = groepen.reduce((sum, verwijzer) => sum + verwijzer.aantal, 0);

  return (
    <CareonChartCard
      title="Verwijzers"
      sub={`Verwijzingen laatste 12 maanden · totaal ${nl.format(totaal)}`}
      className={className}
      titleBadge={badge("Verwijzers")}
    >
      <CareonBarList items={toBarItems(groepen, totaal)} />
    </CareonChartCard>
  );
}

export function PlaatsPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  const groepen = production ? production.dossiersProductie.plaatsen : PLAATS_VERDELING;
  const basis = production ? production.meta.activeClients : ACTIEVE_CLIENTEN;

  return (
    <CareonChartCard
      title="Plaats"
      sub="Actieve cliënten per woonplaats"
      className={className}
      titleBadge={badge("Plaats")}
    >
      <CareonBarList items={toBarItems(groepen, basis)} />
    </CareonChartCard>
  );
}

export function VerzekeraarsPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  const groepen = production ? production.dossiersProductie.verzekeraars : VERZEKERAAR_VERDELING;
  const basis = production ? production.meta.activeClients : ACTIEVE_CLIENTEN;

  return (
    <CareonChartCard
      title="Verzekeringskoepel"
      sub="Actieve cliënten per verzekeraar"
      className={className}
      titleBadge={badge("Verzekeringskoepel")}
      footer="Zelfde koepels als de omzetverdeling op Financieel."
    >
      <CareonBarList items={toBarItems(groepen, basis)} />
    </CareonChartCard>
  );
}
