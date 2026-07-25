"use client";

import Link from "next/link";

import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { CAREON_PAGE_META, CAREON_ROUTES } from "@/data/careon/careon-pages";
import type { CareonAlert } from "@/data/careon/careon-types";
import { cn } from "@/lib/utils";

import { CareonSeverityBadge } from "./careon-severity";

export function CareonAlertRow({ alert, compact }: Readonly<{ alert: CareonAlert; compact?: boolean }>) {
  const href = CAREON_ROUTES[alert.page];
  const doel = CAREON_PAGE_META[alert.page].title;

  if (compact) {
    return (
      <Link
        prefetch={false}
        href={href}
        className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
      >
        <span className="min-w-8 text-center font-semibold text-lg tabular-nums">{alert.n}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm">{alert.titel}</span>
          <span className="block truncate text-muted-foreground text-xs">{alert.unit}</span>
        </span>
        <CareonSeverityBadge sev={alert.sev} />
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    );
  }

  // De hele kaart is klikbaar en linkt naar de domeinpagina waar de betrokken
  // regels/records staan (de "Bekijk"-affordance is nu een visuele hint binnen
  // de link — geen geneste interactieve elementen).
  return (
    <Link
      prefetch={false}
      href={href}
      aria-label={`${alert.titel} — bekijk op ${doel}`}
      className={cn(
        "group flex flex-col gap-3 rounded-lg border p-4 outline-none transition-colors",
        "hover:border-primary/40 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
        "sm:flex-row sm:items-center",
      )}
    >
      {/* On mobile the count tile sits inline next to the text (sm:contents
          restores the exact desktop flex layout from sm upward). */}
      <div className="flex items-start gap-3 sm:contents">
        <div className="flex min-w-16 flex-col items-center justify-center rounded-md border bg-muted/50 px-3 py-2">
          <span className="font-semibold text-xl tabular-nums leading-none">{alert.n}</span>
          <span className="mt-1 text-muted-foreground text-xs">{alert.unit}</span>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm">{alert.titel}</span>
            <Badge variant="outline" className="text-muted-foreground max-sm:hidden">
              {alert.unit}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">{alert.detail}</p>
        </div>
      </div>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 self-start rounded-md border px-3 py-1.5 font-medium text-muted-foreground text-sm transition-colors",
          "group-hover:border-primary/40 group-hover:text-foreground sm:self-center",
        )}
      >
        Bekijk
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
