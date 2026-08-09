"use client";

import { useId, useState } from "react";

import Link from "next/link";

import {
  ArrowUpRight,
  BarChart3,
  Check,
  ClipboardCheck,
  Database,
  FileText,
  Pencil,
  Printer,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { CareonDonut, CareonDonutLegend } from "@/app/(main)/dashboard/_components/careon/careon-donut";
import { useCareonMiddelen } from "@/app/(main)/dashboard/_components/careon/careon-middelen-provider";
import { CareonMiddelenSyncLine } from "@/app/(main)/dashboard/_components/careon/careon-middelen-sync-line";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ASSISTANT_INTENT_META,
  type AssistantActieRegel,
  type AssistantArtifact,
  type AssistantClaim,
  type AssistantSourceRef,
  type AssistantTone,
  type AssistantVisualization,
} from "@/data/careon/careon-assistant";
import { MIDDEL_ICONS, MIDDEL_LABELS } from "@/data/careon/careon-middelen";
import { CAREON_MONTHLY } from "@/data/careon/careon-shared-charts";
import { isDestructieveTool } from "@/lib/careon-middelen/assistant-executor";
import { MIDDELEN_TOOLS } from "@/lib/careon-middelen/assistant-tools";
import { FUNCTIE_OPTIES, MIDDEL_TYPES, TAAL_OPTIES } from "@/lib/careon-middelen/types";
import { cn } from "@/lib/utils";

import { type AssistantStage, assistantArtifactItems, useAssistantCanvas } from "./assistant-context";

const TONE_TEXT: Record<AssistantTone, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  bad: "text-red-700 dark:text-red-400",
  accent: "text-foreground",
  none: "",
};

const TONE_BAR: Record<AssistantTone, string> = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  accent: "bg-primary",
  none: "bg-muted-foreground",
};

const DELTA_TONE: Record<"good" | "bad" | "neutral", string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  bad: "text-red-700 dark:text-red-400",
  neutral: "text-muted-foreground",
};

