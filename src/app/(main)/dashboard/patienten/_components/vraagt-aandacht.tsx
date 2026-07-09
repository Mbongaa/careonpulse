import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PATIENTEN_RISICO } from "@/data/careon/careon-patienten";
import { cn, getInitials } from "@/lib/utils";

export function VraagtAandachtPanel({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard title="Vraagt aandacht" sub="Automatisch gesignaleerd" className={className}>
      <div className="flex flex-col divide-y">
        {PATIENTEN_RISICO.map((client) => (
          <div key={client.id} className="flex items-center gap-3 py-2.5">
            <Avatar className="size-8">
              <AvatarFallback className="text-foreground text-xs">{getInitials(client.naam)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-sm leading-tight">{client.naam}</p>
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
