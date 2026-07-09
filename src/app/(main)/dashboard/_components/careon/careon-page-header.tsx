import type { ReactNode } from "react";

export function CareonPageHeader({ title, sub, action }: Readonly<{ title: string; sub: string; action?: ReactNode }>) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">{sub}</p>
      </div>
      {action}
    </div>
  );
}
