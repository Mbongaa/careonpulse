"use client";

import { useState } from "react";

import { CareonBarList } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { CareonKpiCard } from "@/app/(main)/dashboard/_components/careon/careon-kpi-card";
import { CareonLiveBanner } from "@/app/(main)/dashboard/_components/careon/careon-live-banner";
import { CareonOmzetChart } from "@/app/(main)/dashboard/_components/careon/careon-omzet-chart";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { CareonTimeframeToggle } from "@/app/(main)/dashboard/_components/careon/careon-timeframe-toggle";
import {
  DECLARATIE_OUDERDOM,
  FINANCIEEL_METRICS,
  FINANCIEEL_NOTE,
  OMZET_PER_LOCATIE,
  OMZET_PER_VERZEKERAAR,
  OPENSTAAND_TOTAAL,
} from "@/data/careon/careon-financieel";
import { careonDetailHref } from "@/data/careon/careon-kpi-details";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";
import { CAREON_TIMEFRAME_LABELS, type CareonTimeframe, timeframeKeys } from "@/data/careon/careon-timeframe";
import { KNOWN_LOCATIES } from "@/lib/careon-production/compute-snapshot";

const nl = new Intl.NumberFormat("nl-NL");

/** Som per groep over de maandsleutels binnen het gekozen tijdvenster. */
function venstersom(rows: readonly { key: string; groep: string; omzet: number }[], keys: Set<string>) {
  const totalen = new Map<string, number>();
  for (const row of rows) {
    if (!keys.has(row.key)) continue;
    totalen.set(row.groep, (totalen.get(row.groep) ?? 0) + row.omzet);
  }
  return totalen;
}

const eurK = (bedrag: number) => `€ ${nl.format(Math.round(bedrag / 1000))}K`;

