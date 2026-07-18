"use client";

import { CareonBarList } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";

// Productie-exclusieve analysepanelen: zorgvraagtypering en behandelduur
// bestaan niet in de geauditeerde demo-set (geen demo-constanten) en renderen
// dus alleen wanneer een EPD-import actief is — demo blijft pixel-identiek.

const nl = new Intl.NumberFormat("nl-NL");

export function ZorgvraagtyperingPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  if (!production) {
    return null;
  }

  const groepen = production.dossiersProductie.zorgvraagtypes;
  const basis = production.meta.activeClients;

  return (
    <CareonChartCard
      title="Zorgvraagtypering"
      sub={`Geselecteerd zorgvraagtype (ZPM) · ${nl.format(basis)} actieve cliënten`}
      className={className}
      titleBadge={<CareonSourceBadge page="dossiersProductie" widget="Zorgvraagtypering" />}
      footer="Zorgvraagzwaarte volgens het zorgprestatiemodel; ontbrekende typeringen staan ook als dossiercontrole-actiepunt."
    >
      <CareonBarList
        items={groepen.map((groep) => ({
          label: groep.label,
          value: groep.aantal,
          display: `${nl.format(groep.aantal)} · ${Math.round((groep.aantal / Math.max(1, basis)) * 100)}%`,
          tone: groep.label === "Geen typering geregistreerd" ? ("warn" as const) : undefined,
        }))}
      />
    </CareonChartCard>
  );
}

export function BehandelduurPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  if (!production) {
    return null;
  }

  const { afgesloten, gemDagen, mediaanDagen, buckets, perKwartaal, zonderRegistratie, churn14 } =
    production.dossiersProductie.behandelduur;
  const pctVan = (n: number) => (afgesloten === 0 ? 0 : Math.round((n / afgesloten) * 100));

  return (
    <CareonChartCard
      title="Behandelduur"
      sub={`Afgesloten dossiers (episodestart → einddatum) · ${nl.format(afgesloten)} dossiers`}
      className={className}
      titleBadge={<CareonSourceBadge page="dossiersProductie" widget="Behandelduur" />}
      footer={
        afgesloten > 0
          ? `Uitvalsignalen: ${nl.format(churn14)} afsluitingen ≤14 dagen (${pctVan(churn14)}%) en ${nl.format(zonderRegistratie)} zonder geregistreerde tijd (${pctVan(zonderRegistratie)}%). Kwartaaltrend kan vertekenen: de exporthistorie is kort (censurering).`
          : "Nog geen afgesloten dossiers binnen het gekozen locatiefilter."
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-muted-foreground text-xs">Gemiddeld</p>
            <p className="mt-1 font-medium text-xl tabular-nums leading-none">
              {gemDagen === null ? "—" : `${nl.format(gemDagen)} dgn`}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-muted-foreground text-xs">Mediaan</p>
            <p className="mt-1 font-medium text-xl tabular-nums leading-none">
              {mediaanDagen === null ? "—" : `${nl.format(mediaanDagen)} dgn`}
            </p>
          </div>
        </div>
        <CareonBarList
          items={buckets.map((bucket) => ({
            label: bucket.label,
            value: bucket.aantal,
            tone: bucket.label === ">180 dagen" ? ("accent" as const) : undefined,
          }))}
        />
        <div>
          <p className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Mediaan per kwartaal</p>
          <CareonBarList
            items={perKwartaal.map((kwartaal) => ({
              label: kwartaal.label,
              value: kwartaal.mediaanDagen ?? 0,
              display:
                kwartaal.mediaanDagen === null
                  ? "— · n=0"
                  : `${nl.format(kwartaal.mediaanDagen)} dgn · n=${nl.format(kwartaal.n)}`,
              tone: "accent" as const,
            }))}
          />
        </div>
      </div>
    </CareonChartCard>
  );
}
