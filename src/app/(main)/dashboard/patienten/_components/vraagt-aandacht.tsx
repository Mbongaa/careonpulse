"use client";

import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { CareonSourceBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PATIENTEN_RISICO } from "@/data/careon/careon-patienten";
import { isTgcDossierUrl } from "@/lib/careon-production/tgc-dossier-url";
import { cn, getInitials } from "@/lib/utils";

interface AandachtRij {
  id: string;
  naam: string;
  team: string;
  loc: string;
  signaal: string;
  dagen: number;
  dossierUrl?: string | null;
}

export function VraagtAandachtPanel({ className }: Readonly<{ className?: string }>) {
  const { production } = useCareon();

  // Productie toont gepseudonimiseerde cliënten (ID i.p.v. naam) met een
  // deeplink naar het EPD-dossier; de signalen komen uit de export.
  const rows: AandachtRij[] = production ? production.risicoLijst : PATIENTEN_RISICO;

  return (
    <CareonChartCard
      title="Vraagt aandacht"
      sub="Automatisch gesignaleerd"
      className={className}
      titleBadge={<CareonSourceBadge page="patienten" widget="Vraagt aandacht" />}
    >
      <div className="flex flex-col divide-y">
        {rows.length === 0 && (
          <p className="py-2.5 text-muted-foreground text-sm">Geen cliënten die aandacht vragen — alles op schema.</p>
        )}
        {rows.map((client) => (
          <div key={client.id} className="flex items-center gap-3 py-2.5">
            <Avatar className="size-8">
              <AvatarFallback className="text-foreground text-xs">{getInitials(client.naam)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              {isTgcDossierUrl(client.dossierUrl) ? (
                <a
                  href={client.dossierUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-medium text-sm leading-tight underline-offset-2 hover:underline"
                >
                  {client.naam}
                </a>
              ) : (
                <p className="truncate font-medium text-sm leading-tight">{client.naam}</p>
              )}
              <p className="truncate text-muted-foreground text-xs">
                {client.team} · {client.loc}
              </p>
            </div>
            <Badge
              variant="outline"
              className={cn(
                client.dagen > 60
                  ? "border-red-600/40 text-red-700 dark:text-red-400"
                  : "border-amber-600/40 text-amber-700 dark:text-amber-400",
              )}
            >
              {client.signaal}
            </Badge>
          </div>
        ))}
      </div>
    </CareonChartCard>
  );
}
