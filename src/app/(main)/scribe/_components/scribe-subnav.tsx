"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { ScribeUitgang } from "./scribe-navigatie";

// Modulemenu van de scribeschil (gerenderd door layout.tsx). Zelfde vorm als de
// facturatie-subnav: geen bg-primary-pil, want witte tekst op de primaire kleur
// haalt in het careon-thema geen WCAG-AA en /scribe zit wél in de axe-suite.
//
// "Instellingen" en "Logboek" verschijnen alleen voor beheerders (§7.5/N20);
// die pagina's worden zelf door `requireScribeBeheerPage()` bewaakt en de
// beheerroutes daarachter door `requireOrgAdmin()` plus RLS
// (`app.mag_scribe_beheren`). De subnav is dus geen poort maar een wegwijzer —
// vóór C5/C11 stond hier het tegendeel.
//
// De items zijn geen kale `next/link`: loopt er een opname, dan vraagt
// `ScribeUitgang` eerst om bevestiging (N15) — clientnavigatie zou de
// werkruimte anders stil ontkoppelen met een lopende microfoon.

export function ScribeSubnav({ beheerder }: Readonly<{ beheerder: boolean }>) {
  const pathname = usePathname();
  const items = beheerder
    ? [
        { href: "/scribe", label: "Consulten" },
        { href: "/scribe/logboek", label: "Logboek" },
        { href: "/scribe/instellingen", label: "Instellingen" },
      ]
    : [{ href: "/scribe", label: "Consulten" }];

  return (
    <nav aria-label="Careon AI" className="flex flex-wrap gap-2">
      {items.map((item) => {
        const actief = item.href === "/scribe" ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <ScribeUitgang
            key={item.href}
            href={item.href}
            ariaCurrent={actief ? "page" : undefined}
            className={cn(
              "rounded-md border px-3.5 py-1.5 text-sm transition-colors",
              actief
                ? "border-primary/50 bg-primary/10 font-medium text-foreground"
                : "text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {item.label}
          </ScribeUitgang>
        );
      })}
    </nav>
  );
}
