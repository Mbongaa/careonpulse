"use client";

import { useAuiState } from "@assistant-ui/react";
import { BarChart3, ChevronRight, ClipboardCheck, FileText, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

import { assistantArtifactItems, readMessageCustom, useAssistantCanvas } from "./assistant-context";

const ITEM_ICON = { visual: BarChart3, proof: ClipboardCheck, sources: FileText } as const;

// Rendered under each assistant message (via the Thread `assistantExtras`
// slot): chips that open the message's artifact items in the canvas pane.
export function AssistantMessageExtras() {
  const canvas = useAssistantCanvas();
  const custom = useAuiState((s) => readMessageCustom(s.message.metadata));
  const isRunning = useAuiState((s) => s.message.status?.type === "running");

  const artifact = custom.artifact;
  const items = artifact ? assistantArtifactItems(artifact) : [];
  const messageKey = custom.artifactKey ?? null;

  if (isRunning && custom.visualPending && !artifact) {
    return (
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1.5 text-muted-foreground text-xs">
          <Loader2 className="size-3.5 animate-spin" />
          Artefact voorbereiden…
        </span>
      </div>
    );
  }

  if (!artifact || !items.length) return null;

  return (
    <div className="mt-3 space-y-2">
      <ul aria-label="Artefacten bij dit antwoord" className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const Icon = ITEM_ICON[item.kind];
          const active = canvas.messageKey === messageKey && canvas.selectedItemId === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => canvas.select(artifact, item.id, messageKey)}
                className={cn(
                  "group inline-flex min-h-10 max-w-80 items-center gap-2 rounded-xl border px-3 py-1.5 text-start transition-colors",
                  active ? "border-primary/50 bg-primary/10" : "hover:bg-muted",
                )}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-xs leading-tight">{item.title}</span>
                  <span className="block truncate text-muted-foreground text-xs">{item.meta}</span>
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            </li>
          );
        })}
      </ul>
      {custom.cite ? <p className="text-muted-foreground text-xs">{custom.cite}</p> : null}
    </div>
  );
}
