import { CareonBarList } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonDonut, CareonDonutLegend } from "@/app/(main)/dashboard/_components/careon/careon-donut";
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
    display: `${nl.format(groep.aantal)} · ${Math.round((groep.aantal / base) * 100)}%`,
  }));
}

export function DiagnosesPanel({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard
      title="Diagnoses binnen de instelling"
      sub={`Actieve cliënten per diagnosegroep · totaal ${nl.format(ACTIEVE_CLIENTEN)}`}
      className={className}
      footer="Gebaseerd op de primaire diagnose per actief dossier."
    >
      <CareonBarList items={toBarItems(DIAGNOSE_GROEPEN, ACTIEVE_CLIENTEN)} />
    </CareonChartCard>
  );
}

export function GeslachtPanel({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard title="Geslacht" sub="Actieve cliënten in behandeling" className={className}>
      <div className="flex flex-col gap-3">
        <CareonDonut data={GESLACHT_VERDELING} height={160} />
        <CareonDonutLegend data={GESLACHT_VERDELING} />
      </div>
    </CareonChartCard>
  );
}

export function LeeftijdPanel({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard title="Leeftijd doelgroep" sub="Actieve cliënten per leeftijdsgroep" className={className}>
      <CareonBarList items={toBarItems(LEEFTIJD_GROEPEN, ACTIEVE_CLIENTEN)} />
    </CareonChartCard>
  );
}

export function VerwijzersPanel({ className }: Readonly<{ className?: string }>) {
  const totaal = VERWIJZERS.reduce((sum, verwijzer) => sum + verwijzer.aantal, 0);

  return (
    <CareonChartCard
      title="Verwijzers"
      sub={`Verwijzingen laatste 12 maanden · totaal ${nl.format(totaal)}`}
      className={className}
    >
      <CareonBarList items={toBarItems(VERWIJZERS, totaal)} />
    </CareonChartCard>
  );
}

export function PlaatsPanel({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard title="Plaats" sub="Actieve cliënten per woonplaats" className={className}>
      <CareonBarList items={toBarItems(PLAATS_VERDELING, ACTIEVE_CLIENTEN)} />
    </CareonChartCard>
  );
}

export function VerzekeraarsPanel({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard
      title="Verzekeringskoepel"
      sub="Actieve cliënten per verzekeraar"
      className={className}
      footer="Zelfde koepels als de omzetverdeling op Financieel."
    >
      <CareonBarList items={toBarItems(VERZEKERAAR_VERDELING, ACTIEVE_CLIENTEN)} />
    </CareonChartCard>
  );
}
