import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { BIG_REGISTRATIES, HR_BIG_NOTE } from "@/data/careon/careon-hr";
import { cn, getInitials } from "@/lib/utils";

export function BigRegistratiesPanel({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard title="BIG-registraties" sub="Verloopt binnen 90 dagen" className={className} footer={HR_BIG_NOTE}>
      <div className="flex flex-col divide-y">
        {BIG_REGISTRATIES.map((registratie) => (
          <div key={registratie.naam} className="flex items-center gap-3 py-3">
            <Avatar className="size-8">
              <AvatarFallback className="text-foreground text-xs">{getInitials(registratie.naam)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-sm leading-tight">{registratie.naam}</p>
              <p className="truncate text-muted-foreground text-xs">
                {registratie.functie} · verloopt {registratie.verloopt}
              </p>
            </div>
            <Badge
              variant="outline"
              className={cn(
                registratie.dagen <= 45
                  ? "border-red-600/40 text-red-700 dark:text-red-400"
                  : "border-amber-600/40 text-amber-700 dark:text-amber-400",
              )}
            >
              {registratie.dagen} dgn
            </Badge>
          </div>
        ))}
      </div>
    </CareonChartCard>
  );
}
