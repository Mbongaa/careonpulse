"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import {
  AssistantRuntimeProvider,
  type ChatModelRunOptions,
  type ChatModelRunResult,
  useAuiState,
  useLocalRuntime,
  useRemoteThreadListRuntime,
  useThreadRuntime,
} from "@assistant-ui/react";
import { Activity, Brain, PanelLeft, Printer, Zap } from "lucide-react";

import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadList, type ThreadListLabels } from "@/components/assistant-ui/thread-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CAREON_ALERTS } from "@/data/careon/careon-alerts";
import {
  ASSISTANT_QUICK_PROMPTS,
  type AssistantArtifact,
  type AssistantIntentId,
  resolveAssistantResponse,
} from "@/data/careon/careon-assistant";
import { COCKPIT_KPIS } from "@/data/careon/careon-kpis";
import { CAREON_MONTHLY } from "@/data/careon/careon-shared-charts";
import { cn } from "@/lib/utils";

import { AssistantArtifactCanvas } from "./assistant-canvas";
import {
  AssistantCanvasContext,
  type AssistantCanvasState,
  defaultArtifactItemId,
  readMessageCustom,
} from "./assistant-context";
import { AssistantExportOverlay, type AssistantExportPayload, type AssistantExportTurn } from "./assistant-export";
import { AssistantMessageExtras } from "./assistant-extras";
import { CareonAssistantThreadListAdapter } from "./assistant-thread-list-adapter";

const STREAM_CHUNK = 6;
const STREAM_FRAME_MS = 16;
const CITE = "Bron: geauditeerde Careon Pulse demo-dataset · deterministisch antwoord zonder live AI-model";

const THREAD_LIST_LABELS: ThreadListLabels = {
  archive: "Archiveren",
  delete: "Verwijderen",
  loadingThreads: "Chats laden",
  moreOptions: "Meer opties",
  newChat: "Nieuwe chat",
  newThread: "Nieuwe chat",
};

type ReasoningStyle = "standaard" | "diep";

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

