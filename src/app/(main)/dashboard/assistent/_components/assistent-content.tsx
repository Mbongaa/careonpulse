"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AssistantRuntimeProvider,
  type ChatModelRunOptions,
  type ChatModelRunResult,
  type ThreadAssistantMessagePart,
  type ToolCallMessagePart,
  useAuiState,
  useLocalRuntime,
  useRemoteThreadListRuntime,
  useThreadRuntime,
} from "@assistant-ui/react";
import { Activity, BarChart3, Brain, ChevronUp, Loader2, PanelLeft, Printer, X, Zap } from "lucide-react";

import { useCareonHr } from "@/app/(main)/dashboard/_components/careon/careon-hr-provider";
import { useCareonMiddelen } from "@/app/(main)/dashboard/_components/careon/careon-middelen-provider";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import {
  useCareonOrgNaam,
  useCareonSessionInfo,
} from "@/app/(main)/dashboard/_components/careon/careon-session-provider";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadList, type ThreadListLabels } from "@/components/assistant-ui/thread-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CAREON_ALERTS } from "@/data/careon/careon-alerts";
import {
  ASSISTANT_INTENT_META,
  ASSISTANT_QUICK_PROMPTS,
  type AssistantActieRegel,
  type AssistantArtifact,
  type AssistantIntentId,
  type AssistantResponse,
  buildActieArtifact,
  resolveAssistantResponse,
} from "@/data/careon/careon-assistant";
import { BEHANDELAREN } from "@/data/careon/careon-behandelaren";
import { CAREON_LOCATIONS } from "@/data/careon/careon-filters";
import { COCKPIT_KPIS } from "@/data/careon/careon-kpis";
import { CAREON_MONTHLY } from "@/data/careon/careon-shared-charts";
import type { CareonFilters, CareonKpi, CareonSource } from "@/data/careon/careon-types";
import { FINANCIEEL_WEIGERTEKST, isFinancieleAssistentVraag } from "@/lib/careon-assistant/financieel-gate";
import { redigeerFinancieleAssistentResponse } from "@/lib/careon-assistant/financieel-redactie";
import { getCareonAssistantSessionId } from "@/lib/careon-assistant/session.client";
import { isSupabaseAuthMode } from "@/lib/careon-auth";
import type { HrState } from "@/lib/careon-hr/types";
import {
  executeMiddelenTool,
  isDestructieveTool,
  type MiddelenActieResultaat,
  type MiddelenBron,
} from "@/lib/careon-middelen/assistant-executor";
import { assembleAssistantContext, middelenGrounding } from "@/lib/careon-middelen/assistant-grounding";
import {
  includeMiddelenNamesForTurn,
  includeMiddelenNotes,
  isMiddelenAction,
} from "@/lib/careon-middelen/assistant-tool-routing";
import { MIDDELEN_TOOL_NAMES } from "@/lib/careon-middelen/assistant-tools";
import { type ConceptActie, createConceptMiddelenApi, replayConceptActies } from "@/lib/careon-middelen/concept";
import { buildProductionAssistantArtifact } from "@/lib/careon-production/assistant-artifact";
import { buildProductionAssistantFacts } from "@/lib/careon-production/assistant-facts";
import type { ProductionSnapshot } from "@/lib/careon-production/types";
import { cn } from "@/lib/utils";

import { AssistantArtifactCanvas } from "./assistant-canvas";
import {
  AssistantCanvasContext,
  type AssistantCanvasState,
  type AssistantConceptState,
  assistantArtifactItems,
  type ConceptRijWijziging,
  defaultArtifactItemId,
  readMessageCustom,
  useAssistantCanvas,
} from "./assistant-context";
import { AssistantExportOverlay, type AssistantExportPayload, type AssistantExportTurn } from "./assistant-export";
import { AssistantMessageExtras } from "./assistant-extras";
import { CareonAssistantThreadListAdapter } from "./assistant-thread-list-adapter";

const STREAM_CHUNK = 6;
const STREAM_FRAME_MS = 16;
const CITE = "Bron: geauditeerde Careon Pulse demo-dataset · deterministisch antwoord zonder live AI-model";
const LIVE_CITE = "Live AI-antwoord · cijfers uitsluitend uit de geauditeerde Careon Pulse demo-dataset";
const HR_CITE = "Bron: actuele handmatige HR-registratie · deterministisch antwoord zonder live AI-model";
const LIVE_HR_CITE = "Live AI-antwoord · cijfers uit de actuele handmatige HR-registratie";
const CONCEPT_CITE = "Concept-wijzigingen · nog niets opgeslagen — beoordeel het concept in het canvas";
const liveProductionCite = (fileName: string) =>
  `Live AI-antwoord · cijfers uit de EPD-export ${fileName} (geaggregeerd, geen cliëntgegevens)`;
function liveAnswerCite(intent: AssistantIntentId, production: ProductionSnapshot | null): string {
  if (intent === "verzuim-hr") return LIVE_HR_CITE;
  if (production) return liveProductionCite(production.meta.fileName);
  return LIVE_CITE;
}

const THREAD_LIST_LABELS: ThreadListLabels = {
  archive: "Archiveren",
  delete: "Verwijderen",
  loadingThreads: "Chats laden",
  moreOptions: "Meer opties",
  newChat: "Nieuwe chat",
  newThread: "Nieuwe chat",
};

type ReasoningStyle = "standaard" | "diep";

// Maximaal aantal model→tools→model-rondes binnen één beurt (handoff 11).
// Ruim genoeg voor bulkbeurten ("vul talen voor alle behandelaren") die de
// aanroepen over meerdere rondes spreiden.
const MAX_ACTIE_RONDES = 6;

const OFFLINE_ACTIE_NOTICE =
  "Wijzigingen uitvoeren (zoals middelen toewijzen of inventaris aanpassen) kan alleen met een actieve live AI-koppeling. In deze lokale preview kunt u de registratie handmatig bijwerken op de pagina Medewerkers & middelen (Organisatie → Medewerkers & middelen).";

// Vangnet voor het bekende modelpatroon "ik zet het concept nu klaar" gevolgd
// door stoppen zónder tool-aanroepen: bij detectie port de actielus één keer
// deterministisch door ("voer het nu uit"), en lukt het dan nóg niet, dan
// wordt het lees-artefact niet ten onrechte aan de aankondiging gekoppeld.
const AANKONDIGING_RE =
  /\b(ik (zal|ga)( nu| dit| deze| het)?|zal nu|ga nu)\b[\s\S]*\b(concept|klaarzetten|klaar te zetten|registreren|toevoegen|toewijzen|verwijderen)/i;
// Ook de geparroteerde afsluiting ("het concept staat klaar") zonder dat er
// tools zijn aangeroepen is een aankondiging.
const CONCEPT_KLAAR_RE = /\bconcept (staat|is) (nu )?klaar\b/i;

