"use client";

import { type CSSProperties, useId } from "react";

import { cn } from "@/lib/utils";

// Careon Pulse brandmerk "C · Open Beat" (Claude Design handoff: Careon Pulse
// Logo Final): een open C-boog met een hartslaglijn, beide in het merkverloop
// #1E88FF → #A020F0. De merk-animatie (globals.css) draait één 4,6s-cyclus bij
// paginalading: boog tekent in, hartslag tekent in en klopt, woordmerk stijgt
// op; daarna blijft de eindstand staan. Uit bij prefers-reduced-motion.
//
// Animatiestanden van het merkteken:
// - "once" (standaard): de handoff-cyclus, één keer bij paginalading.
// - "loop": dezelfde intro, waarna de hartslag blijft bewegen — een puls in
//   het merkverloop (lichte tint op donkere thema's, diepere tint op het lichte
//   thema) loopt over de lijn en de lijn klopt mee (klantverzoek 14-08-2026 voor
//   de modulekiezer: "moet blijven bewegen"). De lijn blijft volledig getekend;
//   het merk is nooit incompleet.
// - "none": statische eindstand (bijv. het merkteken op een moduletegel).
export type CareonMarkAnimation = "once" | "loop" | "none";

const BEAT_PATH = "M52 50 h6 l4 -15 l6 28 l4 -13 h20";

export function CareonMark({
  className,
  animation = "once",
}: Readonly<{ className?: string; animation?: CareonMarkAnimation }>) {
  const gradientId = useId();
  const animated = animation !== "none";
  const loop = animation === "loop";
  // De puls-paden krijgen hun kleur via CSS (thema-afhankelijk); de
  // verloop-id's zijn per instantie uniek, dus reiken we ze aan als variabelen.
  const loopStyle = loop
    ? ({
        "--careon-trace-tint": `url(#${gradientId}-tint)`,
        "--careon-trace-shade": `url(#${gradientId}-shade)`,
      } as CSSProperties)
    : undefined;
  return (
    <svg
      aria-hidden="true"
      data-careon-mark={animation}
      viewBox="0 0 100 100"
      fill="none"
      className={cn("overflow-visible", loop && "careon-mark-loop", className)}
      style={loopStyle}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1E88FF" />
          <stop offset="0.55" stopColor="#A020F0" />
        </linearGradient>
        {loop ? (
          // Merkverloop in lichte tint (donkere thema's) en diepere tint (licht
          // thema) voor de puls — dezelfde hoeken, dezelfde stops.
          <>
            <linearGradient id={`${gradientId}-tint`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#8FC3FF" />
              <stop offset="0.55" stopColor="#D5A4FF" />
            </linearGradient>
            <linearGradient id={`${gradientId}-shade`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#0D5FD6" />
              <stop offset="0.55" stopColor="#6A0FB0" />
            </linearGradient>
          </>
        ) : null}
      </defs>
      <path
        className={animated ? "careon-mark-arc" : undefined}
        d="M74 24 A34 34 0 1 0 74 76"
        pathLength="1"
        stroke={`url(#${gradientId})`}
        strokeWidth="13"
        strokeLinecap="round"
      />
      <g className={loop ? "careon-mark-beat-group" : undefined}>
        <path
          className={animated ? "careon-mark-beat" : undefined}
          d={BEAT_PATH}
          pathLength="1"
          stroke={`url(#${gradientId})`}
          strokeWidth="6.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {loop ? (
          // Puls over de hartslaglijn: staart, midden en kop (drie lagen met
          // oplopende dekking, één sweep) — verborgen buiten de loop.
          <>
            <path
              className="careon-mark-trace careon-mark-trace-tail"
              d={BEAT_PATH}
              pathLength="1"
              strokeWidth="6.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              className="careon-mark-trace careon-mark-trace-mid"
              d={BEAT_PATH}
              pathLength="1"
              strokeWidth="6.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              className="careon-mark-trace careon-mark-trace-core"
              d={BEAT_PATH}
              pathLength="1"
              strokeWidth="6.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : null}
      </g>
    </svg>
  );
}

export function CareonLogo({
  compact,
  variant = "sidebar",
  animation = "once",
  className,
}: Readonly<{
  compact?: boolean;
  variant?: "sidebar" | "hero";
  animation?: CareonMarkAnimation;
  className?: string;
}>) {
  if (variant === "hero") {
    return (
      <span className={cn("careon-brand flex min-w-0 items-center justify-center gap-4", className)}>
        <span className="careon-logo-mark flex size-20 shrink-0 items-center justify-center md:size-24">
          <CareonMark animation={animation} className="size-20 md:size-24" />
        </span>
        <span className="careon-wordmark careon-brand-rise block font-extrabold text-3xl tracking-tight">
          Careon Pulse
        </span>
      </span>
    );
  }

  return (
    <span className={cn("careon-brand flex min-w-0 items-center gap-3", className)}>
      <span className="careon-logo-mark flex size-12 shrink-0 items-center justify-center group-data-[collapsible=icon]:size-8">
        <CareonMark animation={animation} className="size-12 group-data-[collapsible=icon]:size-8" />
      </span>
      {!compact && (
        <span className="careon-brand-copy careon-brand-rise min-w-0 leading-none group-data-[collapsible=icon]:hidden">
          <span className="careon-wordmark block truncate font-extrabold text-lg tracking-tight">Careon Pulse</span>
          <span className="careon-tagline mt-1.5 block truncate text-[7px] uppercase tracking-[0.22em]">
            Technology
            {" · "}
            Growth
            {" · "}
            Care
          </span>
        </span>
      )}
    </span>
  );
}