export function FinancieelContent() {
  const { production } = useCareon();
  const agenda = production?.agenda;
  const financieel = agenda?.financieel;
  const toeslagen = production?.toeslagen;
  const declaraties = production?.declaraties;
  const [verzekeraarTf, setVerzekeraarTf] = useState<CareonTimeframe>("12m");
  const [locatieTf, setLocatieTf] = useState<CareonTimeframe>("12m");
  const maandKeys = agenda ? agenda.maandreeks.map((point) => point.key) : [];

  // Vervangings-patroon: agenda-metrics zijn gesleuteld op de demo-labels.
  // Alle kaarten linken naar hun KPI-drilldown; agenda-/declaratie-gedreven
  // drilldowns tonen daar de geaggregeerde maand- of debiteurentabel.
  const metrics = FINANCIEEL_METRICS.map((metric) => {
    const live = financieel?.metrics[metric.label];
    if (live) {
      return { metric: live, detailId: metric.detailId, widget: metric.label };
    }
    return { metric, detailId: metric.detailId, widget: metric.label };
  });
  // Productie-exclusieve kaarten zonder demo-slot (driedeling klantoverzicht):
  // "Totale omzet" voorop, "Omzet RMO/RMA" direct na de servicebureau-kaart.
  const totaleOmzet = financieel?.metrics["Totale omzet"];
  if (totaleOmzet) {
    metrics.unshift({ metric: totaleOmzet, detailId: "omzettotaal", widget: "Totale omzet" });
  }
  const rmoRma = financieel?.metrics["Omzet RMO/RMA"];
  if (rmoRma) {
    const naSb = metrics.findIndex((item) => item.widget === "Omzet Infomedics") + 1;
    metrics.splice(naSb, 0, { metric: rmoRma, detailId: "omzetrmo", widget: "Omzet RMO/RMA" });
  }

  // Tijdvenster: hersommeer de maand × koepel-rijen uit de snapshot voor het
  // gekozen venster; top-5 + "Overig" volgt hetzelfde patroon als de snapshot.
  let verzekeraarItems: { label: string; value: number; display: string }[];
  if (financieel) {
    const gesorteerd = [
      ...venstersom(
        financieel.omzetKoepelMaand.map((row) => ({ key: row.key, groep: row.koepel, omzet: row.omzet })),
        timeframeKeys(maandKeys, verzekeraarTf),
      ).entries(),
    ].sort((a, b) => b[1] - a[1]);
    const rest = gesorteerd.slice(5).reduce((sum, [, omzet]) => sum + omzet, 0);
    const rijen = gesorteerd.slice(0, 5).map(([label, omzet]) => ({ label, omzet }));
    if (rest > 0) rijen.push({ label: "Overig", omzet: rest });
    verzekeraarItems = rijen.map((row) => ({ label: row.label, value: row.omzet, display: eurK(row.omzet) }));
  } else {
    verzekeraarItems = OMZET_PER_VERZEKERAAR.map((row) => ({
      label: row.name,
      value: row.value,
      display: `€ ${row.value}K`,
    }));
  }

  let locatieItems: { label: string; value: number; display: string; tone: "accent" }[];
  if (financieel) {
    const totalen = venstersom(
      financieel.omzetLocatieMaand.map((row) => ({ key: row.key, groep: row.loc, omzet: row.omzet })),
      timeframeKeys(maandKeys, locatieTf),
    );
    locatieItems = [...KNOWN_LOCATIES, "Onbekend"]
      .filter((loc) => (totalen.get(loc) ?? 0) > 0)
      .map((loc) => ({
        label: loc,
        value: totalen.get(loc) ?? 0,
        display: eurK(totalen.get(loc) ?? 0),
        tone: "accent" as const,
      }));
  } else {
    locatieItems = OMZET_PER_LOCATIE.map((row) => ({
      label: row.loc,
      value: row.omzet,
      display: `€ ${row.omzet}K`,
      tone: "accent" as const,
    }));
  }

  let ouderdomItems = DECLARATIE_OUDERDOM.map((row, index) => ({
    label: row.label,
    value: row.pct,
    display: `${row.pct}%`,
    tone: index === DECLARATIE_OUDERDOM.length - 1 ? ("bad" as const) : ("default" as const),
  }));
  if (declaraties) {
    // Echte ouderdom van openstaande (niet-toegekende) declaratiebedragen.
    ouderdomItems = declaraties.ouderdom.map((row, index) => ({
      label: row.label,
      value: row.pct,
      display: `${row.pct}% · € ${nl.format(row.bedrag)}`,
      tone: index === declaraties.ouderdom.length - 1 ? ("bad" as const) : ("default" as const),
    }));
  } else if (financieel) {
    ouderdomItems = financieel.onderhandenOuderdom.map((row, index) => ({
      label: row.label,
      value: row.pct,
      display: `${row.pct}% · € ${nl.format(row.bedrag)}`,
      tone: index === financieel.onderhandenOuderdom.length - 1 ? ("bad" as const) : ("default" as const),
    }));
  }

  let ouderdomTitel = "Ouderdom openstaande declaraties";
  let ouderdomSub = `€ ${nl.format(OPENSTAAND_TOTAAL)} totaal openstaand`;
  if (declaraties) {
    ouderdomSub = `€ ${nl.format(declaraties.openstaand)} openstaand (nog niet toegekend)`;
  } else if (financieel) {
    ouderdomTitel = "Ouderdom onderhanden werk";
    ouderdomSub = `€ ${nl.format(financieel.onderhandenTotaal)} nog niet gefactureerd`;
  }

  const ouder90 = financieel?.onderhandenOuderdom[financieel.onderhandenOuderdom.length - 1];
  let ouderdomFooter = FINANCIEEL_NOTE;
  if (declaraties) {
    ouderdomFooter =
      declaraties.openstaand90.facturen > 0
        ? `€ ${nl.format(declaraties.openstaand90.bedrag)} (${nl.format(declaraties.openstaand90.facturen)} facturen) staat langer dan 90 dagen open zonder volledige toekenning — zie Signaleringen.`
        : "Geen declaraties ouder dan 90 dagen zonder toekenning.";
  } else if (financieel) {
    ouderdomFooter =
      ouder90 && ouder90.bedrag > 0
        ? `€ ${nl.format(ouder90.bedrag)} aan sessiewaarde wacht al langer dan 90 dagen op facturatie. Declaratiestatus (Vecozo/afgekeurd) vereist de declaratie-export.`
        : "Declaratiestatus (Vecozo/afgekeurd) vereist de declaratie-export.";
  }

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title={CAREON_PAGE_META.financieel.title} sub={CAREON_PAGE_META.financieel.sub} />

      <CareonLiveBanner page="financieel" />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {metrics.map((item) => (
          <CareonKpiCard
            key={item.widget}
            metric={item.metric}
            href={item.detailId ? careonDetailHref(item.detailId) : undefined}
            sourceBadge={<CareonSourceBadge page="financieel" widget={item.widget} />}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-12">
        <CareonOmzetChart className="lg:col-span-7" height="h-64" />
        <CareonChartCard
          title="Omzet per verzekeraar"
          sub={
            financieel
              ? `Gefactureerd · ${CAREON_TIMEFRAME_LABELS[verzekeraarTf].toLowerCase()}`
              : "Deze maand · x € 1.000"
          }
          className="lg:col-span-5"
          titleBadge={<CareonSourceBadge page="financieel" widget="Omzet per verzekeraar" />}
          action={financieel ? <CareonTimeframeToggle value={verzekeraarTf} onChange={setVerzekeraarTf} /> : undefined}
        >
          <CareonBarList items={verzekeraarItems} />
        </CareonChartCard>

        <CareonChartCard
          title="Omzet per locatie"
          sub={
            financieel ? `Gefactureerd · ${CAREON_TIMEFRAME_LABELS[locatieTf].toLowerCase()}` : "Deze maand · x € 1.000"
          }
          className="lg:col-span-5"
          titleBadge={<CareonSourceBadge page="financieel" widget="Omzet per locatie" />}
          action={financieel ? <CareonTimeframeToggle value={locatieTf} onChange={setLocatieTf} /> : undefined}
        >
          <CareonBarList items={locatieItems} />
        </CareonChartCard>

        <CareonChartCard
          title={ouderdomTitel}
          sub={ouderdomSub}
          className="lg:col-span-7"
          titleBadge={<CareonSourceBadge page="financieel" widget="Ouderdom openstaande declaraties" />}
          footer={ouderdomFooter}
        >
          <CareonBarList max={100} items={ouderdomItems} />
        </CareonChartCard>

        {/* Productie-exclusief: rendert alleen na de declaratie-import. */}
        {declaraties && (
          <CareonChartCard
            title="Declaratiestatus"
            sub={`€ ${nl.format(declaraties.gefactureerd)} gedeclareerd · ${declaraties.toekenningsPct}% toegekend · € ${nl.format(declaraties.gecrediteerd)} gecrediteerd`}
            className="lg:col-span-7"
            titleBadge={<CareonSourceBadge page="financieel" widget="Declaratiestatus" />}
            footer={`${nl.format(declaraties.status.volledig)} facturen volledig toegekend, ${nl.format(declaraties.status.deels)} deels (tekort € ${nl.format(declaraties.tekortDeels)}), ${nl.format(declaraties.status.zonder)} nog zonder toekenning.${declaraties.dekking ? ` Dekking: € ${nl.format(declaraties.gefactureerd)} van € ${nl.format(declaraties.dekking.agendaGefactureerd)} gefactureerd (${declaraties.dekking.pct}%) — een deel van de Vurans-facturen ontbreekt in dit overzicht.` : ""} Het locatiefilter is hier niet van toepassing.`}
          >
            <CareonBarList
              max={100}
              items={declaraties.perKoepel.slice(0, 6).map((row) => ({
                label: `${row.label} · € ${nl.format(row.gefactureerd)}`,
                value: row.pct,
                display: `${row.pct}% toegekend${row.openstaand > 0 ? ` · € ${nl.format(row.openstaand)} open` : ""}`,
                tone: row.pct < 80 ? ("bad" as const) : ("default" as const),
              }))}
            />
          </CareonChartCard>
        )}

        {/* Productie-exclusief: rendert alleen na de toeslagen-import. */}
        {toeslagen && (
          <CareonChartCard
            title="Toeslagen"
            sub={`€ ${nl.format(toeslagen.totaal)} · ${nl.format(toeslagen.aantal)} toeslagregels · ${nl.format(toeslagen.clienten)} cliënten`}
            className="lg:col-span-5"
            titleBadge={<CareonSourceBadge page="financieel" widget="Toeslagen" />}
            footer={`Toeslagen staan als extra regels op dezelfde facturen maar tellen — net als in het eigen facturatie-overzicht — niet mee in de omzetkaarten hierboven. Tolk-inzet: ${nl.format(toeslagen.tolkClienten)} cliënt(en). De export draagt geen vestiging.`}
          >
            <CareonBarList
              items={toeslagen.perCode.map((groep) => ({
                label: groep.omschrijving,
                value: groep.omzet,
                display: `€ ${nl.format(Math.round(groep.omzet))} · ${nl.format(groep.aantal)}×`,
              }))}
            />
          </CareonChartCard>
        )}
      </div>
    </div>
  );
}
