"use client";

import { CareonAlertRow } from "@/app/(main)/dashboard/_components/careon/careon-alert-card";
import { useCareonHr } from "@/app/(main)/dashboard/_components/careon/careon-hr-provider";
import { CareonLiveBanner } from "@/app/(main)/dashboard/_components/careon/careon-live-banner";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSeverityBadge } from "@/app/(main)/dashboard/_components/careon/careon-severity";
import { Card, CardContent } from "@/components/ui/card";
import { CAREON_ALERTS, CAREON_SEVERITY_META } from "@/data/careon/careon-alerts";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";
import type { CareonAlert, CareonSeverity } from "@/data/careon/careon-types";
import { buildHrBigAlert, HR_BIG_ALERT_TITLE } from "@/lib/careon-hr/insights";
import { widgetSource } from "@/lib/careon-production/provenance";

const SEVERITIES: CareonSeverity[] = ["kritiek", "hoog", "middel"];

export function SignaleringenContent() {
  const { production } = useCareon();
  const { state: hrState } = useCareonHr();

  const bronAlerts = production ? production.signaleringen : CAREON_ALERTS;
  const hrAlert = buildHrBigAlert(hrState, new Date());
  const alerts: CareonAlert[] = [
    ...bronAlerts.filter((alert) => alert.titel !== HR_BIG_ALERT_TITLE),
    ...(hrAlert ? [hrAlert] : []),
  ];
  // Demo-regels die in productie-modus nog geen EPD-bron hebben, afgeleid uit
  // het provenance-register (één bron van waarheid) — mét de aanwezige
  // aanvullende exports meegewogen: na een agenda-import verhuizen de
  // agenda-regels van "wacht op data" naar de live secties.
  const caps = {
    agenda: production?.agenda != null,
    agendaToekomst: production?.agenda?.vooruitblik != null,
    agendaKwaliteit: production?.agenda?.kwaliteit != null,
    agendaCrisis: production?.agenda?.crisisPerClient != null,
    verwijzers: production?.verwijzerNetwerk != null,
    toeslagen: production?.toeslagen != null,
    declaraties: production?.declaraties != null,
  };
  const wachtOpData = production
    ? CAREON_ALERTS.filter(
        (alert) => alert.titel !== HR_BIG_ALERT_TITLE && widgetSource("signaleringen", alert.titel, caps) === "demo",
      )
    : [];

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader
        title={CAREON_PAGE_META.signaleringen.title}
        sub={
          production
            ? "Signaleringen uit de geïmporteerde EPD-export en de actuele handmatige HR-registratie; regels zonder databron staan onderaan als 'wacht op data'."
            : "Careon Pulse werkt de aandachtspunten bij wanneer de databron of handmatige HR-registratie verandert."
        }
      />

      <CareonLiveBanner page="signaleringen" />

      <div className="grid grid-cols-3 gap-4">
        {SEVERITIES.map((sev) => {
          const count = alerts.filter((alert) => alert.sev === sev).length;
          return (
            <Card key={sev} className="py-4">
              <CardContent className="flex flex-col items-start gap-2 px-4">
                <span className="font-semibold text-3xl tabular-nums leading-none">{count}</span>
                <CareonSeverityBadge sev={sev} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {SEVERITIES.map((sev) => {
        const group = alerts.filter((alert) => alert.sev === sev);
        if (production && group.length === 0) {
          return null;
        }
        return (
          <section key={sev} className="space-y-3">
            <h2 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">
              {CAREON_SEVERITY_META[sev].heading}
            </h2>
            <div className="flex flex-col gap-3">
              {group.map((alert) => (
                <CareonAlertRow key={alert.titel} alert={alert} />
              ))}
            </div>
          </section>
        );
      })}

      {wachtOpData.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">
            Wacht op data — voorbeeldregels (demo)
          </h2>
          <p className="text-muted-foreground text-sm">
            Deze signaleringsregels worden actief zodra de agenda-, declaratie- en ROM-exports gekoppeld zijn. De
            getoonde aantallen zijn demo-waarden.
          </p>
          <div className="flex flex-col gap-3 opacity-75">
            {wachtOpData.map((alert) => (
              <CareonAlertRow key={alert.titel} alert={alert} />
            ))}
          </div>
        </section>
      )}

      <p className="text-center text-muted-foreground text-xs">
        Signaleringen zijn gegroepeerd op urgentie en gebruiken de actuele brongegevens die voor iedere regel
        beschikbaar zijn.
      </p>
    </div>
  );
}