export function AssistentContent() {
  const { kpis, filters, source } = useCareon();

  const [reasoningStyle, setReasoningStyle] = useState<ReasoningStyle>("standaard");
  const reasoningRef = useRef<ReasoningStyle>("standaard");
  reasoningRef.current = reasoningStyle;

  const [showThreads, setShowThreads] = useState(true);
  const [mobileThreadsOpen, setMobileThreadsOpen] = useState(false);
  const [exportPayload, setExportPayload] = useState<AssistantExportPayload | null>(null);

  const [canvas, setCanvas] = useState<AssistantCanvasState>({
    artifact: null,
    pending: false,
    stage: "idle",
    selectedItemId: null,
    messageKey: null,
  });

  const select = useCallback((artifact: AssistantArtifact, itemId?: string | null, messageKey?: string | null) => {
    setCanvas({
      artifact,
      pending: false,
      stage: "ready",
      selectedItemId: itemId ?? defaultArtifactItemId(artifact),
      messageKey: messageKey ?? null,
    });
  }, []);

  const canvasValue = useMemo(() => ({ ...canvas, select }), [canvas, select]);

  // Everything the turn generator needs, via a ref so the adapter identity
  // stays stable while filters/source/kpis change between turns.
  const turnContextRef = useRef({ kpis, filters, source });
  turnContextRef.current = { kpis, filters, source };

  const runTurn = useCallback(async function* run(options: ChatModelRunOptions): AsyncGenerator<ChatModelRunResult> {
    const { text, intentHint } = latestUserTurn(options.messages);
    if (!text) {
      yield runResult("", {}, true);
      return;
    }

    setCanvas((prev) => ({ ...prev, pending: true, stage: "thinking" }));
    try {
      yield runResult("", { visualPending: true });
      await sleepFrame(420, options.abortSignal);

      const response = resolveAssistantResponse(text, turnContextRef.current, intentHint);
      const target = reasoningRef.current === "diep" ? response.deep : response.brief;
      const messageKey = `turn-${Date.now()}`;

      setCanvas((prev) => ({ ...prev, pending: true, stage: "assembling" }));
      for (let index = STREAM_CHUNK; index < target.length; index += STREAM_CHUNK) {
        yield runResult(target.slice(0, index), { visualPending: true });
        await sleepFrame(STREAM_FRAME_MS, options.abortSignal);
      }

      setCanvas({
        artifact: response.artifact,
        pending: false,
        stage: "ready",
        selectedItemId: defaultArtifactItemId(response.artifact),
        messageKey,
      });
      yield runResult(target, { artifact: response.artifact, artifactKey: messageKey, cite: CITE }, true);
    } catch (error) {
      setCanvas((prev) =>
        prev.stage === "ready" ? prev : { ...prev, pending: false, stage: prev.artifact ? "ready" : "idle" },
      );
      if (!options.abortSignal.aborted) throw error;
    }
  }, []);

  const adapter = useMemo(() => ({ run: runTurn }), [runTurn]);
  const threadListAdapter = useMemo(() => new CareonAssistantThreadListAdapter(), []);
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
        <div
          data-content-padding="false"
          data-careon-assistant
          className="assistant-workspace flex h-[calc(100dvh-var(--dashboard-header-height,3rem))] min-h-0"
        >
          <aside
            className={cn(
              "hidden w-60 shrink-0 flex-col gap-3 overflow-y-auto border-e p-3 md:flex",
              !showThreads && "md:hidden",
            )}
          >
            <ThreadList labels={THREAD_LIST_LABELS} />
            <AssistantSourceFootnote />
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
                    <AssistantSourceFootnote />
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
                // On mobile the canvas stacks under the chat in a capped row;
                // from lg the two sit side by side exactly as before.
                hasCanvas &&
                  "grid-rows-[minmax(0,1fr)_auto] lg:grid-rows-none lg:[grid-template-columns:minmax(0,1.1fr)_minmax(320px,0.9fr)]",
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
                    welcomeSubtitle: "Vraag naar patiënten, planning, financiën, kwaliteit of HR.",
                  }}
                  footerBeforeComposer={
                    <div className="flex flex-col gap-2">
                      <AssistantSourceMeta />
                      <AssistantQuickPrompts />
                    </div>
                  }
                />
              </div>
              {hasCanvas ? (
                <AssistantArtifactCanvas
                  className="max-h-[45dvh] lg:max-h-none"
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

        {exportPayload ? (
          <AssistantExportOverlay payload={exportPayload} source={source} onClose={() => setExportPayload(null)} />
        ) : null}
      </AssistantCanvasContext.Provider>
    </AssistantRuntimeProvider>
  );
}

function AssistantSourceFootnote({ className }: Readonly<{ className?: string }>) {
  const { source } = useCareon();

  return (
    <div className={cn("mt-auto flex items-center gap-2 border-t pt-3 text-muted-foreground text-xs", className)}>
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          source.mode === "api" ? "animate-pulse bg-emerald-500" : "bg-amber-500",
        )}
      />
      {source.mode === "api" ? source.label : "Lokale preview · geen live AI"}
    </div>
  );
}

function AssistantSourceMeta() {
  const { filters, source } = useCareon();
  const scope = [
    filters.locatie !== "Alle locaties" ? filters.locatie : null,
    filters.team !== "Alle teams" ? filters.team : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <Badge variant="outline" className="gap-1.5 font-normal">
        <span
          className={cn(
            "size-1.5 rounded-full",
            source.mode === "api" ? "animate-pulse bg-emerald-500" : "bg-amber-500",
          )}
        />
        {source.label}
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

function AssistantQuickPrompts() {
  const threadRuntime = useThreadRuntime();
  const isRunning = useAuiState((s) => s.thread.isRunning);

  return (
    // One horizontally scrollable row on phones; wraps normally from sm up.
    <div className="flex gap-1.5 overflow-x-auto pb-1 max-sm:-mx-4 max-sm:px-4 sm:flex-wrap sm:overflow-visible sm:pb-0">
      {ASSISTANT_QUICK_PROMPTS.map((prompt) => (
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
