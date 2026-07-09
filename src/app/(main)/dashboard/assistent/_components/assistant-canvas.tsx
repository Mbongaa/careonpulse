"use client";

import Link from "next/link";

import { ArrowUpRight, BarChart3, ClipboardCheck, Database, FileText, Printer } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { CareonDonut, CareonDonutLegend } from "@/app/(main)/dashboard/_components/careon/careon-donut";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ASSISTANT_INTENT_META,
  type AssistantArtifact,
  type AssistantClaim,
  type AssistantSourceRef,
  type AssistantTone,
  type AssistantVisualization,
} from "@/data/careon/careon-assistant";
import { CAREON_MONTHLY } from "@/data/careon/careon-shared-charts";
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
      return (
        <ChartContainer config={config} className="aspect-auto h-48 w-full">
          <BarChart data={CAREON_MONTHLY} margin={{ top: 0, left: 0 }}>
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
        Alle waarden komen verbatim uit de geauditeerde demo-dataset van Careon Pulse; er is geen live AI-model of
        externe bron aangesloten.
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
                <AssistantVisualizationBlock visual={selectedVisual} />
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
            <span className="text-muted-foreground text-xs">Demo · deterministisch opgebouwd</span>
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
