"use client";

import type { ReactNode } from "react";

import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CareonKpi, CareonMetricLike } from "@/data/careon/careon-types";
import { formatCareonValue } from "@/lib/careon-format";
import { cn } from "@/lib/utils";

import { CareonDeltaBadge } from "./careon-delta-badge";
import { CareonSparkline } from "./careon-sparkline";

type KpiCardMetric = CareonMetricLike & Partial<Pick<CareonKpi, "icon" | "spark">>;

// Subtekst: demo-metrics geven altijd "vorige maand X"; productie-metrics
// kunnen een venster ("juni · …"), een afwijkend vergelijkingslabel ("vorig
// kwartaal") of een lege meting ("geen meting") meedragen.
function subText(metric: KpiCardMetric): string {
  if (metric.noData) {
    return "geen meting in deze periode";
  }
  const prevText =
    metric.prev === null
      ? "eerste meting — nog geen historie"
      : `${metric.prevLabel ?? "vorige maand"} ${formatCareonValue(metric.prev, metric.f)}`;
  return metric.windowLabel ? `${metric.windowLabel} · ${prevText}` : prevText;
}

export function CareonKpiCard({
  metric,
  href,
  className,
  sourceBadge,
}: Readonly<{ metric: KpiCardMetric; href?: string; className?: string; sourceBadge?: ReactNode }>) {
  const Icon = metric.icon;

  const card = (
    <Card
      className={cn(
        "careon-kpi-card h-full gap-3 py-4",
        href && "transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <CardHeader className="flex-row items-center justify-between gap-2 px-4">
        <CardDescription className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className="truncate" title={metric.label}>
            {metric.label}
          </span>
          {sourceBadge}
        </CardDescription>
        {Icon && (
          <CardTitle>
            <div className="careon-kpi-icon flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <Icon className="size-3.5" />
            </div>
          </CardTitle>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 px-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-medium text-2xl tabular-nums leading-none tracking-tight">
            {metric.noData ? "—" : formatCareonValue(metric.value, metric.f)}
          </div>
          {!metric.noData && <CareonDeltaBadge metric={metric} />}
        </div>
        <p className="text-muted-foreground text-xs">{subText(metric)}</p>
        {metric.secondary && !metric.noData && (
          <div className="mt-1 border-t pt-1.5">
            <p className="text-muted-foreground text-xs">{metric.secondary.label}</p>
            <div className="font-medium text-sm tabular-nums leading-tight">
              {formatCareonValue(metric.secondary.value, metric.secondary.f)}
            </div>
          </div>
        )}
        {metric.spark && metric.spark.length > 0 && <CareonSparkline data={metric.spark} className="mt-1 h-8 w-full" />}
      </CardContent>
    </Card>
  );

  if (!href) {
    return card;
  }

  return (
    <Link prefetch={false} href={href} className="block h-full rounded-xl outline-none" aria-label={metric.label}>
      {card}
    </Link>
  );
}
