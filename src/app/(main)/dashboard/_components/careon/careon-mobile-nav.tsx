"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Bell, CalendarDays, LayoutDashboard, type LucideIcon, Menu, Users } from "lucide-react";

import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { useCareon } from "./careon-provider";

type MobileNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Toon het live aantal kritieke signaleringen (provider) als badge. */
  showAlertBadge?: boolean;
};

const ITEMS: MobileNavItem[] = [
  { label: "Cockpit", href: "/dashboard/directiecockpit", icon: LayoutDashboard },
  { label: "Patiënten", href: "/dashboard/patienten", icon: Users },
  { label: "Planning", href: "/dashboard/planning", icon: CalendarDays },
  { label: "Signalen", href: "/dashboard/signaleringen", icon: Bell, showAlertBadge: true },
] as const;

export function CareonMobileNav() {
  const pathname = usePathname();
  const { toggleSidebar } = useSidebar();
  // Zelfde bron als de sidebar-badge en de alert-bel: in productie-modus het
  // échte aantal kritieke signaleringen, in demo de geauditeerde constante.
  const { alertCount } = useCareon();

  return (
    <nav className="careon-mobile-nav" aria-label="Mobiele Careon navigatie">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;

        return (
          <Link
            key={item.href}
            prefetch={false}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn("careon-mobile-nav-item", active && "is-active")}
          >
            <span className="careon-mobile-nav-icon">
              <Icon className="size-4" />
              {item.showAlertBadge && alertCount > 0 && <span className="careon-mobile-nav-badge">{alertCount}</span>}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
      <button type="button" className="careon-mobile-nav-item" onClick={toggleSidebar} aria-label="Menu">
        <span className="careon-mobile-nav-icon">
          <Menu className="size-4" />
        </span>
        <span>Menu</span>
      </button>
    </nav>
  );
}
