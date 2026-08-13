"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Modulemenu van de facturatieschil (gerenderd door layout.tsx). Bewust niet
// de bg-primary-pilstijl van de beheer-nav: in het careon-thema haalt witte
// tekst op de primaire kleur geen WCAG-AA (2,6:1) en /facturatie zit — anders
// dan /admin — wél in de axe-suite.
const ITEMS = [
  { href: "/facturatie", label: "Facturen" },
  { href: "/facturatie/contacten", label: "Contacten" },
  { href: "/facturatie/instellingen", label: "Instellingen" },
] as const;

export function FacturatieSubnav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Facturatie" className="flex flex-wrap gap-2">
      {ITEMS.map((item) => {
        const actief = item.href === "/facturatie" ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={actief ? "page" : undefined}
            className={cn(
              "rounded-md border px-3.5 py-1.5 text-sm transition-colors",
              actief
                ? "border-primary/50 bg-primary/10 font-medium text-foreground"
                : "text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
