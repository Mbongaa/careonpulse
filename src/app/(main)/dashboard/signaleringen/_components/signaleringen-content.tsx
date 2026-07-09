import { CareonAlertRow } from "@/app/(main)/dashboard/_components/careon/careon-alert-card";
import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { CareonSeverityBadge } from "@/app/(main)/dashboard/_components/careon/careon-severity";
import { Card, CardContent } from "@/components/ui/card";
import { CAREON_ALERTS, CAREON_SEVERITY_META } from "@/data/careon/careon-alerts";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";
import type { CareonSeverity } from "@/data/careon/careon-types";

const SEVERITIES: CareonSeverity[] = ["kritiek", "hoog", "middel"];

export function SignaleringenContent() {
  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader
        title={CAREON_PAGE_META.signaleringen.title}
        sub="Careon Pulse controleert elke nacht dossiers, agenda's en declaraties en zet de aandachtspunten voor u klaar."
      />

      <div className="grid grid-cols-3 gap-4">
        {SEVERITIES.map((sev) => {
          const count = CAREON_ALERTS.filter((alert) => alert.sev === sev).length;
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

      {SEVERITIES.map((sev) => (
        <section key={sev} className="space-y-3">
          <h2 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">
            {CAREON_SEVERITY_META[sev].heading}
          </h2>
          <div className="flex flex-col gap-3">
            {CAREON_ALERTS.filter((alert) => alert.sev === sev).map((alert) => (
              <CareonAlertRow key={alert.titel} alert={alert} />
            ))}
          </div>
        </section>
      ))}

      <p className="text-center text-muted-foreground text-xs">
        Signaleringsregels zijn instelbaar per rol — directie, teamleiders en kwaliteitsmedewerkers zien elk hun eigen
        set.
      </p>
    </div>
  );
}
