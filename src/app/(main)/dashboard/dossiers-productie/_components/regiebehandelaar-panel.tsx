import { CareonBar } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { Badge } from "@/components/ui/badge";
import { REGIE_NORM, REGIEBEHANDELAREN, type RegieTone, regieTone } from "@/data/careon/careon-dossiers-productie";
import { cn } from "@/lib/utils";

const nl = new Intl.NumberFormat("nl-NL");

const TONE_TEXT: Record<RegieTone, string> = {
  bad: "text-red-700 dark:text-red-400 font-semibold",
  warn: "text-amber-700 dark:text-amber-400 font-medium",
  none: "",
};

const TONE_BAR: Record<RegieTone, "bad" | "warn" | "default"> = {
  bad: "bad",
  warn: "warn",
  none: "default",
};

export function RegiebehandelaarPanel({ className }: Readonly<{ className?: string }>) {
  const max = Math.max(...REGIEBEHANDELAREN.map((row) => row.clienten));

  return (
    <CareonChartCard
      title="Regiebehandelaar"
      sub={`Actieve cliënten per regiebehandelaar · norm ${REGIE_NORM}`}
      className={className}
      footer="Boven de norm verschijnt de regiebehandelaar automatisch in Signaleringen."
    >
      <div className="space-y-4">
        {REGIEBEHANDELAREN.map((row) => {
          const tone = regieTone(row.clienten);
          return (
            <div key={row.naam} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {row.naam}
                  <span className="text-muted-foreground text-xs">
                    {" "}
                    · {row.team} · {row.loc}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {tone === "bad" && (
                    <Badge variant="outline" className="text-red-700 dark:text-red-400">
                      boven norm
                    </Badge>
                  )}
                  <span className={cn("font-medium tabular-nums", TONE_TEXT[tone])}>{nl.format(row.clienten)}</span>
                </span>
              </div>
              <CareonBar pct={(row.clienten / max) * 100} tone={TONE_BAR[tone]} />
            </div>
          );
        })}
      </div>
    </CareonChartCard>
  );
}
