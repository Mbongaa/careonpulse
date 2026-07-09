"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Bell, CalendarDays, LayoutDashboard, type LucideIcon, Menu, Users } from "lucide-react";

import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type MobileNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
};

const ITEMS: MobileNavItem[] = [
  { label: "Cockpit", href: "/dashboard/directiecockpit", icon: LayoutDashboard },
  { label: "Patiënten", href: "/dashboard/patienten", icon: Users },
  { label: "Planning", href: "/dashboard/planning", icon: CalendarDays },
  { label: "Signalen", href: "/dashboard/signaleringen", icon: Bell, badge: 3 },
] as const;

export function CareonMobileNav() {
  const pathname = usePathname();
  const { toggleSidebar } = useSidebar();

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
              {item.badge && <span className="careon-mobile-nav-badge">{item.badge}</span>}
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
