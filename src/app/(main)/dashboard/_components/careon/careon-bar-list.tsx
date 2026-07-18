import { cn } from "@/lib/utils";

export type BarTone = "default" | "good" | "warn" | "bad" | "accent";

const TONE_CLASSES: Record<BarTone, string> = {
  default: "bg-primary",
  accent: "bg-chart-2",
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
};

export function CareonBar({
  pct,
  tone = "default",
  className,
}: Readonly<{ pct: number; tone?: BarTone; className?: string }>) {
  // NaN (bijv. 0/0 bij een lege verdeling) zou als ongeldige width-stijl een
  // vólle balk opleveren terwijl het label 0 zegt — klem naar 0.
  const width = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full transition-all", TONE_CLASSES[tone])} style={{ width: `${width}%` }} />
    </div>
  );
}

export interface BarListItem {
  label: string;
  value: number;
  display?: string;
  tone?: BarTone;
}

export function CareonBarList({
  items,
  max,
  className,
}: Readonly<{ items: BarListItem[]; max?: number; className?: string }>) {
  const computedMax = max ?? Math.max(...items.map((item) => item.value));
  // Alle waarden 0 (of lege lijst): geen zinvolle schaal — balken op 0 houden.
  const domainMax = computedMax > 0 ? computedMax : 1;

  return (
    <div className={cn("space-y-3", className)}>
      {items.map((item) => (
        <div key={item.label} className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{item.label}</span>
            <span className="font-medium tabular-nums">{item.display ?? item.value}</span>
          </div>
          <CareonBar pct={(item.value / domainMax) * 100} tone={item.tone} />
        </div>
      ))}
    </div>
  );
}
