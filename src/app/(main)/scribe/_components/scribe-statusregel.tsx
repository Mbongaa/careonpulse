"use client";

import type { ReactNode } from "react";

import { SCRIBE_LIMITS } from "@/lib/careon-scribe/types";
import { cn } from "@/lib/utils";

// Careon-huisstijl voor terugkoppeling: inline statusregels, geen toasts. Een
// fout is altijd `role="alert"` zodat een schermlezer hem meteen krijgt; de
// permanente waarschuwing over ontbrekende fragmenten is bewust niet
// wegklikbaar (§7.3 — verlies van transcript mag nooit uit beeld raken).

export type ScribeToon = "neutraal" | "bezig" | "goed" | "waarschuwing" | "fout";

const TOON_KLASSEN: Record<ScribeToon, string> = {
  neutraal: "text-muted-foreground",
  bezig: "text-muted-foreground",
  goed: "text-emerald-700 dark:text-emerald-400",
  waarschuwing: "text-amber-700 dark:text-amber-400",
  fout: "text-red-700 dark:text-red-400",
};

export function ScribeStatusregel({
  toon = "neutraal",
  children,
  className,
}: Readonly<{ toon?: ScribeToon; children: ReactNode; className?: string }>) {
  if (!children) return null;
  return (
    <p
      role={toon === "fout" || toon === "waarschuwing" ? "alert" : undefined}
      className={cn("text-xs", TOON_KLASSEN[toon], className)}
    >
      {children}
    </p>
  );
}

/** Vaste, niet-wegklikbare melding over ontbrekende transcriptfragmenten. */
export function OntbrekendeFragmenten({ aantal }: Readonly<{ aantal: number }>) {
  if (aantal <= 0) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-amber-800 text-xs dark:text-amber-300"
    >
      {aantal} fragmenten ontbreken in het transcript. Vul de ontbrekende gesprekstekst handmatig aan voordat u het
      verslag vaststelt.
    </p>
  );
}

/**
 * Resterende transcriptieruimte (N15e). De RPC weigert boven
 * SCRIBE_LIMITS.segmentenPerSessie; zonder deze regel merkt de behandelaar dat
 * pas als er alleen nog gatsegmenten bij komen. Vanaf 80% wordt de regel een
 * waarschuwing; de werkruimte stopt de opname zelf bij het plafond.
 */
export const TRANSCRIPT_WAARSCHUWING_DEEL = 0.8;

export function TranscriptRuimte({ segmentTeller }: Readonly<{ segmentTeller: number }>) {
  const plafond = SCRIBE_LIMITS.segmentenPerSessie;
  const resterend = Math.max(0, plafond - segmentTeller);
  if (segmentTeller < Math.round(plafond * TRANSCRIPT_WAARSCHUWING_DEEL)) return null;
  // Eén regel duurt in de opname circa acht seconden; dat is de schatting die
  // de behandelaar nodig heeft om te beslissen of dit consult nog past.
  const minuten = Math.max(1, Math.round((resterend * 8) / 60));
  return (
    <p
      role="alert"
      className="rounded-md border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-amber-800 text-xs dark:text-amber-300"
    >
      {resterend === 0
        ? `De transcriptieruimte van dit consult is vol (${plafond} regels). Rond dit consult af en start een vervolgconsult.`
        : `Nog ruimte voor ${resterend} transcriptregels (circa ${minuten} minuten). Rond het consult tijdig af.`}
    </p>
  );
}
