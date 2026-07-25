"use client";

import { createContext, useContext } from "react";

import type { AssistantActieRegel, AssistantArtifact } from "@/data/careon/careon-assistant";
import type { MiddelenState, MiddelType } from "@/lib/careon-middelen/types";

export type AssistantStage = "idle" | "thinking" | "assembling" | "ready";

export interface AssistantCanvasState {
  artifact: AssistantArtifact | null;
  pending: boolean;
  stage: AssistantStage;
  selectedItemId: string | null;
  messageKey: string | null;
}

// Concept-wijzigingen op de middelen-registratie (handoff 11): door de
// assistent klaargezet, door de gebruiker te bewerken en goed te keuren in
// het canvas (kiosk-patroon "human-confirm": AI vult het concept, de mens
// bewerkt en bevestigt). Zolang de status "open" is, is er niets opgeslagen.
export interface AssistantConceptState {
  /** messageKey van de beurt die het concept (laatst) opbouwde. */
  key: string;
  /** Pseudonieme server-request-ID's voor operationele auditkoppeling. */
  requestIds: string[];
  /** Her-afspeelbaar actielogboek (regels dragen hun tool-args). */
  regels: AssistantActieRegel[];
  /** Preview-eindstand (replay van de regels op de registratie-stand). */
  staat: MiddelenState;
  /** updatedAt van de registratie waarop de preview is berekend — wijkt de
      actuele registratie af, dan toont de balk een herberekenen-hint. */
  basisUpdatedAt: string;
  artifact: AssistantArtifact;
  status: "open" | "toegepast" | "verworpen";
}

/** Directe rijbewerking in de concept-registratietabel — wordt onder water
    een actie in het her-afspeelbare logboek (zelfde primitief als de AI). */
export type ConceptRijWijziging =
  | { soort: "taal"; waarde: string; aanwezig: boolean }
  | { soort: "functie"; waarde: string }
  | { soort: "middel"; waarde: MiddelType; aanwezig: boolean }
  | { soort: "team"; waarde: string; aanwezig: boolean }
  | { soort: "dienstverband"; uitDienst: boolean };

export interface AssistantCanvasContextValue extends AssistantCanvasState {
  select: (artifact: AssistantArtifact, itemId?: string | null, messageKey?: string | null) => void;
  concept: AssistantConceptState | null;
  besluitConcept: (besluit: "toepassen" | "verwerpen") => void;
  /** Bewerk een medewerkersrij in de concepttabel; de preview herberekent. */
  bewerkConceptRij: (naam: string, wijziging: ConceptRijWijziging) => void;
  /** Schrap één voorgestelde actie; de preview wordt herberekend. */
  verwijderConceptActie: (index: number) => void;
  /** Sluit een naam uit binnen een bulk-regel; de preview wordt herberekend. */
  sluitConceptNaamUit: (index: number, naam: string) => void;
  /** Vervang de argumenten van een regel (canvas-bewerking); herberekent. */
  bewerkConceptActie: (index: number, args: Record<string, unknown>) => void;
  /** Herbereken de preview op de actuele registratie-stand. */
  herberekenConcept: () => void;
}

export const AssistantCanvasContext = createContext<AssistantCanvasContextValue | null>(null);

export function useAssistantCanvas(): AssistantCanvasContextValue {
  const ctx = useContext(AssistantCanvasContext);
  if (!ctx) {
    throw new Error("useAssistantCanvas must be used within AssistantCanvasContext");
  }
  return ctx;
}

export interface AssistantCanvasItem {
  id: string;
  kind: "visual" | "proof" | "sources";
  title: string;
  meta: string;
}

export function assistantArtifactItems(artifact: AssistantArtifact): AssistantCanvasItem[] {
  const items: AssistantCanvasItem[] = artifact.visualizations.map((v) => ({
    id: `visual-${v.id}`,
    kind: "visual",
    title: v.title,
    meta: v.sub,
  }));
  if (artifact.claims.length) {
    items.push({
      id: "proof",
      kind: "proof",
      title: "Bewijsvoering",
      meta: `${artifact.claims.length} onderbouwde claims`,
    });
  }
  if (artifact.sources.length) {
    items.push({
      id: "sources",
      kind: "sources",
      title: "Bronnen",
      meta: `${artifact.sources.length} bronverwijzingen`,
    });
  }
  return items;
}

export function defaultArtifactItemId(artifact: AssistantArtifact): string | null {
  const first = assistantArtifactItems(artifact)[0];
  return first ? first.id : null;
}

// Shape of `message.metadata.custom` written by the local runtime per turn.
export interface AssistantMessageCustom {
  artifact?: AssistantArtifact;
  artifactKey?: string;
  cite?: string;
  visualPending?: boolean;
}

export function readMessageCustom(metadata: unknown): AssistantMessageCustom {
  if (!metadata || typeof metadata !== "object") return {};
  const custom = (metadata as { custom?: unknown }).custom;
  if (!custom || typeof custom !== "object") return {};
  return custom as AssistantMessageCustom;
}
