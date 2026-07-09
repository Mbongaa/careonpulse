import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { CareonMetric } from "@/data/careon/careon-types";
import { formatCareonDelta } from "@/lib/careon-format";
import { cn } from "@/lib/utils";

export function CareonDeltaBadge({
  metric,
  className,
}: Readonly<{
  metric: Pick<CareonMetric, "value" | "prev" | "f" | "betterLow" | "neutralDown">;
  className?: string;
}>) {
  const delta = formatCareonDelta(metric);
  let Icon = Minus;
  if (metric.value !== metric.prev) {
    Icon = delta.up ? TrendingUp : TrendingDown;
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        delta.tone === "good" && "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
        delta.tone === "bad" && "border-red-600/40 text-red-700 dark:text-red-400",
        delta.tone === "neutral" && "text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3" />
      {delta.text}
    </Badge>
  );
}
