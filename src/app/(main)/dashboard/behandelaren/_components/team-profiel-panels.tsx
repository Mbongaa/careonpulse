"use client";

import Link from "next/link";

import { CareonBarList } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { useCareonMiddelen } from "@/app/(main)/dashboard/_components/careon/careon-middelen-provider";
import { CareonHandmatigBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { CAREON_ROUTES } from "@/data/careon/careon-pages";

// Teamprofiel-statistieken (handoff 09-aanvulling): talen en functiemix van
// het team, geteld uit de handmatige registratie op Medewerkers & middelen.
// Bewust bron-onafhankelijk — het is dezelfde administratie in demo en
// productie, met de Handmatig-badge als herkomstmarkering.

const nl = new Intl.NumberFormat("nl-NL");

function telling(waarden: string[]): { label: string; value: number; display: string }[] {
  const map = new Map<string, number>();
  for (const waarde of waarden) {
    map.set(waarde, (map.get(waarde) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "nl"))
    .map(([label, aantal]) => ({ label, value: aantal, display: nl.format(aantal) }));
}

function RegistratieLeeg() {
  return (
    <p className="text-muted-foreground text-sm">
      Nog niets geregistreerd — vul functie en talen in op{" "}
      <Link prefetch={false} href={CAREON_ROUTES.middelen} className="underline underline-offset-2">
        Medewerkers &amp; middelen
      </Link>
      .
    </p>
  );
}

export function TalenPanel({ className }: Readonly<{ className?: string }>) {
  const { state } = useCareonMiddelen();
  const items = telling(state.medewerkers.flatMap((rij) => rij.talen ?? []));
  const geregistreerd = state.medewerkers.filter((rij) => (rij.talen ?? []).length > 0).length;

  return (
    <CareonChartCard
      title="Talen in het team"
      sub={`Gesproken talen · ${nl.format(geregistreerd)} medewerkers met taalregistratie`}
      className={className}
      titleBadge={<CareonHandmatigBadge />}
      footer="Relevant voor de inzet van anderstalige behandelaren en de taal-match met wachtenden."
    >
      {items.length === 0 ? <RegistratieLeeg /> : <CareonBarList items={items} />}
    </CareonChartCard>
  );
}

export function FunctiemixPanel({ className }: Readonly<{ className?: string }>) {
  const { state } = useCareonMiddelen();
  const items = telling(state.medewerkers.map((rij) => rij.functie ?? "").filter((functie) => functie !== ""));

  return (
    <CareonChartCard
      title="Functiemix"
      sub="Medewerkers per functie/kwalificatie"
      className={className}
      titleBadge={<CareonHandmatigBadge />}
      footer="Geregistreerd op Medewerkers & middelen; BIG-registraties staan op HR."
    >
      {items.length === 0 ? <RegistratieLeeg /> : <CareonBarList items={items} />}
    </CareonChartCard>
  );
}

export function TeamBezettingPanel({ className }: Readonly<{ className?: string }>) {
  const { state } = useCareonMiddelen();
  const items = telling(state.medewerkers.flatMap((rij) => rij.teams ?? []));
  const structuur = new Set((state.teams ?? []).map((team) => team.naam));
  // Teams uit de structuur zonder getagde medewerkers tellen mee als 0 —
  // een onbemand team is precies wat directie wil zien.
  const onbemand = [...structuur]
    .filter((naam) => !items.some((item) => item.label === naam))
    .sort((a, b) => a.localeCompare(b, "nl"))
    .map((naam) => ({ label: naam, value: 0, display: "0" }));

  const alle = [...items, ...onbemand];

  return (
    <CareonChartCard
      title="Bezetting per team"
      sub="Getagde medewerkers per team · structuur TGC Groep"
      className={className}
      titleBadge={<CareonHandmatigBadge />}
      footer="Teamstructuur en tags beheer je op Medewerkers & middelen."
    >
      {alle.length === 0 ? <RegistratieLeeg /> : <CareonBarList items={alle} />}
    </CareonChartCard>
  );
}
