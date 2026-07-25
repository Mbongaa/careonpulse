"use client";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { HR_BIG_NOTE } from "@/data/careon/careon-hr";
import { bigDagenTot, type HrBigRegistratie } from "@/lib/careon-hr/types";
import { cn, getInitials } from "@/lib/utils";

import { bigDagenBadgeClass, bigDagenLabel } from "./big-badge";

const datumNl = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function toonDatum(iso: string): string {
  return datumNl.format(new Date(`${iso}T00:00:00Z`));
}

// Toont de registraties die binnen 90 dagen verlopen (of al verlopen zijn),
// oplopend op resterende dagen. De dagen worden live berekend uit de opgeslagen
// verloopdatum, zodat de teller nooit veroudert.
export function BigRegistratiesPanel({
  registraties,
  vandaag,
  className,
}: Readonly<{ registraties: HrBigRegistratie[]; vandaag: Date; className?: string }>) {
  const rijen = registraties
    .map((registratie) => ({ ...registratie, dagen: bigDagenTot(registratie.verloopt, vandaag) }))
    .filter((registratie) => registratie.dagen <= 90)
    .sort((a, b) => a.dagen - b.dagen);

  return (
    <CareonChartCard title="BIG-registraties" sub="Verloopt binnen 90 dagen" className={className} footer={HR_BIG_NOTE}>
      {rijen.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground text-sm">Geen registraties verlopen binnen 90 dagen.</p>
      ) : (
        <div className="flex flex-col divide-y">
          {rijen.map((registratie) => (
            <div key={`${registratie.naam}:${registratie.verloopt}`} className="flex items-center gap-3 py-3">
              <Avatar className="size-8">
                <AvatarFallback className="text-foreground text-xs">{getInitials(registratie.naam)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm leading-tight">{registratie.naam}</p>
                <p className="truncate text-muted-foreground text-xs">
                  {registratie.functie ? `${registratie.functie} · ` : ""}verloopt {toonDatum(registratie.verloopt)}
                </p>
              </div>
              <Badge variant="outline" className={cn("tabular-nums", bigDagenBadgeClass(registratie.dagen))}>
                {bigDagenLabel(registratie.dagen)}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </CareonChartCard>
  );
}
