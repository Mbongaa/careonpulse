"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

// Careon Pulse brandmerk "C · Open Beat" (Claude Design handoff: Careon Pulse
// Logo Final): een open C-boog met een hartslaglijn, beide in het merkverloop
// #1E88FF → #A020F0. De merk-animatie (globals.css) draait één 4,6s-cyclus bij
// paginalading: boog tekent in, hartslag tekent in en klopt, woordmerk stijgt
// op; daarna blijft de eindstand staan. Uit bij prefers-reduced-motion.

export function CareonMark({ className }: Readonly<{ className?: string }>) {
  const gradientId = useId();
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" fill="none" className={cn("overflow-visible", className)}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1E88FF" />
          <stop offset="0.55" stopColor="#A020F0" />
        </linearGradient>
      </defs>
      <path
        className="careon-mark-arc"
        d="M74 24 A34 34 0 1 0 74 76"
        pathLength="1"
        stroke={`url(#${gradientId})`}
        strokeWidth="13"
        strokeLinecap="round"
      />
      <path
        className="careon-mark-beat"
        d="M52 50 h6 l4 -15 l6 28 l4 -13 h20"
        pathLength="1"
        stroke={`url(#${gradientId})`}
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CareonLogo({
  compact,
  variant = "sidebar",
  className,
}: Readonly<{
  compact?: boolean;
  variant?: "sidebar" | "hero";
  className?: string;
}>) {
  if (variant === "hero") {
    return (
      <span className={cn("careon-brand flex min-w-0 items-center justify-center gap-4", className)}>
        <span className="careon-logo-mark flex size-20 shrink-0 items-center justify-center md:size-24">
          <CareonMark className="size-20 md:size-24" />
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
        <CareonMark className="size-12 group-data-[collapsible=icon]:size-8" />
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
