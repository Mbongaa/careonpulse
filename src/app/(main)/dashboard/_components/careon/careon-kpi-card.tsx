"use client";

import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CareonKpi, CareonMetric } from "@/data/careon/careon-types";
import { formatCareonValue } from "@/lib/careon-format";
import { cn } from "@/lib/utils";

import { CareonDeltaBadge } from "./careon-delta-badge";
import { CareonSparkline } from "./careon-sparkline";

type KpiCardMetric = CareonMetric & Partial<Pick<CareonKpi, "icon" | "spark">>;

export function CareonKpiCard({
  metric,
  href,
  className,
}: Readonly<{ metric: KpiCardMetric; href?: string; className?: string }>) {
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
        <CardDescription className="truncate text-xs" title={metric.label}>
          {metric.label}
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
            {formatCareonValue(metric.value, metric.f)}
          </div>
          <CareonDeltaBadge metric={metric} />
        </div>
        <p className="text-muted-foreground text-xs">vorige maand {formatCareonValue(metric.prev, metric.f)}</p>
        {metric.spark && <CareonSparkline data={metric.spark} className="mt-1 h-8 w-full" />}
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
