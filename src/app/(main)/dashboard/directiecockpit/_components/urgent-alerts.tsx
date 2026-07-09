"use client";

import Link from "next/link";

import { CareonAlertRow } from "@/app/(main)/dashboard/_components/careon/careon-alert-card";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { Button } from "@/components/ui/button";
import { CAREON_ALERTS } from "@/data/careon/careon-alerts";

// The cockpit surfaces the most urgent signals: all critical ones plus the
// first high one; each card routes to its own domain page.
const URGENT_ALERTS = CAREON_ALERTS.slice(0, 4);

export function UrgentAlertsPanel({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard
      title="Signaleringen"
      sub="Urgente aandachtspunten"
      className={className}
      action={
        <Button asChild variant="outline" size="sm">
          <Link prefetch={false} href="/dashboard/signaleringen">
            Alle
          </Link>
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        {URGENT_ALERTS.map((alert) => (
          <CareonAlertRow key={alert.titel} alert={alert} compact />
        ))}
      </div>
    </CareonChartCard>
  );
}
