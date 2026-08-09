"use client";

import { useCareon } from "./careon-provider";
import { useCareonOrgNaam } from "./careon-session-provider";

export function CareonOrgLabel() {
  const { filters } = useCareon();
  const orgNaam = useCareonOrgNaam();

  return (
    <span className="inline max-w-40 truncate font-medium text-[10px] text-muted-foreground uppercase tracking-widest sm:max-w-none sm:text-xs">
      {orgNaam}
      {" · "}
      {filters.locatie}
    </span>
  );
}
