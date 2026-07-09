import { CareonBar } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { CareonChartCard } from "@/app/(main)/dashboard/_components/careon/careon-chart-card";
import { Badge } from "@/components/ui/badge";
import { TREEK_CHART_MAX, TREEK_LOCATIES, TREEKNORM_WEKEN } from "@/data/careon/careon-patienten";

const nlDec1 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function weeksTone(weeks: number) {
  if (weeks > TREEKNORM_WEKEN) return "bad" as const;
  if (weeks > TREEKNORM_WEKEN * 0.7) return "warn" as const;
  return "good" as const;
}

export function TreeknormPanel({ className }: Readonly<{ className?: string }>) {
  return (
    <CareonChartCard
      title="Wachttijden vs. Treeknorm"
      sub={`Norm: max. ${TREEKNORM_WEKEN} weken tot behandeling`}
      className={className}
      action={
        <Badge variant="outline" className="border-red-600/40 text-red-700 dark:text-red-400">
          ─ ─ norm {TREEKNORM_WEKEN} wkn
        </Badge>
      }
      footer={`Schaal 0–${TREEK_CHART_MAX} wkn; de stippellijn is de Treeknorm. Roermond overschrijdt de intakenorm — zie signalering voor herverdelingsadvies.`}
    >
      <div className="space-y-5">
        {TREEK_LOCATIES.map((row) => (
          <div key={row.loc} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{row.loc}</span>
              <span className="text-muted-foreground text-xs">
                intake {nlDec1.format(row.intake)} wkn · behandeling {nlDec1.format(row.behandeling)} wkn
              </span>
            </div>
            <div className="relative grid gap-1.5">
              <CareonBar pct={(row.intake / TREEK_CHART_MAX) * 100} tone={weeksTone(row.intake)} />
              <CareonBar pct={(row.behandeling / TREEK_CHART_MAX) * 100} tone={weeksTone(row.behandeling)} />
              <span
                aria-hidden
                className="absolute inset-y-0 border-red-500/70 border-l-2 border-dashed"
                style={{ left: `${(TREEKNORM_WEKEN / TREEK_CHART_MAX) * 100}%` }}
                title={`Treeknorm ${TREEKNORM_WEKEN} wkn`}
              />
            </div>
          </div>
        ))}
      </div>
    </CareonChartCard>
  );
}