function ToneBar({ pct, tone }: Readonly<{ pct: number; tone: AssistantTone }>) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", TONE_BAR[tone])} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export function AssistantVisualizationBlock({ visual }: Readonly<{ visual: AssistantVisualization }>) {
  switch (visual.kind) {
    case "kpi-grid":
      return (
        <div className="grid grid-cols-2 gap-3">
          {visual.tiles?.map((tile) => (
            <div key={tile.label} className="rounded-lg border bg-card/50 p-3">
              <p className="truncate text-muted-foreground text-xs">{tile.label}</p>
              <p className="mt-1 font-medium text-xl tabular-nums leading-none tracking-tight">{tile.value}</p>
              <p className={cn("mt-1 text-xs tabular-nums", DELTA_TONE[tile.deltaTone])}>{tile.delta}</p>
            </div>
          ))}
        </div>
      );
    case "rank-list":
      return (
        <div className="space-y-2.5">
          {visual.rows?.map((row) => (
            <div key={row.label} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {row.label}
                  {row.sub ? <span className="ms-1.5 text-muted-foreground text-xs">{row.sub}</span> : null}
                </span>
                <span className={cn("shrink-0 font-medium tabular-nums", TONE_TEXT[row.tone])}>{row.display}</span>
              </div>
              <ToneBar pct={row.pct} tone={row.tone} />
            </div>
          ))}
        </div>
      );
    case "bar-chart": {
      const config = Object.fromEntries(
        (visual.monthSeries ?? []).map((s) => [s.key, { label: s.label, color: s.color }]),
      ) satisfies ChartConfig;
      const chartData: Record<string, string | number>[] = visual.data ?? CAREON_MONTHLY.map((point) => ({ ...point }));
      return (
        <ChartContainer config={config} className="aspect-auto h-48 w-full">
          <BarChart data={chartData} margin={{ top: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeOpacity={0.5} />
            <XAxis dataKey="m" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} width="auto" />
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <ChartLegend verticalAlign="top" content={<ChartLegendContent className="mb-2 justify-end" />} />
            {(visual.monthSeries ?? []).map((s) => (
              <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        </ChartContainer>
      );
    }
    case "donut":
      return (
        <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-2">
          <CareonDonut data={visual.donut ?? []} height={160} />
          <CareonDonutLegend data={visual.donut ?? []} />
        </div>
      );
    case "status-card":
      return (
        <div className="space-y-2">
          {visual.statusRows?.map((row) => (
            <div key={row.title} className="flex items-start gap-2.5 rounded-lg border bg-card/50 p-3">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE_BAR[row.tone])} />
              <div className="min-w-0">
                <p className="font-medium text-sm leading-tight">{row.title}</p>
                <p className="mt-0.5 text-muted-foreground text-xs">{row.detail}</p>
              </div>
            </div>
          ))}
        </div>
      );
    case "table": {
      const table = visual.table;
      if (!table) return null;
      return (
        <Table>
          <TableHeader>
            <TableRow>
              {table.head.map((h) => (
                <TableHead key={h} className="text-xs">
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.map((row) => (
              <TableRow key={row.cells.join("|")}>
                {row.cells.map((cell, i) => (
                  <TableCell
                    key={table.head[i]}
                    className={cn("py-2 text-sm", i === 0 ? "font-medium" : "tabular-nums", TONE_TEXT[row.tone])}
                  >
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    }
    default:
      return null;
  }
}

export function AssistantClaims({ claims }: Readonly<{ claims: AssistantClaim[] }>) {
  return (
    <div className="space-y-3">
      {claims.map((claim) => (
        <div key={claim.title} className="rounded-lg border bg-card/50 p-3">
          <p className="font-medium text-sm leading-tight">{claim.title}</p>
          <p className="mt-1 text-muted-foreground text-xs leading-relaxed">{claim.body}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {claim.values.map((v) => (
              <Badge key={v.label} variant="outline" className="gap-1.5 font-normal">
                <span className="text-muted-foreground">{v.label}</span>
                <span className="font-medium tabular-nums">{v.value}</span>
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AssistantSources({ sources }: Readonly<{ sources: AssistantSourceRef[] }>) {
  return (
    <div className="space-y-2">
      {sources.map((source) => (
        <div key={source.model} className="flex items-center gap-2.5 rounded-lg border bg-card/50 p-3">
          <Database className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium font-mono text-sm leading-tight">{source.model}</p>
            <p className="mt-0.5 text-muted-foreground text-xs">{source.label}</p>
          </div>
          <Badge variant="outline" className="shrink-0 tabular-nums">
            {source.rowCount} rijen
          </Badge>
        </div>
      ))}
      <p className="text-muted-foreground text-xs leading-relaxed">
        De bronlabels hierboven geven per antwoord aan of waarden uit demo-, productie- of handmatig bijgehouden
        gegevens komen.
      </p>
    </div>
  );
}

function AssistantCanvasPreparing({ stage }: Readonly<{ stage: AssistantStage }>) {
  const copy =
    stage === "thinking"
      ? { title: "Bronnen lezen en nadenken…", detail: "De vraag wordt herkend en aan een plan gekoppeld." }
      : { title: "Canvas samenstellen…", detail: "Visualisaties worden aan de cijfers gekoppeld." };
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 p-6 text-center">
      <BarChart3 className="size-6 animate-pulse text-muted-foreground" />
      <div>
        <p className="font-medium text-sm">{copy.title}</p>
        <p className="mt-1 text-muted-foreground text-xs">{copy.detail}</p>
      </div>
      <div className="flex w-40 flex-col gap-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-1.5 animate-pulse rounded-full bg-muted"
            style={{ animationDelay: `${i * 150}ms`, width: `${100 - i * 18}%` }}
          />
        ))}
      </div>
    </div>
  );
}

const ITEM_ICON = { visual: BarChart3, proof: ClipboardCheck, sources: FileText } as const;

// -- Bewerkbaar concept (handoff 11, kiosk-patroon "human-confirm") ---------
// De AI vult het concept alleen; hier bewerkt en bevestigt de mens. Elke
// regel is te schrappen (✕) en te bewerken (velden uit het tool-schema);
// bulk-regels laten per naam uitsluiten. Elke bewerking herberekent de
// preview door replay op de actuele registratie.

const ACTIE_TONE: Record<AssistantActieRegel["status"], AssistantTone> = {
  ok: "good",
  geen_wijziging: "none",
  bevestiging_vereist: "warn",
  fout: "bad",
};

interface ConceptVeldSchema {
  type?: string;
  enum?: string[];
  description?: string;
}

// Bewerkbare velden rechtstreeks uit het tool-schema (enums → keuzelijst,
// integer → getal, string → tekst); arrays/booleans (namen/iedereen) lopen
// via de naam-uitsluiting en niet via dit formulier.
function conceptVelden(tool: string): [string, ConceptVeldSchema][] {
  const schema = MIDDELEN_TOOLS.find((kandidaat) => kandidaat.function.name === tool);
  const properties =
    (schema?.function.parameters as { properties?: Record<string, ConceptVeldSchema> } | undefined)?.properties ?? {};
  return Object.entries(properties).filter(([, veld]) => veld.type !== "array" && veld.type !== "boolean");
}

function ConceptActieBewerker({
  regel,
  onOpslaan,
}: Readonly<{ regel: AssistantActieRegel; onOpslaan: (args: Record<string, unknown>) => void }>) {
  const fieldPrefix = useId();
  const [waarden, setWaarden] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      conceptVelden(regel.tool).map(([naam]) => [
        naam,
        regel.args?.[naam] === undefined ? "" : String(regel.args[naam]),
      ]),
    ),
  );

  const opslaan = () => {
    const nieuweArgs: Record<string, unknown> = { ...regel.args };
    for (const [naam, veld] of conceptVelden(regel.tool)) {
      const waarde = waarden[naam] ?? "";
      nieuweArgs[naam] = veld.type === "integer" ? Math.max(0, Math.round(Number(waarde) || 0)) : waarde;
    }
    onOpslaan(nieuweArgs);
  };

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 border-t pt-2">
      {conceptVelden(regel.tool).map(([naam, veld]) => (
        <label
          key={naam}
          htmlFor={`${fieldPrefix}-${naam}`}
          className="flex min-w-0 flex-col gap-1 text-muted-foreground text-xs"
        >
          {naam}
          {veld.enum ? (
            <NativeSelect
              id={`${fieldPrefix}-${naam}`}
              value={waarden[naam] ?? ""}
              aria-label={`${naam} van dit voorstel`}
              className="h-8 w-40 text-xs"
              onChange={(event) => setWaarden((prev) => ({ ...prev, [naam]: event.target.value }))}
            >
              {veld.enum.map((optie) => (
                <NativeSelectOption key={optie} value={optie}>
                  {optie}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : (
            <Input
              id={`${fieldPrefix}-${naam}`}
              value={waarden[naam] ?? ""}
              type={veld.type === "integer" ? "number" : "text"}
              aria-label={`${naam} van dit voorstel`}
              className="h-8 w-40 text-xs"
              onChange={(event) => setWaarden((prev) => ({ ...prev, [naam]: event.target.value }))}
            />
          )}
        </label>
      ))}
      <Button size="sm" className="h-8 px-3" onClick={opslaan}>
        Opslaan
      </Button>
    </div>
  );
}

// Bewerkbare registratietabel van het open concept — de hoofdweergave
// (klantvoorkeur 2026-07-24): per geraakte medewerker direct talen, functie,
// teams en middelen aanpassen. Elke celwijziging wordt onder water een actie
// in hetzelfde her-afspeelbare logboek als de AI-acties.
function ConceptRegistratieTabel() {
  const { concept, bewerkConceptRij } = useAssistantCanvas();
  if (!concept) return null;
  const geraakt = new Set(
    concept.regels.flatMap((regel) => [...(regel.naam ? [regel.naam] : []), ...(regel.namen ?? [])]),
  );
  const rijen = concept.staat.medewerkers.filter((rij) => geraakt.has(rij.naam));
  const teamOpties = [...new Set((concept.staat.teams ?? []).map((team) => team.naam))];
  if (rijen.length === 0) {
    return <p className="text-muted-foreground text-sm">Geen geraakte medewerkers in dit concept.</p>;
  }

  return (
    <div className="space-y-2">
      {rijen.map((rij) => (
        <div key={rij.naam} className="rounded-lg border bg-card/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 truncate font-medium text-sm">{rij.naam}</p>
            <span className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                aria-pressed={rij.uitDienst === true}
                aria-label={`${rij.naam} ${rij.uitDienst ? "weer in dienst zetten" : "uit dienst zetten"}`}
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs transition-colors",
                  rij.uitDienst
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                    : "text-muted-foreground hover:bg-muted",
                )}
                onClick={() =>
                  bewerkConceptRij(rij.naam, { soort: "dienstverband", uitDienst: rij.uitDienst !== true })
                }
              >
                {rij.uitDienst ? "Uit dienst" : "In dienst"}
              </button>
              <NativeSelect
                value={rij.functie ?? ""}
                aria-label={`Functie van ${rij.naam}`}
                className="h-7 w-44 text-xs"
                onChange={(event) => bewerkConceptRij(rij.naam, { soort: "functie", waarde: event.target.value })}
              >
                <NativeSelectOption value="">— geen functie —</NativeSelectOption>
                {FUNCTIE_OPTIES.map((optie) => (
                  <NativeSelectOption key={optie} value={optie}>
                    {optie}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="w-16 shrink-0 text-muted-foreground text-xs">Talen</span>
            {(rij.talen ?? []).map((taal) => (
              <button
                key={taal}
                type="button"
                aria-label={`${taal} verwijderen bij ${rij.naam}`}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs hover:bg-muted"
                onClick={() => bewerkConceptRij(rij.naam, { soort: "taal", waarde: taal, aanwezig: false })}
              >
                {taal}
                <X className="size-3 text-muted-foreground" />
              </button>
            ))}
            <NativeSelect
              value=""
              aria-label={`Taal toevoegen bij ${rij.naam}`}
              className="h-6 w-28 text-xs"
              onChange={(event) => {
                if (event.target.value) {
                  bewerkConceptRij(rij.naam, { soort: "taal", waarde: event.target.value, aanwezig: true });
                }
              }}
            >
              <NativeSelectOption value="">+ taal</NativeSelectOption>
              {TAAL_OPTIES.filter((optie) => !(rij.talen ?? []).includes(optie)).map((optie) => (
                <NativeSelectOption key={optie} value={optie}>
                  {optie}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="w-16 shrink-0 text-muted-foreground text-xs">Teams</span>
            {(rij.teams ?? []).map((team) => (
              <button
                key={team}
                type="button"
                aria-label={`Teamtag ${team} verwijderen bij ${rij.naam}`}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs hover:bg-muted"
                onClick={() => bewerkConceptRij(rij.naam, { soort: "team", waarde: team, aanwezig: false })}
              >
                {team}
                <X className="size-3 text-muted-foreground" />
              </button>
            ))}
            <NativeSelect
              value=""
              aria-label={`Team toevoegen bij ${rij.naam}`}
              className="h-6 w-28 text-xs"
              onChange={(event) => {
                if (event.target.value) {
                  bewerkConceptRij(rij.naam, { soort: "team", waarde: event.target.value, aanwezig: true });
                }
              }}
            >
              <NativeSelectOption value="">+ team</NativeSelectOption>
              {teamOpties
                .filter((optie) => !(rij.teams ?? []).includes(optie))
                .map((optie) => (
                  <NativeSelectOption key={optie} value={optie}>
                    {optie}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="w-16 shrink-0 text-muted-foreground text-xs">Middelen</span>
            {MIDDEL_TYPES.map((middel) => {
              const actief = rij.middelen.includes(middel);
              const Icon = MIDDEL_ICONS[middel];
              return (
                <button
                  key={middel}
                  type="button"
                  title={MIDDEL_LABELS[middel]}
                  aria-label={`${MIDDEL_LABELS[middel]} ${actief ? "innemen" : "toewijzen"} — ${rij.naam}`}
                  aria-pressed={actief}
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-md border transition-colors",
                    actief ? "border-primary/50 bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => bewerkConceptRij(rij.naam, { soort: "middel", waarde: middel, aanwezig: !actief })}
                >
                  <Icon className="size-3.5" />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ConceptActieLijst() {
  const { concept, verwijderConceptActie, sluitConceptNaamUit, bewerkConceptActie } = useAssistantCanvas();
  const [bewerkIndex, setBewerkIndex] = useState<number | null>(null);
  if (!concept) return null;
  if (concept.regels.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Geen voorstellen meer — verwerp het concept of vraag de assistent om nieuwe acties.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {concept.regels.map((regel, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: het concept is een positioneel, append-only actielogboek — dubbele acties zijn geldig en de index ís de identiteit.
        <div key={`${regel.tool}-${index}-${regel.melding}`} className="rounded-lg border bg-card/50 p-3">
          <div className="flex items-start gap-2.5">
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE_BAR[ACTIE_TONE[regel.status]])} />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm leading-tight">{regel.melding}</p>
              <p className="mt-0.5 text-muted-foreground text-xs">{regel.tool}</p>
              {regel.uitgesloten?.length ? (
                <p className="mt-0.5 text-muted-foreground text-xs">Uitgesloten: {regel.uitgesloten.join(", ")}</p>
              ) : null}
            </div>
            <span className="flex shrink-0 items-center gap-0.5">
              {regel.args ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground"
                  aria-label="Voorstel bewerken"
                  onClick={() => setBewerkIndex(bewerkIndex === index ? null : index)}
                >
                  <Pencil className="size-3.5" />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                aria-label="Voorstel schrappen"
                onClick={() => {
                  setBewerkIndex(null);
                  verwijderConceptActie(index);
                }}
              >
                <X className="size-3.5" />
              </Button>
            </span>
          </div>
          {bewerkIndex === index && regel.args ? (
            <ConceptActieBewerker
              regel={regel}
              onOpslaan={(args) => {
                setBewerkIndex(null);
                bewerkConceptActie(index, args);
              }}
            />
          ) : null}
          {(regel.namen?.length ?? 0) > 1 ? (
            <Collapsible className="mt-2">
              <CollapsibleTrigger className="text-muted-foreground text-xs underline-offset-2 hover:underline">
                {regel.namen?.length} medewerkers — klik om per naam uit te sluiten
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {regel.namen?.map((naam) => (
                    <button
                      key={naam}
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs hover:bg-muted"
                      aria-label={`${naam} uitsluiten van dit voorstel`}
                      onClick={() => sluitConceptNaamUit(index, naam)}
                    >
                      {naam}
                      <X className="size-3 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// Kiest per geselecteerd artefact-onderdeel de interactieve conceptweergave
// (open concept) of het statische visualisatieblok.
function ConceptOfStandaardVisual({ visual }: Readonly<{ visual: AssistantVisualization }>) {
  const canvas = useAssistantCanvas();
  const openConcept = canvas.concept?.status === "open" && canvas.messageKey === canvas.concept.key;
  if (openConcept && visual.id === "registratie") return <ConceptRegistratieTabel />;
  if (openConcept && visual.id === "acties") return <ConceptActieLijst />;
  return <AssistantVisualizationBlock visual={visual} />;
}

// Goedkeuringsbalk voor concept-wijzigingen (handoff 11): de assistent zet
// wijzigingen alleen klaar; hier beslist de gebruiker. Toepassen replayt de
// (bewerkte) acties op de actuele registratie en slaat die eindstand op;
// Verwerpen laat alles ongemoeid. De balk blijft zichtbaar zolang er een
// concept bestaat — ook wanneer het canvas inmiddels een ander artefact toont
// (dan met een terugknop naar het concept).
function ConceptBesluitBalk() {
  const canvas = useAssistantCanvas();
  const { concept, besluitConcept, herberekenConcept, select } = canvas;
  const registratie = useCareonMiddelen();
  const [destructieveBevestiging, setDestructieveBevestiging] = useState<string | null>(null);
  const [bulkBevestiging, setBulkBevestiging] = useState<string | null>(null);

  if (!concept) return null;

  const bevestigingKey = `${concept.key}:${concept.status}`;
  const destructiefBevestigd = destructieveBevestiging === bevestigingKey;
  const bulkBevestigd = bulkBevestiging === bevestigingKey;
  const wijzigingen = concept.regels.filter((regel) => regel.status === "ok").length;
  const destructieveWijzigingen = concept.regels.filter(
    (regel) => regel.status === "ok" && isDestructieveTool(regel.tool),
  ).length;
  const geraakteNamen = new Set(
    concept.regels
      .filter((regel) => regel.status === "ok")
      .flatMap((regel) => [...(regel.naam ? [regel.naam] : []), ...(regel.namen ?? [])]),
  );
  const hogeImpact =
    geraakteNamen.size >= 25 || concept.regels.some((regel) => regel.status === "ok" && regel.args?.iedereen === true);
  const toontConcept = canvas.artifact === concept.artifact;
  const basisVerouderd = concept.status === "open" && registratie.state.updatedAt !== concept.basisUpdatedAt;

  // Toepassen schrijft eerst lokaal en duwt daarna (gedebouncet) naar de
  // centrale opslag. Die push kan mislukken of op een conflict stuiten; de
  // balk mag dan geen succes melden — de sync-regel toont de echte stand en
  // draagt de herstelknoppen (opnieuw proberen / versiekeuze).
  const centraalNietGelukt = registratie.syncStatus === "fout" || registratie.syncStatus === "conflict";

  if (concept.status === "toegepast") {
    return (
      <div
        className={cn(
          "flex flex-col border-b",
          centraalNietGelukt ? "bg-amber-500/10" : "bg-emerald-500/10",
          registratie.syncStatus === "fout" && "bg-red-500/10",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2 px-4 py-2 text-xs",
            centraalNietGelukt ? "text-amber-800 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-400",
          )}
        >
          {centraalNietGelukt ? (
            <TriangleAlert className="size-3.5 shrink-0" />
          ) : (
            <Check className="size-3.5 shrink-0" />
          )}
          {centraalNietGelukt
            ? `Concept toegepast in deze browser (${wijzigingen} wijzigingen) — nog niet centraal opgeslagen.`
            : `Concept toegepast en opgeslagen (${wijzigingen} wijzigingen).`}
        </div>
        <CareonMiddelenSyncLine className="border-t px-4 py-1.5" />
      </div>
    );
  }
  if (concept.status === "verworpen") {
    return (
      <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2 text-muted-foreground text-xs">
        <X className="size-3.5 shrink-0" />
        Concept verworpen — er is niets gewijzigd.
      </div>
    );
  }

  return (
    <div className="flex flex-col border-b bg-amber-500/10">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <span className="min-w-0 flex-1 text-amber-800 text-xs dark:text-amber-300">
          <span className="font-medium">Concept — nog niets opgeslagen.</span>{" "}
          {wijzigingen === 1 ? "1 voorgestelde wijziging" : `${wijzigingen} voorgestelde wijzigingen`}; bewerk of schrap
          voorstellen hieronder, of stuur bij via de chat.
        </span>
        {toontConcept ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              className="h-7 gap-1.5 px-2.5"
              disabled={
                wijzigingen === 0 ||
                (destructieveWijzigingen > 0 && !destructiefBevestigd) ||
                (hogeImpact && !bulkBevestigd) ||
                // Bij een openstaand conflict duwt de provider niets naar de
                // centrale opslag; toepassen zou dan stil alleen lokaal landen
                // en bij "Centrale versie" alsnog verdwijnen.
                registratie.syncStatus === "conflict"
              }
              onClick={() => besluitConcept("toepassen")}
            >
              <Check className="size-3.5" />
              Toepassen
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2.5"
              onClick={() => besluitConcept("verwerpen")}
            >
              <X className="size-3.5" />
              Verwerpen
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 px-2.5"
            onClick={() => select(concept.artifact, null, concept.key)}
          >
            Concept bekijken
          </Button>
        )}
      </div>
      {toontConcept && destructieveWijzigingen > 0 ? (
        <label
          htmlFor="bevestig-destructieve-assistentacties"
          className="flex cursor-pointer items-center gap-2 border-amber-500/20 border-t px-4 py-2 text-amber-900 text-xs dark:text-amber-200"
        >
          <Checkbox
            id="bevestig-destructieve-assistentacties"
            checked={destructiefBevestigd}
            onCheckedChange={(checked) => setDestructieveBevestiging(checked === true ? bevestigingKey : null)}
          />
          Bevestig expliciet dat {destructieveWijzigingen === 1 ? "de verwijdering" : "de verwijderingen"} mag worden
          toegepast.
        </label>
      ) : null}
      {toontConcept && hogeImpact ? (
        <label
          htmlFor="bevestig-bulk-assistentacties"
          className="flex cursor-pointer items-center gap-2 border-amber-500/20 border-t px-4 py-2 text-amber-900 text-xs dark:text-amber-200"
        >
          <Checkbox
            id="bevestig-bulk-assistentacties"
            checked={bulkBevestigd}
            onCheckedChange={(checked) => setBulkBevestiging(checked === true ? bevestigingKey : null)}
          />
          Bevestig expliciet de bulkimpact op {geraakteNamen.size || "alle"} medewerkers.
        </label>
      ) : null}
      {basisVerouderd ? (
        <div className="flex flex-wrap items-center gap-2 border-amber-500/20 border-t px-4 py-1.5 text-amber-800 text-xs dark:text-amber-300">
          De registratie is intussen gewijzigd — de preview kan afwijken (Toepassen rekent altijd met de actuele stand).
          <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-xs" onClick={herberekenConcept}>
            <RefreshCw className="size-3" />
            Herbereken
          </Button>
        </div>
      ) : null}
      {registratie.syncStatus === "conflict" ? (
        <div className="flex flex-col gap-1 border-amber-500/20 border-t px-4 py-1.5 text-amber-800 text-xs dark:text-amber-300">
          <span>Toepassen kan pas nadat het versieconflict met de centrale registratie is opgelost.</span>
          <CareonMiddelenSyncLine />
        </div>
      ) : null}
    </div>
  );
}

export function AssistantArtifactCanvas({
  onExport,
  className,
}: Readonly<{ onExport: (artifact: AssistantArtifact) => void; className?: string }>) {
  const canvas = useAssistantCanvas();
  const { artifact, pending, stage, selectedItemId, select } = canvas;

  if (!artifact && !pending) return null;

  const items = artifact ? assistantArtifactItems(artifact) : [];
  const selected = items.find((item) => item.id === selectedItemId) ?? items[0] ?? null;
  const selectedVisual =
    selected?.kind === "visual" ? artifact?.visualizations.find((v) => `visual-${v.id}` === selected.id) : undefined;

  return (
    <section
      aria-live="polite"
      aria-label="Artefact-canvas"
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card", className)}
    >
      {!artifact || !selected ? (
        <AssistantCanvasPreparing stage={stage} />
      ) : (
        <>
          <ConceptBesluitBalk />
          <header className="flex items-start justify-between gap-3 border-b p-4">
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs uppercase tracking-wide">Geselecteerd artefact</p>
              <h2 className="mt-0.5 truncate font-semibold text-base leading-tight">{selected.title}</h2>
              <p className="mt-0.5 truncate text-muted-foreground text-xs">
                {ASSISTANT_INTENT_META[artifact.intent].label} · {selected.meta}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge variant="outline" className="tabular-nums">
                {items.length}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Artefact afdrukken"
                onClick={() => onExport(artifact)}
              >
                <Printer className="size-4" />
              </Button>
            </div>
          </header>

          <div className="flex flex-wrap gap-1.5 border-b p-3">
            {items.map((item) => {
              const Icon = ITEM_ICON[item.kind];
              const active = item.id === selected.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => select(artifact, item.id, canvas.messageKey)}
                  className={cn(
                    "inline-flex max-w-56 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                    active ? "border-primary/50 bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{item.title}</span>
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {selected.kind === "visual" && selectedVisual ? (
              <>
                {/* Bij een open concept zijn de registratietabel (hoofd-
                    weergave, direct bewerkbaar) en de actielijst (logboek met
                    schrappen/uitsluiten) interactief in plaats van statisch. */}
                <ConceptOfStandaardVisual visual={selectedVisual} />
                {artifact.claims.length ? (
                  <div>
                    <p className="mb-2 text-muted-foreground text-xs uppercase tracking-wide">Onderbouwing</p>
                    <AssistantClaims claims={artifact.claims.slice(0, 2)} />
                  </div>
                ) : null}
              </>
            ) : null}
            {selected.kind === "proof" ? <AssistantClaims claims={artifact.claims} /> : null}
            {selected.kind === "sources" ? <AssistantSources sources={artifact.sources} /> : null}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t p-3">
            <span className="text-muted-foreground text-xs">
              {artifact.intent === "assistent-acties"
                ? "Assistent-acties · handmatige registratie"
                : "Demo · deterministisch opgebouwd"}
            </span>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={artifact.pageHref}>
                {artifact.pageLabel}
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </footer>
        </>
      )}
    </section>
  );
}
