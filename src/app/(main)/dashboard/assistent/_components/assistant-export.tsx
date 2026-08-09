"use client";

import { useEffect } from "react";

import { createPortal } from "react-dom";

import { useCareonOrgNaam } from "@/app/(main)/dashboard/_components/careon/careon-session-provider";
import { ASSISTANT_INTENT_META, type AssistantArtifact } from "@/data/careon/careon-assistant";
import type { CareonSource } from "@/data/careon/careon-types";

import { AssistantClaims, AssistantSources, AssistantVisualizationBlock } from "./assistant-canvas";

export interface AssistantExportTurn {
  id: string;
  question: string;
  answer: string;
  artifact?: AssistantArtifact;
}

export interface AssistantExportPayload {
  mode: "conversation" | "artifact";
  turns: AssistantExportTurn[];
}

// Print overlay: renders the conversation (or one artifact) into a hidden
// [data-print-root] node and triggers window.print(). The template's print CSS
// hides everything else; [data-print-flow] lifts the single-page clamp so a
// long conversation can flow across pages.
export function AssistantExportOverlay({
  payload,
  source,
  onClose,
}: Readonly<{ payload: AssistantExportPayload; source: CareonSource; onClose: () => void }>) {
  const orgNaam = useCareonOrgNaam();
  useEffect(() => {
    document.documentElement.dataset.printFlow = "true";
    const handleAfterPrint = () => onClose();
    window.addEventListener("afterprint", handleAfterPrint);
    const timer = setTimeout(() => window.print(), 120);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", handleAfterPrint);
      delete document.documentElement.dataset.printFlow;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div data-print-root data-print-flow="true">
      <div data-print-paper className="bg-white p-10 text-neutral-900">
        <header className="mb-6 border-neutral-300 border-b pb-4">
          <p className="text-neutral-500 text-xs uppercase tracking-wide">Careon Pulse · {orgNaam}</p>
          <h1 className="mt-1 font-semibold text-xl">
            {payload.mode === "artifact" ? "Artefact-export" : "Gespreksexport AI-assistent"}
          </h1>
          <p className="mt-1 text-neutral-500 text-xs">
            Bron: {source.label} ({source.detail}) · {assistantIntroTruncated()}
          </p>
        </header>
        {payload.turns.map((turn) => (
          <section key={turn.id} className="mb-8 break-inside-avoid">
            {turn.question ? <h2 className="mb-1 font-semibold text-base">V: {turn.question}</h2> : null}
            {turn.answer ? <p className="mb-3 whitespace-pre-wrap text-sm leading-relaxed">{turn.answer}</p> : null}
            {turn.artifact ? (
              <div className="space-y-4">
                <p className="text-neutral-500 text-xs uppercase tracking-wide">
                  Canvas · {ASSISTANT_INTENT_META[turn.artifact.intent].label}
                </p>
                {turn.artifact.visualizations
                  .filter((v) => v.kind !== "bar-chart" && v.kind !== "donut")
                  .map((visual) => (
                    <div key={visual.id}>
                      <p className="mb-2 font-medium text-sm">{visual.title}</p>
                      <AssistantVisualizationBlock visual={visual} />
                    </div>
                  ))}
                <AssistantClaims claims={turn.artifact.claims} />
                <AssistantSources sources={turn.artifact.sources} />
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </div>,
    document.body,
  );
}

function assistantIntroTruncated(): string {
  return `geëxporteerd ${new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}`;
}