function lijktActieAankondiging(text: string): boolean {
  return AANKONDIGING_RE.test(text) || CONCEPT_KLAAR_RE.test(text);
}

// NDJSON-events van de live route (zie /api/assistant): tekst-tokens,
// complete tool-aanroepen en een afsluitende done-regel.
type LiveEvent =
  | { t: "meta"; requestId: string; model: string; promptVersion: string }
  | { t: "text"; d: string }
  | { t: "tool"; id: string; name: string; args: string }
  | { t: "error"; code: string; message: string }
  | {
      t: "done";
      reason: "stop" | "tool_calls";
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    };

async function* readWireEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<LiveEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let done = false;
  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    if (!chunk.value) continue;
    buffered += decoder.decode(chunk.value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line) as LiveEvent;
      } catch {
        // Misvormde regel — negeren.
      }
    }
  }
}

// De registratie-grounding en context-samenstelling staan in
// src/lib/careon-middelen/assistant-grounding.ts (UI-vrij) zodat de
// verify-scripts hetzelfde klantpad kunnen doormeten: de medewerkerslijst
// staat vóóraan en kan nooit door het context-budget worden afgekapt.

// Regels → her-afspeelbare acties (regels zonder args kunnen niet replayen en
// vallen af — die ontstaan in de praktijk niet).
function conceptActiesVan(regels: AssistantActieRegel[]): { acties: ConceptActie[]; regels: AssistantActieRegel[] } {
  const metArgs = regels.filter(
    (regel): regel is AssistantActieRegel & { args: Record<string, unknown> } => regel.args !== undefined,
  );
  return {
    acties: metArgs.map((regel) => ({ tool: regel.tool, args: regel.args, uitgesloten: regel.uitgesloten })),
    regels: metArgs,
  };
}

// Werk regels bij met de resultaten van een replay (status/melding/namen
// kunnen veranderen wanneer de basis of de argumenten zijn gewijzigd).
function mergeReplayRegels(regels: AssistantActieRegel[], resultaten: MiddelenActieResultaat[]): AssistantActieRegel[] {
  return regels.map((regel, index) => ({
    ...regel,
    status: resultaten[index].status,
    melding: resultaten[index].melding,
    naam: resultaten[index].naam,
    namen: resultaten[index].namen,
    locatie: resultaten[index].locatie,
  }));
}

function recordConceptDecision(concept: AssistantConceptState, decision: "applied" | "rejected") {
  const successful = concept.regels.filter((regel) => regel.status === "ok").length;
  const failed = concept.regels.filter((regel) => regel.status === "fout").length;
  const destructive = concept.regels.filter((regel) => isDestructieveTool(regel.tool)).length;
  void fetch("/api/assistant/audit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-careon-assistant": "1",
      "x-careon-session": getCareonAssistantSessionId(),
    },
    body: JSON.stringify({
      decision,
      requestIds: concept.requestIds,
      toolNames: concept.regels.map((regel) => regel.tool),
      successful,
      failed,
      destructive,
    }),
    keepalive: true,
  }).catch(() => {
    // Audit is best-effort in the UI; the state write carries the same summary.
  });
}

// Below this width the canvas lives in a bottom drawer instead of the inline
// pane; must match the `lg:` classes on the workspace grid.
const CANVAS_INLINE_QUERY = "(min-width: 1024px)";

function sleepFrame(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("cancelled"));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason ?? new Error("cancelled"));
      },
      { once: true },
    );
  });
}

function partText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("");
}

function latestUserTurn(messages: ChatModelRunOptions["messages"]): { text: string; intentHint?: AssistantIntentId } {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "user") {
      const custom = readMessageCustom(message.metadata) as { intentHint?: AssistantIntentId };
      return { text: partText(message.content).trim(), intentHint: custom.intentHint };
    }
  }
  return { text: "" };
}

function runResult(text: string, custom: Record<string, unknown>, complete?: boolean): ChatModelRunResult {
  return {
    content: text ? [{ type: "text", text }] : [],
    ...(complete ? { status: { type: "complete", reason: "stop" } } : {}),
    metadata: { custom },
  };
}

// Compact grounding payload for the live AI route. In production mode the
// grounding is the REAL fact sheet from the EPD snapshot (aggregates only);
// the demo grounding (deterministic artifact + demo KPIs) is used otherwise.
function buildGrounding(
  response: AssistantResponse,
  ctx: {
    kpis: CareonKpi[];
    filters: CareonFilters;
    source: CareonSource;
    production: ProductionSnapshot | null;
    hr: HrState;
    financieelZichtbaar: boolean;
  },
  query: string,
): string {
  if (response.artifact.intent === "verzuim-hr") {
    return JSON.stringify({
      toelichting: "Actuele handmatig bijgehouden HR-registratie; dit is de bron van waarheid voor HR-antwoorden.",
      filters: ctx.filters,
      hr: ctx.hr,
    });
  }
  if (ctx.production) {
    return buildProductionAssistantFacts(ctx.production, ctx.filters, {
      intent: response.artifact.intent,
      includeNames: /\b(behandelaar|medewerker|naam|caseload|coaching)\b/i.test(query),
      financieelZichtbaar: ctx.financieelZichtbaar,
    });
  }
  const { artifact } = response;
  return JSON.stringify({
    filters: ctx.filters,
    databron: ctx.source.label,
    // Financiële rolregel: ook de demo-KPI's (omzetkaarten) blijven voor
    // leden buiten de grounding — de server scrubt daarnaast zelf.
    cockpitKpis: ctx.kpis
      .filter((kpi) => ctx.financieelZichtbaar || kpi.page !== "financieel")
      .map((kpi) => ({ label: kpi.label, waarde: kpi.value, vorigeMaand: kpi.prev })),
    artefact: {
      intent: artifact.intent,
      pagina: artifact.pageLabel,
      visualisaties: artifact.visualizations.map((visual) => visual.title),
      bewijsvoering: artifact.claims,
      bronnen: artifact.sources,
    },
    referentieAntwoord: response.deep,
  });
}

// Prior turns (excluding the question being answered), capped server-side too.
function historyFromMessages(messages: ChatModelRunOptions["messages"]) {
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content = partText(message.content).trim();
    if (content) turns.push({ role: message.role, content });
  }
  return turns.slice(0, -1).slice(-8);
}

