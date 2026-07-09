import type { CareonPeriodId } from "./careon-types";

export const CAREON_PERIODS: { id: CareonPeriodId; label: string }[] = [
  { id: "12m", label: "Laatste 12 maanden" },
  { id: "kw", label: "Dit kwartaal" },
  { id: "mnd", label: "Deze maand" },
];

export const CAREON_LOCATIONS = ["Alle locaties", "Tilburg", "Breda", "Roermond"] as const;

export const CAREON_TEAMS = ["Alle teams", "SGGZ", "BGGZ", "FACT", "Ouderen"] as const;

// Only KPIs marked `scale: true` are multiplied by these factors; scores and percentages never scale.
export const CAREON_LOCATION_SCALE: Record<string, number> = {
  "Alle locaties": 1,
  Tilburg: 0.44,
  Breda: 0.34,
  Roermond: 0.22,
};

export const CAREON_ORG = {
  name: "TGC Groep",
  customerChip: "Klant: TGC Groep · 3 locaties",
  tagline: "Technology · Growth · Care",
};
