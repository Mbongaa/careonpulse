import type { ReactNode } from "react";

import Link from "next/link";

import { cn } from "@/lib/utils";

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

/**
 * Visueel nadrukkelijk ánders dan AdminEmpty: een mislukte read mag nooit
 * lezen als "geen data" — dat maakte een Supabase-storing onzichtbaar op juist
 * het scherm dat tijdens zo'n storing geraadpleegd wordt.
 */
export function AdminError({ status, children }: Readonly<{ status?: number; children?: ReactNode }>) {
  return (
    <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-destructive text-sm">
      {children ?? "Kon niet laden — controleer de verbinding met Supabase."}
      {typeof status === "number" && (
        <span className="ml-1 text-destructive/70 text-xs tabular-nums">
          {status > 0 ? `(status ${status})` : "(geen antwoord)"}
        </span>
      )}
    </p>
  );
}

type AdminBadgeTone = "neutraal" | "primair" | "waarschuwing";

const BADGE_TONES: Record<AdminBadgeTone, string> = {
  neutraal: "bg-muted text-muted-foreground",
  primair: "bg-primary/10 text-primary",
  waarschuwing: "bg-destructive/10 text-destructive",
};

export function AdminBadge({ tone = "neutraal", children }: Readonly<{ tone?: AdminBadgeTone; children: ReactNode }>) {
  return <span className={cn("rounded-full px-2 py-0.5 text-xs", BADGE_TONES[tone])}>{children}</span>;
}

function AdminPagerLink({ href, children }: Readonly<{ href: string | null; children: ReactNode }>) {
  if (!href) {
    return <span className="rounded-full border px-2.5 py-1 text-muted-foreground/50">{children}</span>;
  }
  return (
    <Link href={href} className="rounded-full border px-2.5 py-1 text-muted-foreground hover:text-foreground">
      {children}
    </Link>
  );
}

/**
 * Vorige/volgende voor lijsten die verder reiken dan één pagina — zonder deze
 * knoppen blijft alles voorbij de eerste pagina onbereikbaar (het audit-logboek
 * bewaart 12 maanden, de lezer zag er 100 rijen van).
 */
export function AdminPager({
  vorigeHref,
  volgendeHref,
  bereik,
}: Readonly<{ vorigeHref: string | null; volgendeHref: string | null; bereik: string }>) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground tabular-nums">{bereik}</span>
      <span className="flex gap-1.5">
        <AdminPagerLink href={vorigeHref}>Vorige</AdminPagerLink>
        <AdminPagerLink href={volgendeHref}>Volgende</AdminPagerLink>
      </span>
    </div>
  );
}

/**
 * Href uit de héle filterset. Filters worden zo combineerbaar; losse links die
 * één parameter zetten, gooien de andere weg (org + actie waren daardoor nooit
 * samen te gebruiken).
 */
export function adminHref(pad: string, params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [sleutel, waarde] of Object.entries(params)) {
    if (waarde === undefined || waarde === null || waarde === "") continue;
    search.set(sleutel, String(waarde));
  }
  const query = search.toString();
  return query === "" ? pad : `${pad}?${query}`;
}

const ROL_LABELS: Record<string, string> = { org_admin: "Organisatiebeheerder", member: "Gebruiker" };

/** De databasewaarde is Engels; de beheerder leest Nederlands. */
export function rolLabel(rol: string): string {
  return ROL_LABELS[rol] ?? rol;
}

export function formatMoment(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("nl-NL", {
    // Expliciet: deze componenten renderen op de server (UTC op Vercel), en
    // zonder zone las de beheerder elk moment 1–2 uur naast de Nederlandse
    // kloktijd — met het verkeerde kalenderdag-label voor alles tussen 00:00
    // en 02:00.
    timeZone: "Europe/Amsterdam",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Uitkomst van een mutatie. Succes en fout kregen eerder dezelfde gedempte
 * regel, waardoor "Opgeslagen." en "Deze slug bestaat al." niet te
 * onderscheiden waren en een mislukte actie als geslaagd las.
 */
export function AdminActieMelding({ tone, children }: Readonly<{ tone: "ok" | "fout"; children: ReactNode }>) {
  if (tone === "fout") {
    return (
      <span
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-destructive text-xs"
      >
        {children}
      </span>
    );
  }
  return (
    <span role="status" className="text-muted-foreground text-xs">
      {children}
    </span>
  );
}