export function AssistentContent() {
  const { kpis, filters, source, production } = useCareon();
  const { state: hr } = useCareonHr();
  // Financiële rolregel (klantbesluit 28-07-2026): leden krijgen geen
  // financiële antwoorden, grounding of canvasinhoud; de server-route dwingt
  // dezelfde regel af.
  const { financieelZichtbaar } = useCareonSessionInfo();
  // Klantnaam voor de databron-statuskaart van de assistent.
  const orgNaam = useCareonOrgNaam();

  const [reasoningStyle, setReasoningStyle] = useState<ReasoningStyle>("standaard");
  const reasoningRef = useRef<ReasoningStyle>("standaard");
  reasoningRef.current = reasoningStyle;

  const [showThreads, setShowThreads] = useState(true);
  const [mobileThreadsOpen, setMobileThreadsOpen] = useState(false);
  const [exportPayload, setExportPayload] = useState<AssistantExportPayload | null>(null);

  // Live AI availability (OPENAI_API_KEY configured server-side). Without it
  // the assistant keeps working on the deterministic demo answers.
  const [aiLive, setAiLive] = useState(false);
  const aiLiveRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/assistant")
      .then((res) => (res.ok ? res.json() : { live: false }))
      .then((data: { live?: boolean }) => {
        if (!cancelled) {
          setAiLive(Boolean(data.live));
          aiLiveRef.current = Boolean(data.live);
        }
      })
      .catch(() => {
        // Health probe is best-effort; the deterministic fallback covers us.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [canvas, setCanvas] = useState<AssistantCanvasState>({
    artifact: null,
    pending: false,
    stage: "idle",
    selectedItemId: null,
    messageKey: null,
  });

  // On phones the canvas opens as a full-height bottom drawer; the inline
  // pane only exists from lg up. Close the drawer when crossing to desktop.
  const [mobileCanvasOpen, setMobileCanvasOpen] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(CANVAS_INLINE_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileCanvasOpen(false);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const select = useCallback((artifact: AssistantArtifact, itemId?: string | null, messageKey?: string | null) => {
    setCanvas({
      artifact,
      pending: false,
      stage: "ready",
      selectedItemId: itemId ?? defaultArtifactItemId(artifact),
      messageKey: messageKey ?? null,
    });
    if (!window.matchMedia(CANVAS_INLINE_QUERY).matches) setMobileCanvasOpen(true);
  }, []);

  // Concept-wijzigingen (handoff 11): de assistent zet acties alleen klaar;
  // hier valt de beslissing. Toepassen schrijft de concept-eindstand in één
  // keer via de provider weg (localStorage + centrale sync); Verwerpen laat
  // alles ongemoeid.
  const [concept, setConcept] = useState<AssistantConceptState | null>(null);
  const conceptRef = useRef(concept);
  conceptRef.current = concept;

  // Eén herbereken-pad voor álle canvas-bewerkingen (schrappen, uitsluiten,
  // argumenten wijzigen, expliciet herberekenen): speel de regels af op de
  // ÁCTUELE registratie en werk concept + canvas bij.
  const herberekenMetRegels = useCallback((invoer: AssistantActieRegel[], key: string, query: string) => {
    const basis = middelenRef.current.api.getState();
    const { acties, regels } = conceptActiesVan(invoer);
    const replay = replayConceptActies(acties, basis, middelenRef.current.bron);
    const bijgewerkt = mergeReplayRegels(regels, replay.resultaten);
    const artifact = buildActieArtifact(
      query,
      bijgewerkt,
      replay.staat,
      "concept",
      middelenRef.current.bron.medewerkers.length,
    );
    setConcept({
      key,
      requestIds: conceptRef.current?.key === key ? conceptRef.current.requestIds : [],
      regels: bijgewerkt,
      staat: replay.staat,
      basisUpdatedAt: basis.updatedAt,
      artifact,
      status: "open",
    });
    setCanvas((prev) => ({
      artifact,
      pending: false,
      stage: "ready",
      selectedItemId: prev.messageKey === key ? prev.selectedItemId : defaultArtifactItemId(artifact),
      messageKey: key,
    }));
  }, []);

  const verwijderConceptActie = useCallback(
    (index: number) => {
      const huidig = conceptRef.current;
      if (huidig?.status !== "open") return;
      herberekenMetRegels(
        huidig.regels.filter((_, i) => i !== index),
        huidig.key,
        huidig.artifact.query,
      );
    },
    [herberekenMetRegels],
  );

  const sluitConceptNaamUit = useCallback(
    (index: number, naam: string) => {
      const huidig = conceptRef.current;
      if (huidig?.status !== "open") return;
      const regels = huidig.regels.map((regel, i) =>
        i === index ? { ...regel, uitgesloten: [...new Set([...(regel.uitgesloten ?? []), naam])] } : regel,
      );
      herberekenMetRegels(regels, huidig.key, huidig.artifact.query);
    },
    [herberekenMetRegels],
  );

  const bewerkConceptActie = useCallback(
    (index: number, args: Record<string, unknown>) => {
      const huidig = conceptRef.current;
      if (huidig?.status !== "open") return;
      const regels = huidig.regels.map((regel, i) => (i === index ? { ...regel, args } : regel));
      herberekenMetRegels(regels, huidig.key, huidig.artifact.query);
    },
    [herberekenMetRegels],
  );

  const herberekenConcept = useCallback(() => {
    const huidig = conceptRef.current;
    if (huidig?.status !== "open") return;
    herberekenMetRegels(huidig.regels, huidig.key, huidig.artifact.query);
  }, [herberekenMetRegels]);

  // Directe rijbewerking in de concepttabel: vertaal de celwijziging naar
  // dezelfde actie-primitief als de AI gebruikt en voeg die toe aan het
  // logboek — replay vult status/melding en de tabel toont direct het effect.
  const bewerkConceptRij = useCallback(
    (naam: string, wijziging: ConceptRijWijziging) => {
      const huidig = conceptRef.current;
      if (huidig?.status !== "open") return;
      let regel: AssistantActieRegel;
      switch (wijziging.soort) {
        case "taal":
          regel = {
            tool: "wijzig_taal",
            args: { naam, taal: wijziging.waarde, actie: wijziging.aanwezig ? "toevoegen" : "verwijderen" },
            status: "ok",
            melding: "",
          };
          break;
        case "functie":
          regel = {
            tool: "zet_functie",
            args: { naam, functie: wijziging.waarde === "" ? "geen" : wijziging.waarde },
            status: "ok",
            melding: "",
          };
          break;
        case "middel":
          regel = {
            tool: "wijzig_middel",
            args: { naam, middel: wijziging.waarde, actie: wijziging.aanwezig ? "toewijzen" : "innemen" },
            status: "ok",
            melding: "",
          };
          break;
        case "team":
          regel = {
            tool: "wijzig_teamtag",
            args: { naam, team: wijziging.waarde, actie: wijziging.aanwezig ? "toevoegen" : "verwijderen" },
            status: "ok",
            melding: "",
          };
          break;
        case "dienstverband":
          regel = {
            tool: "zet_dienstverband",
            args: { naam, uitDienst: wijziging.uitDienst },
            status: "ok",
            melding: "",
          };
          break;
      }
      herberekenMetRegels([...huidig.regels, regel], huidig.key, huidig.artifact.query);
    },
    [herberekenMetRegels],
  );

  const besluitConcept = useCallback((besluit: "toepassen" | "verwerpen") => {
    const huidig = conceptRef.current;
    if (huidig?.status !== "open") return;
    if (besluit === "verwerpen") {
      recordConceptDecision(huidig, "rejected");
      setConcept({ ...huidig, status: "verworpen" });
      return;
    }
    // Toepassen = de (bewerkte) acties afspelen op de ÁCTUELE registratie en
    // die eindstand in één keer opslaan — tussentijdse handmatige wijzigingen
    // blijven zo behouden, en per regel is het echte resultaat zichtbaar.
    const basis = middelenRef.current.api.getState();
    const { acties, regels } = conceptActiesVan(huidig.regels);
    const replay = replayConceptActies(acties, basis, middelenRef.current.bron);
    const bijgewerkt = mergeReplayRegels(regels, replay.resultaten);
    middelenRef.current.api.vervangState(replay.staat, {
      source: "assistant",
      toolNames: bijgewerkt.map((regel) => regel.tool),
      requestIds: huidig.requestIds,
    });
    recordConceptDecision({ ...huidig, regels: bijgewerkt }, "applied");
    const toegepast = buildActieArtifact(
      huidig.artifact.query,
      bijgewerkt,
      replay.staat,
      "toegepast",
      middelenRef.current.bron.medewerkers.length,
    );
    setConcept({ ...huidig, regels: bijgewerkt, staat: replay.staat, artifact: toegepast, status: "toegepast" });
    setCanvas((prev) => ({
      artifact: toegepast,
      pending: false,
      stage: "ready",
      selectedItemId: prev.messageKey === huidig.key ? prev.selectedItemId : defaultArtifactItemId(toegepast),
      messageKey: huidig.key,
    }));
  }, []);

  const canvasValue = useMemo(
    () => ({
      ...canvas,
      select,
      concept,
      besluitConcept,
      bewerkConceptRij,
      verwijderConceptActie,
      sluitConceptNaamUit,
      bewerkConceptActie,
      herberekenConcept,
    }),
    [
      canvas,
      select,
      concept,
      besluitConcept,
      bewerkConceptRij,
      verwijderConceptActie,
      sluitConceptNaamUit,
      bewerkConceptActie,
      herberekenConcept,
    ],
  );

  // Everything the turn generator needs, via a ref so the adapter identity
  // stays stable while filters/source/kpis change between turns.
  const turnContextRef = useRef({ kpis, filters, source, production, hr, financieelZichtbaar, orgNaam });
  turnContextRef.current = { kpis, filters, source, production, hr, financieelZichtbaar, orgNaam };

  // Middelen-registratie + databron-kandidaten voor assistent-acties
  // (handoff 11): zelfde bron-afleiding als de pagina Medewerkers & middelen.
  const middelen = useCareonMiddelen();
  const middelenBron = useMemo<MiddelenBron>(
    () =>
      production
        ? {
            medewerkers: production.dossiersProductie.medewerkers.map((medewerker) => medewerker.naam),
            locaties: [
              ...new Set(
                production.records
                  .map((record) => record.vestiging)
                  .filter((vestiging): vestiging is string => vestiging !== null),
              ),
            ].sort((a, b) => a.localeCompare(b, "nl")),
          }
        : {
            medewerkers: BEHANDELAREN.map((behandelaar) => behandelaar.naam),
            locaties: CAREON_LOCATIONS.filter((locatie) => locatie !== "Alle locaties"),
          },
    [production],
  );
  const middelenRef = useRef({ api: middelen, bron: middelenBron });
  middelenRef.current = { api: middelen, bron: middelenBron };

  const runTurn = useCallback(async function* run(options: ChatModelRunOptions): AsyncGenerator<ChatModelRunResult> {
    const { text, intentHint } = latestUserTurn(options.messages);
    if (!text) {
      yield runResult("", {}, true);
      return;
    }

    // Financiële rolregel: leden krijgen op financiële vragen een vaste
    // weigering — geen servercall, geen canvas. De server-route dwingt
    // dezelfde regel onafhankelijk af.
    if (
      !turnContextRef.current.financieelZichtbaar &&
      (isFinancieleAssistentVraag(text) || intentHint === "financieel-omzet")
    ) {
      for (let index = STREAM_CHUNK; index < FINANCIEEL_WEIGERTEKST.length; index += STREAM_CHUNK) {
        yield runResult(FINANCIEEL_WEIGERTEKST.slice(0, index), {});
        await sleepFrame(STREAM_FRAME_MS, options.abortSignal);
      }
      yield runResult(FINANCIEEL_WEIGERTEKST, {}, true);
      return;
    }

    setCanvas((prev) => ({ ...prev, pending: true, stage: "thinking" }));
    try {
      yield runResult("", { visualPending: true });

      const resolvedResponse = resolveAssistantResponse(text, turnContextRef.current, intentHint);
      // Vangnet naast de vraagclassificatie: routeert de intentie-inferentie
      // (bijv. op "verzekeraar") alsnog naar het financiële domein, dan geldt
      // dezelfde weigering — er wordt nooit een financieel canvas opgebouwd.
      if (!turnContextRef.current.financieelZichtbaar && resolvedResponse.artifact.intent === "financieel-omzet") {
        setCanvas((prev) => ({ ...prev, pending: false, stage: prev.artifact ? "ready" : "idle" }));
        for (let index = STREAM_CHUNK; index < FINANCIEEL_WEIGERTEKST.length; index += STREAM_CHUNK) {
          yield runResult(FINANCIEEL_WEIGERTEKST.slice(0, index), {});
          await sleepFrame(STREAM_FRAME_MS, options.abortSignal);
        }
        yield runResult(FINANCIEEL_WEIGERTEKST, {}, true);
        return;
      }
      const opgebouwd =
        aiLiveRef.current && turnContextRef.current.production && resolvedResponse.artifact.intent !== "verzuim-hr"
          ? {
              ...resolvedResponse,
              artifact: buildProductionAssistantArtifact(
                resolvedResponse.artifact,
                turnContextRef.current.production,
                turnContextRef.current.filters,
              ),
            }
          : resolvedResponse;
      // Ook niet-financiële beurten dragen voor leden geen financiële tegels,
      // claims of zinnen in canvas en kernantwoord (demo-/terugvalpad).
      const response = turnContextRef.current.financieelZichtbaar
        ? opgebouwd
        : redigeerFinancieleAssistentResponse(opgebouwd);
      const messageKey = `turn-${Date.now()}`;
      const commitCanvas = () =>
        setCanvas({
          artifact: response.artifact,
          pending: false,
          stage: "ready",
          selectedItemId: defaultArtifactItemId(response.artifact),
          messageKey,
        });

      // Zonder live AI kan de assistent geen wijzigingen uitvoeren — leg dat
      // uit in plaats van een los deterministisch kernantwoord te tonen.
      if (!aiLiveRef.current && isMiddelenAction(text)) {
        setCanvas((prev) => ({ ...prev, pending: false, stage: prev.artifact ? "ready" : "idle" }));
        for (let index = STREAM_CHUNK; index < OFFLINE_ACTIE_NOTICE.length; index += STREAM_CHUNK) {
          yield runResult(OFFLINE_ACTIE_NOTICE.slice(0, index), {});
          await sleepFrame(STREAM_FRAME_MS, options.abortSignal);
        }
        yield runResult(OFFLINE_ACTIE_NOTICE, {}, true);
        return;
      }

      // Live path: stream the answer from the server-side OpenAI route. The
      // artifact/canvas stays deterministic — only the narrative is generated.
      // Actiepad (handoff 11): het model kan middelen-tools aanroepen; die
      // voeren we hier client-side uit op de provider-mutators en het
      // tussentranscript gaat als `steps` terug voor de vervolgronde.
      if (aiLiveRef.current) {
        const liveParts: ThreadAssistantMessagePart[] = [];
        // Acties draaien tegen een concept-kopie — er wordt in deze beurt
        // niets opgeslagen. Een openstaand concept bouwt door (zo kan de
        // gebruiker het via de chat laten aanpassen vóór goedkeuring).
        const openConcept = conceptRef.current?.status === "open" ? conceptRef.current : null;
        const conceptBasis = openConcept ? openConcept.staat : middelenRef.current.api.getState();
        const conceptApi = createConceptMiddelenApi(conceptBasis);
        const uitgevoerd: AssistantActieRegel[] = openConcept ? [...openConcept.regels] : [];
        const requestIds = new Set(openConcept?.requestIds ?? []);
        const conversationHistory = historyFromMessages(options.messages);
        // Het model krijgt bij iedere live beurt de volledige operationele
        // toolset. Het kiest zelf of en welke tools nodig zijn; uitvoering
        // blijft veilig binnen de bestaande, nog niet opgeslagen concept-kopie.
        const selectedTools = [...MIDDELEN_TOOL_NAMES];
        const notesRelevant = includeMiddelenNotes(text);
        // AVG (handoff 11): pure tellingen worden met aggregaten beantwoord —
        // dan verlaat de personeelsregistratie deze browser niet.
        const namesRelevant = includeMiddelenNamesForTurn(text, openConcept !== null);
        let toolsUsed = false;
        // Aankondigings-vangnet: één deterministische por wanneer het model
        // acties aankondigt maar stopt zonder tool-aanroepen.
        const porHistorie: { role: "user" | "assistant"; content: string }[] = [];
        let gepord = false;
        let aankondigingZonderTools = false;
        const liveCustom = () => ({ visualPending: true });
        const afgebrokenNaActies: ThreadAssistantMessagePart = {
          type: "text",
          text: "\n\nDe verbinding met de AI-dienst viel weg; het tot nu toe klaargezette concept staat in het canvas — er is niets opgeslagen.",
        };
        // Actiebeurten sluiten af met het concept-artefact in het canvas: de
        // voorgestelde acties plus de registratie zoals die er ná toepassing
        // uit zou zien, met de goedkeuringsbalk (Toepassen / Verwerpen).
        const commitConceptCanvas = () => {
          const staat = conceptApi.huidig();
          const conceptArtifact = buildActieArtifact(
            text,
            uitgevoerd,
            staat,
            "concept",
            middelenRef.current.bron.medewerkers.length,
          );
          setConcept({
            key: messageKey,
            requestIds: [...requestIds],
            regels: [...uitgevoerd],
            staat,
            basisUpdatedAt: conceptBasis.updatedAt,
            artifact: conceptArtifact,
            status: "open",
          });
          setCanvas({
            artifact: conceptArtifact,
            pending: false,
            stage: "ready",
            selectedItemId: defaultArtifactItemId(conceptArtifact),
            messageKey,
          });
          return { artifact: conceptArtifact, artifactKey: messageKey, cite: CONCEPT_CITE };
        };
        try {
          const conceptNotitie = openConcept
            ? [
                "",
                "OPENSTAAND CONCEPT (nog niet toegepast; nieuwe acties bouwen hierop voort):",
                ...openConcept.regels.map((regel) => `- ${regel.melding}`),
              ].join("\n")
            : "";
          const grounding = assembleAssistantContext(
            buildGrounding(response, turnContextRef.current, text),
            middelenGrounding(conceptBasis, middelenRef.current.bron, {
              includeNotes: notesRelevant,
              includeNames: namesRelevant,
            }),
            conceptNotitie,
          );
          const steps: unknown[] = [];
          let klaar = false;

          for (let ronde = 0; ronde < MAX_ACTIE_RONDES && !klaar; ronde += 1) {
            const res = await fetch("/api/assistant", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-careon-assistant": "1",
                "x-careon-session": getCareonAssistantSessionId(),
              },
              signal: options.abortSignal,
              body: JSON.stringify({
                question: text,
                style: reasoningRef.current,
                context: grounding,
                history: [...conversationHistory, ...porHistorie],
                steps,
                events: true,
                tools: true,
                allowedTools: selectedTools,
                // Na de por dwingt de server tool-gebruik af (tool_choice
                // "required") zodat een tweede aankondiging onmogelijk is.
                forceerTools: gepord && !toolsUsed,
              }),
            });
            if (!res.ok || !res.body) {
              if (!toolsUsed) throw new Error("AI-dienst niet beschikbaar");
              liveParts.push(afgebrokenNaActies);
              yield {
                content: [...liveParts],
                status: { type: "complete", reason: "stop" },
                metadata: { custom: commitConceptCanvas() },
              };
              return;
            }
            if (ronde === 0) setCanvas((prev) => ({ ...prev, pending: true, stage: "assembling" }));

            let rondeTekst = "";
            const rondeCalls: { id: string; name: string; args: string }[] = [];
            let reden: "stop" | "tool_calls" = "stop";
            for await (const event of readWireEvents(res.body)) {
              if (event.t === "meta") {
                requestIds.add(event.requestId);
              } else if (event.t === "text") {
                rondeTekst += event.d;
                yield {
                  content: [...liveParts, { type: "text", text: rondeTekst }],
                  metadata: { custom: liveCustom() },
                };
              } else if (event.t === "tool") {
                rondeCalls.push({ id: event.id, name: event.name, args: event.args });
              } else if (event.t === "error") {
                throw new Error(event.message);
              } else if (event.t === "done") {
                reden = event.reason;
              }
            }
            if (rondeTekst) liveParts.push({ type: "text", text: rondeTekst });

            if (reden !== "tool_calls" || rondeCalls.length === 0) {
              // Bekend modelpatroon: "ik zet het concept nu klaar" en dan
              // stoppen zónder tools. Eén por met de expliciete instructie het
              // nú uit te voeren; blijft het daarna uit, dan sluiten we af
              // zonder het lees-artefact aan de aankondiging te koppelen.
              if (!toolsUsed && lijktActieAankondiging(rondeTekst)) {
                aankondigingZonderTools = true;
                if (!gepord) {
                  gepord = true;
                  porHistorie.push(
                    { role: "assistant", content: rondeTekst },
                    {
                      role: "user",
                      content:
                        "Je kondigde acties aan maar riep geen tools aan. Voer de opdracht nu direct uit, kies zelf de benodigde tools en geef geen nieuwe aankondiging.",
                    },
                  );
                  continue;
                }
              }
              klaar = true;
              break;
            }
            aankondigingZonderTools = false;

            // Acties uitvoeren: elke aanroep toont een tool-kaart die na
            // uitvoering het resultaat draagt; het canvas volgt aan het einde
            // van de beurt met het actie-artefact.
            toolsUsed = true;
            steps.push({
              role: "assistant",
              content: rondeTekst || null,
              tool_calls: rondeCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.args },
              })),
            });
            for (const call of rondeCalls) {
              let args: ToolCallMessagePart["args"] = {};
              let parseFout = false;
              try {
                const parsed: unknown = JSON.parse(call.args);
                if (typeof parsed === "object" && parsed !== null) {
                  args = parsed as ToolCallMessagePart["args"];
                  if (call.name === "lees_middelen_registratie") {
                    // Zelfde privacygrens als de grounding: het lees-resultaat
                    // gaat als tool-transcript terug naar de provider.
                    args = { ...args, inclusiefNotities: notesRelevant, inclusiefNamen: namesRelevant };
                  }
                } else parseFout = true;
              } catch {
                parseFout = true;
              }
              const index =
                liveParts.push({
                  type: "tool-call",
                  toolCallId: call.id,
                  toolName: call.name,
                  args,
                  argsText: call.args,
                }) - 1;
              yield { content: [...liveParts], metadata: { custom: liveCustom() } };
              const resultaat: MiddelenActieResultaat = parseFout
                ? { status: "fout", melding: "Ongeldige tool-argumenten (geen geldige JSON)." }
                : executeMiddelenTool(call.name, args, conceptApi.api, middelenRef.current.bron);
              uitgevoerd.push({
                tool: call.name,
                status: resultaat.status,
                melding: resultaat.melding,
                // Argumenten maken de regel her-afspeelbaar: bewerken in het
                // canvas en Toepassen-op-actuele-stand replayen hiermee.
                args: args as Record<string, unknown>,
                naam: resultaat.naam,
                namen: resultaat.namen,
                locatie: resultaat.locatie,
              });
              liveParts[index] = {
                ...(liveParts[index] as ToolCallMessagePart),
                result: resultaat,
                isError: resultaat.status === "fout",
              };
              yield { content: [...liveParts], metadata: { custom: liveCustom() } };
              steps.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(resultaat) });
            }
          }

          if (!klaar) {
            liveParts.push({
              type: "text",
              text: "\n\nMaximaal aantal actierondes bereikt — beoordeel het klaargezette concept in het canvas; vraag eventueel om de resterende acties in een vervolgbeurt.",
            });
          }

          if (toolsUsed) {
            yield {
              content: [...liveParts],
              status: { type: "complete", reason: "stop" },
              metadata: { custom: commitConceptCanvas() },
            };
            return;
          }

          const totaleTekst = liveParts.map((part) => (part.type === "text" ? part.text : "")).join("");
          if (totaleTekst.trim() && aankondigingZonderTools) {
            // Ook na de por geen tool-aanroepen: eerlijk afsluiten zonder het
            // (ongerelateerde) lees-artefact aan de aankondiging te hangen.
            setCanvas((prev) => ({ ...prev, pending: false, stage: prev.artifact ? "ready" : "idle" }));
            liveParts.push({
              type: "text",
              text: "\n\n(Er is geen concept klaargezet — stel het verzoek opnieuw, eventueel specifieker of in kleinere stappen.)",
            });
            yield {
              content: [...liveParts],
              status: { type: "complete", reason: "stop" },
              metadata: { custom: {} },
            };
            return;
          }
          if (totaleTekst.trim()) {
            commitCanvas();
            yield {
              content: [...liveParts],
              status: { type: "complete", reason: "stop" },
              metadata: {
                custom: {
                  artifact: response.artifact,
                  artifactKey: messageKey,
                  cite: liveAnswerCite(response.artifact.intent, turnContextRef.current.production),
                },
              },
            };
            return;
          }
          // Leeg live-antwoord zonder acties — door naar het deterministische pad.
        } catch (error) {
          if (options.abortSignal.aborted) throw error;
          if (toolsUsed) {
            // Nooit terugvallen op het deterministische standaardantwoord
            // nadat er acties zijn uitgevoerd — dat zou de actie-samenvatting
            // vervangen door een los kernantwoord over een ander onderwerp.
            liveParts.push(afgebrokenNaActies);
            yield {
              content: [...liveParts],
              status: { type: "complete", reason: "stop" },
              metadata: { custom: commitConceptCanvas() },
            };
            return;
          }
          // Live route failed — continue into the deterministic fallback.
        }
      }

      // Deterministic fallback (also the demo mode without a configured key).
      await sleepFrame(420, options.abortSignal);
      const target = reasoningRef.current === "diep" ? response.deep : response.brief;

      setCanvas((prev) => ({ ...prev, pending: true, stage: "assembling" }));
      for (let index = STREAM_CHUNK; index < target.length; index += STREAM_CHUNK) {
        yield runResult(target.slice(0, index), { visualPending: true });
        await sleepFrame(STREAM_FRAME_MS, options.abortSignal);
      }

      commitCanvas();
      yield runResult(
        target,
        {
          artifact: response.artifact,
          artifactKey: messageKey,
          cite: response.artifact.intent === "verzuim-hr" ? HR_CITE : CITE,
        },
        true,
      );
    } catch (error) {
      setCanvas((prev) =>
        prev.stage === "ready" ? prev : { ...prev, pending: false, stage: prev.artifact ? "ready" : "idle" },
      );
      if (!options.abortSignal.aborted) throw error;
    }
  }, []);

  const adapter = useMemo(() => ({ run: runTurn }), [runTurn]);
  // Financiële rolregel: teruggelezen beurten (server én lokale cache van
  // een eerdere admin-sessie) worden voor leden geredigeerd.
  const threadListAdapter = useMemo(
    () => new CareonAssistantThreadListAdapter(financieelZichtbaar),
    [financieelZichtbaar],
  );
  const runtime = useRemoteThreadListRuntime({
    adapter: threadListAdapter,
    runtimeHook: function CareonAssistantThreadRuntime() {
      // biome-ignore lint/correctness/useHookAtTopLevel: runtimeHook is invoked as a React hook by useRemoteThreadListRuntime
      return useLocalRuntime(adapter);
    },
  });

  const hasCanvas = Boolean(canvas.artifact || canvas.pending);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantCanvasContext.Provider value={canvasValue}>
        {/* The frame is viewport-locked via globals.css (body:has locks the
            document); this node just fills the flex column under the header. */}
        <div data-content-padding="false" data-careon-assistant className="assistant-workspace flex min-h-0 flex-1">
          <aside
            className={cn(
              "hidden w-60 shrink-0 flex-col gap-3 overflow-y-auto border-e p-3 md:flex",
              !showThreads && "md:hidden",
            )}
          >
            <ThreadList labels={THREAD_LIST_LABELS} />
            <AssistantSourceFootnote aiLive={aiLive} />
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-12 shrink-0 items-center gap-2 border-b px-3">
              <Button
                variant="ghost"
                size="icon"
                className="hidden size-8 md:inline-flex"
                aria-label="Chatlijst tonen of verbergen"
                onClick={() => setShowThreads((prev) => !prev)}
              >
                <PanelLeft className="size-4" />
              </Button>
              {/* On mobile the thread list lives in a slide-in sheet. */}
              <Sheet open={mobileThreadsOpen} onOpenChange={setMobileThreadsOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8 md:hidden" aria-label="Chatlijst openen">
                    <PanelLeft className="size-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="flex w-72 flex-col gap-0">
                  <SheetHeader className="pb-2">
                    <SheetTitle className="text-sm">Chats</SheetTitle>
                  </SheetHeader>
                  <div className="min-h-0 flex-1 overflow-y-auto px-3">
                    <ThreadList labels={THREAD_LIST_LABELS} onThreadSelect={() => setMobileThreadsOpen(false)} />
                  </div>
                  <div className="p-3">
                    <AssistantSourceFootnote aiLive={aiLive} />
                  </div>
                </SheetContent>
              </Sheet>
              <div className="flex min-w-0 items-center gap-2">
                <Activity className="size-4 shrink-0 text-primary" />
                <h1 className="truncate font-semibold text-sm">Careon AI-assistent</h1>
              </div>
              <div className="ms-auto flex items-center gap-2">
                <ToggleGroup
                  type="single"
                  size="sm"
                  variant="outline"
                  value={reasoningStyle}
                  onValueChange={(value) => {
                    if (value) setReasoningStyle(value as ReasoningStyle);
                  }}
                  aria-label="Antwoordstijl"
                >
                  <ToggleGroupItem value="standaard" className="gap-1.5 px-2.5">
                    <Zap className="size-3.5" />
                    <span className="hidden sm:inline">Standaard</span>
                  </ToggleGroupItem>
                  <ToggleGroupItem value="diep" className="gap-1.5 px-2.5">
                    <Brain className="size-3.5" />
                    <span className="hidden sm:inline">Diep</span>
                  </ToggleGroupItem>
                </ToggleGroup>
                <ExportConversationButton onExport={setExportPayload} />
              </div>
            </div>

            <div
              className={cn(
                "grid min-h-0 flex-1 grid-cols-1 gap-4 p-4",
                // On mobile the chat keeps the full height (the canvas opens
                // in a bottom drawer); from lg the two sit side by side.
                hasCanvas && "lg:[grid-template-columns:minmax(0,1.1fr)_minmax(320px,0.9fr)]",
              )}
            >
              <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                <Thread
                  assistantExtras={AssistantMessageExtras}
                  composerAriaLabel="Bericht aan de Careon-assistent"
                  composerPlaceholder="Stel een vraag over de organisatie..."
                  threadMaxWidth="100%"
                  labels={{
                    copy: "Kopiëren",
                    edit: "Bewerken",
                    cancel: "Annuleren",
                    update: "Bijwerken",
                    exportMarkdown: "Exporteren als Markdown",
                    more: "Meer",
                    refresh: "Opnieuw",
                    scrollToBottom: "Naar beneden scrollen",
                    sendMessage: "Bericht versturen",
                    stopGenerating: "Stoppen met genereren",
                    welcomeTitle: "Goedendag!",
                    welcomeSubtitle: financieelZichtbaar
                      ? "Vraag naar patiënten, planning, financiën, kwaliteit of HR."
                      : "Vraag naar patiënten, planning, kwaliteit of HR.",
                  }}
                  footerBeforeComposer={
                    <div className="flex flex-col gap-2">
                      <AssistantCanvasDock onOpen={() => setMobileCanvasOpen(true)} />
                      <AssistantSourceMeta aiLive={aiLive} />
                      <AssistantQuickPrompts />
                    </div>
                  }
                />
              </div>
              {hasCanvas ? (
                <AssistantArtifactCanvas
                  className="hidden lg:flex"
                  onExport={(artifact) =>
                    setExportPayload({
                      mode: "artifact",
                      turns: [{ id: "artifact", question: "", answer: "", artifact }],
                    })
                  }
                />
              ) : null}
            </div>
          </div>
        </div>

        {/* Mobile canvas: full-height bottom drawer with the same artifact canvas. */}
        <Drawer open={mobileCanvasOpen && hasCanvas} onOpenChange={setMobileCanvasOpen}>
          <DrawerContent
            aria-describedby={undefined}
            className="h-[92dvh] data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-1 pb-2">
              <DrawerTitle className="text-sm">Artefact-canvas</DrawerTitle>
              <DrawerClose asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label="Canvas sluiten">
                  <X className="size-4" />
                </Button>
              </DrawerClose>
            </div>
            <div className="flex min-h-0 flex-1 flex-col pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <AssistantArtifactCanvas
                className="flex-1 rounded-none border-0 bg-transparent"
                onExport={(artifact) =>
                  setExportPayload({
                    mode: "artifact",
                    turns: [{ id: "artifact", question: "", answer: "", artifact }],
                  })
                }
              />
            </div>
          </DrawerContent>
        </Drawer>

        {exportPayload ? (
          <AssistantExportOverlay payload={exportPayload} source={source} onClose={() => setExportPayload(null)} />
        ) : null}
      </AssistantCanvasContext.Provider>
    </AssistantRuntimeProvider>
  );
}

