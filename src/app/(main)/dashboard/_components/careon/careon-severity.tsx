import { Badge } from "@/components/ui/badge";
import type { CareonSeverity } from "@/data/careon/careon-types";
import { cn } from "@/lib/utils";

export const SEVERITY_CLASSES: Record<CareonSeverity, string> = {
  kritiek: "border-red-600/40 bg-red-500/10 text-red-700 dark:text-red-400",
  hoog: "border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  middel: "border-blue-600/40 bg-blue-500/10 text-blue-700 dark:text-blue-400",
};

export function CareonSeverityBadge({ sev, className }: Readonly<{ sev: CareonSeverity; className?: string }>) {
  return (
    <Badge variant="outline" className={cn("capitalize", SEVERITY_CLASSES[sev], className)}>
      {sev}
    </Badge>
  );
}
