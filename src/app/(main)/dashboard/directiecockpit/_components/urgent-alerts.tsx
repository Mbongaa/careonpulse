"use client";

import Link from "next/link";

import { CareonAlertRow } from "@/app/(main)/dashboard/_components/careon/careon-alert-card";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { Button } from "@/components/ui/button";
import { CAREON_ALERTS } from "@/data/careon/careon-alerts";
import { filterFinancieleAlerts } from "@/lib/careon-financieel-rol";

import { useCareonSessionInfo } from "../../_components/careon/careon-session-provider";

// The cockpit surfaces the most urgent signals: all critical ones plus the
// first high one; each card routes to its own domain page. In productie-modus
// komen de signaleringen uit de EPD-berekening.

export function UrgentAlertsPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();
  // Eerst de financiële regels wegfilteren (rolregel), dan pas de top-4
  // afsnijden — anders kost een verborgen regel een zichtbare plek.
  const { financieelZichtbaar } = useCareonSessionInfo();
  const alerts = filterFinancieleAlerts(
    production ? production.signaleringen : CAREON_ALERTS,
    financieelZichtbaar,
  ).slice(0, 4);
  return (
    <CareonChartCard
      title="Signaleringen"
      sub="Urgente aandachtspunten"
      className={className}
      titleBadge={<CareonSourceBadge page="cockpit" widget="Urgente signaleringen" />}
      action={
        <Button asChild variant="outline" size="sm">
          <Link prefetch={false} href="/dashboard/signaleringen">
            Alle
          </Link>
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        {alerts.map((alert) => (
          <CareonAlertRow key={alert.titel} alert={alert} compact />
        ))}
      </div>
    </CareonChartCard>
  );
}