function AssistantSourceFootnote({ aiLive, className }: Readonly<{ aiLive: boolean; className?: string }>) {
  const { source } = useCareon();
  return (
    <div className={cn("mt-auto flex flex-col gap-1.5 border-t pt-3 text-muted-foreground text-xs", className)}>
      <div className="flex items-center gap-2">
        <span
          className={cn("size-2 shrink-0 rounded-full", aiLive ? "animate-pulse bg-emerald-500" : "bg-amber-500")}
        />
        {aiLive ? "Live AI actief · via beveiligde server" : "Lokale preview · geen live AI"}
      </div>
      {isSupabaseAuthMode() && (
        // AVG-transparantie (handoff 13): verplicht zolang de superadmin
        // gesprekken kan inzien; retentietermijn = CAREON_ASSISTANT_CHAT_RETENTION_DAYS.
        <p>
          Gesprekken worden centraal per account bewaard (maximaal 30 dagen) en kunnen door de platformbeheerder worden
          ingezien.
        </p>
      )}
      {source.mode === "productie" &&
        (aiLive ? (
          <p>
            De AI-analyse gebruikt de geïmporteerde EPD-export: uitsluitend geaggregeerde cijfers, geen cliëntgegevens.
          </p>
        ) : (
          <p className="text-amber-700 dark:text-amber-400">
            Zonder live AI vallen antwoorden terug op de demo-referentie; activeer de AI-koppeling voor analyse van de
            EPD-export.
          </p>
        ))}
    </div>
  );
}

