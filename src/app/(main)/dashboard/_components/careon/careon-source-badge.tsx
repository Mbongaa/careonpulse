"use client";

import { PROXY_NOTES, widgetSource } from "@/lib/careon-production/provenance";
import { cn } from "@/lib/utils";

import { useCareon } from "./careon-provider";

// Herkomst-badge per widget, alleen zichtbaar in productie-modus. Demo-modus
// blijft pixel-identiek aan het geauditeerde origineel (badge rendert null).
const BADGE_STYLES = {
  live: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  proxy: "border-sky-600/40 text-sky-700 dark:text-sky-400",
  demo: "border-amber-600/40 text-amber-700 dark:text-amber-400",
};

const BADGE_LABELS = {
  live: "Live",
  proxy: "Afgeleid",
  demo: "Demo",
};

export function CareonSourceBadge({
  page,
  widget,
  className,
}: Readonly<{ page: string; widget: string; className?: string }>) {
  const { isProduction } = useCareon();
  if (!isProduction) {
    return null;
  }

  const source = widgetSource(page, widget);
  let note = "Berekend uit de geïmporteerde EPD-export.";
  if (source === "proxy") {
    note = PROXY_NOTES[widget] ?? "Afgeleide waarde — zie Databron voor de definitie.";
  } else if (source === "demo") {
    note = "Demo-data — wacht op aanvullende EPD-export (zie Databron).";
  }

  return (
    <span
      title={note}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px font-medium text-[10px] leading-4",
        BADGE_STYLES[source],
        className,
      )}
    >
      {BADGE_LABELS[source]}
    </span>
  );
}

// Derde herkomst naast Live/Afgeleid/Demo: handmatig bijgehouden registraties
// (middelen & inventaris). Rendert áltijd — ook in demo-modus — zodat nooit de
// indruk ontstaat dat deze cijfers uit het EPD komen.
export function CareonHandmatigBadge({ className }: Readonly<{ className?: string }>) {
  return (
    <span
      title="Handmatig bijgehouden — deze gegevens komen niet uit het EPD."
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-violet-600/40 px-1.5 py-px font-medium text-[10px] text-violet-700 leading-4 dark:text-violet-400",
        className,
      )}
    >
      Handmatig
    </span>
  );
}
