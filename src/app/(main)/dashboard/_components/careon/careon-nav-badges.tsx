"use client";

import { SidebarMenuBadge } from "@/components/ui/sidebar";
import type { CareonSourceMode } from "@/data/careon/careon-types";

import { useCareon } from "./careon-provider";

const SOURCE_BADGE_LABEL: Record<CareonSourceMode, string> = {
  demo: "DEMO",
  csv: "CSV",
  api: "PREVIEW",
  productie: "PROD",
};

// Red counter with the number of critical alerts (not the total).
export function CareonAlertsNavBadge() {
  const { alertCount } = useCareon();

  return (
    <SidebarMenuBadge className="rounded-full bg-red-500 px-1.5 text-white peer-hover/menu-button:text-white peer-data-active/menu-button:text-white">
      {alertCount}
    </SidebarMenuBadge>
  );
}

export function CareonSourceNavBadge() {
  const { source } = useCareon();

  return (
    <SidebarMenuBadge className="rounded-sm border text-muted-foreground text-xs">
      {SOURCE_BADGE_LABEL[source.mode]}
    </SidebarMenuBadge>
  );
}