function AssistantSourceMeta({ aiLive }: Readonly<{ aiLive: boolean }>) {
  const { filters, source } = useCareon();
  const scope = [
    filters.locatie !== "Alle locaties" ? filters.locatie : null,
    filters.team !== "Alle teams" ? filters.team : null,
  ].filter(Boolean);
  let analysisLabel = source.label;
  if (source.mode === "productie") {
    analysisLabel = aiLive ? "Analyse: EPD-export" : "Analyse: demo-dataset";
  }

  return (
    // Hidden on phones: the footer must stay compact there and the same
    // status lives in the top bar and the thread-list footnote.
    <div className="flex flex-wrap items-center gap-1.5 text-xs max-sm:hidden">
      <Badge variant="outline" className="gap-1.5 font-normal">
        <span className={cn("size-1.5 rounded-full", aiLive ? "animate-pulse bg-emerald-500" : "bg-amber-500")} />
        {aiLive ? "Live AI" : "Demo-AI"}
      </Badge>
      <Badge variant="outline" className="gap-1.5 font-normal">
        <span
          className={cn(
            "size-1.5 rounded-full",
            source.mode === "api" ? "animate-pulse bg-emerald-500" : "bg-amber-500",
          )}
        />
        {/* Eerlijk per pad: live AI analyseert de EPD-export; het
            deterministische terugvalpad rekent op de demo-dataset. */}
        {analysisLabel}
      </Badge>
      <Badge variant="outline" className="font-normal tabular-nums">
        {COCKPIT_KPIS.length} KPI&apos;s
      </Badge>
      <Badge variant="outline" className="font-normal tabular-nums">
        {CAREON_ALERTS.length} signaleringen
      </Badge>
      <Badge variant="outline" className="font-normal tabular-nums">
        {CAREON_MONTHLY.length} maanden
      </Badge>
      {scope.length ? (
        <Badge variant="outline" className="font-normal">
          Filter: {scope.join(" · ")}
        </Badge>
      ) : null}
    </div>
  );
}

