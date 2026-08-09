"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/dashboard/facturatie", label: "Facturen" },
  { href: "/dashboard/facturatie/contacten", label: "Contacten" },
  { href: "/dashboard/facturatie/instellingen", label: "Instellingen" },
] as const;

export function FacturatieSubnav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Facturatie" className="flex flex-wrap gap-2">
      {ITEMS.map((item) => {
        const actief = item.href === "/dashboard/facturatie" ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={actief ? "page" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs transition-colors",
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
