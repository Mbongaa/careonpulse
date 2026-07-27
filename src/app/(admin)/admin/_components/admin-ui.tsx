import type { ReactNode } from "react";

// Kleine gedeelde bouwstenen voor de beheerpagina's — bewust simpel en
// server-render-baar (geen client state).

export function AdminCard({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="mb-3 font-medium text-sm">{title}</h2>
      {children}
    </section>
  );
}

export function AdminStat({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-semibold text-2xl tabular-nums">{value}</p>
    </div>
  );
}

export function AdminEmpty({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}

export function formatMoment(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