// Mobile-only entry to the canvas drawer, docked above the composer: shows
// the assembly stage while a turn runs and the ready artifact afterwards.
function AssistantCanvasDock({ onOpen }: Readonly<{ onOpen: () => void }>) {
  const { artifact, pending, stage } = useAssistantCanvas();

  if (!artifact && !pending) return null;

  if (pending || !artifact) {
    return (
      <div className="flex min-h-10 items-center gap-2.5 rounded-xl border border-dashed px-3 py-2 text-muted-foreground text-xs lg:hidden">
        <Loader2 className="size-4 shrink-0 animate-spin" />
        {stage === "thinking" ? "Bronnen lezen en nadenken…" : "Canvas samenstellen…"}
      </div>
    );
  }

  const items = assistantArtifactItems(artifact);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-start transition-colors hover:bg-primary/10 lg:hidden"
    >
      <BarChart3 className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-xs leading-tight">Canvas bekijken</span>
        <span className="block truncate text-muted-foreground text-xs">
          {ASSISTANT_INTENT_META[artifact.intent].label} ·{" "}
          {items.length === 1 ? "1 onderdeel" : `${items.length} onderdelen`}
        </span>
      </span>
      <ChevronUp className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5" />
    </button>
  );
}

function AssistantQuickPrompts() {
  const threadRuntime = useThreadRuntime();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const isEmpty = useAuiState((s) => s.thread.isEmpty);
  // Financiële rolregel: de omzet-promptchip bestaat voor leden niet.
  const { financieelZichtbaar } = useCareonSessionInfo();
  const prompts = ASSISTANT_QUICK_PROMPTS.filter((prompt) => financieelZichtbaar || prompt.id !== "financieel-omzet");

  return (
    // One horizontally scrollable row on phones; wraps normally from sm up.
    // Once the conversation runs, phones drop the row to keep the composer
    // footer short (the prompts stay available from sm up).
    <div
      className={cn(
        "flex gap-1.5 overflow-x-auto pb-1 max-sm:-mx-4 max-sm:px-4 sm:flex-wrap sm:overflow-visible sm:pb-0",
        !isEmpty && "max-sm:hidden",
      )}
    >
      {prompts.map((prompt) => (
        <Button
          key={prompt.id}
          type="button"
          variant="outline"
          size="sm"
          disabled={isRunning}
          className="h-7 shrink-0 rounded-full px-3 font-normal text-xs sm:shrink"
          onClick={() =>
            threadRuntime.append({
              role: "user",
              content: [{ type: "text", text: prompt.text }],
              metadata: { custom: { intentHint: prompt.id } },
              startRun: true,
            })
          }
        >
          {prompt.text}
        </Button>
      ))}
    </div>
  );
}

function ExportConversationButton({ onExport }: Readonly<{ onExport: (payload: AssistantExportPayload) => void }>) {
  const threadRuntime = useThreadRuntime();
  const isEmpty = useAuiState((s) => s.thread.isEmpty);

  const handleExport = () => {
    const messages = threadRuntime.getState().messages;
    const turns: AssistantExportTurn[] = [];
    let question = "";
    for (const message of messages) {
      if (message.role === "user") {
        question = partText(message.content);
      } else if (message.role === "assistant") {
        const custom = readMessageCustom(message.metadata);
        turns.push({ id: message.id, question, answer: partText(message.content), artifact: custom.artifact });
        question = "";
      }
    }
    if (turns.length) onExport({ mode: "conversation", turns });
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={isEmpty}
          onClick={handleExport}
          aria-label="Gesprek exporteren als PDF"
        >
          <Printer className="size-3.5" />
          <span className="hidden sm:inline">Exporteren</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Gesprek afdrukken of opslaan als PDF</TooltipContent>
    </Tooltip>
  );
}
