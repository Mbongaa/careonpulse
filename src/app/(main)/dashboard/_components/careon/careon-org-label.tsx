"use client";

import { CAREON_ORG } from "@/data/careon/careon-filters";

import { useCareon } from "./careon-provider";

export function CareonOrgLabel() {
  const { filters } = useCareon();

  return (
    <span className="inline max-w-40 truncate font-medium text-[10px] text-muted-foreground uppercase tracking-widest sm:max-w-none sm:text-xs">
      {CAREON_ORG.name}
      {" \u00b7 "}
      {filters.locatie}
    </span>
  );
}
