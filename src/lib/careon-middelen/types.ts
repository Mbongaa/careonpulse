// Middelen & inventaris — handmatig bijgehouden registratie (handoff 09).
// Deze data komt níét uit het EPD: uitgegeven middelen per medewerker en de
// inventaris per locatie worden door de gebruiker zelf getagd en centraal
// (Supabase) of lokaal (localStorage-fallback) bewaard.

export const MIDDEL_TYPES = ["auto", "tankpas", "sleutel", "telefoon", "laptop", "toegang"] as const;

export type MiddelType = (typeof MIDDEL_TYPES)[number];

export interface MedewerkerMiddelen {
  naam: string;
  /** Handmatig toegevoegd persoon (bijv. kantoorpersoneel, niet in de behandelarenbron). */
  handmatig?: boolean;
  middelen: MiddelType[];
  /** Functie/kwalificatie (bijv. Basispsycholoog, GZ-psycholoog) — vrije registratie. */
  functie?: string;
  /** Gesproken talen (bijv. Turks, Arabisch, Farsi/Dari) — meerdere mogelijk. */
  talen?: string[];
  /** Teamtags (teamnamen uit de teamstructuur) — meerdere mogelijk. */
  teams?: string[];
  /** Vrije notitie: kenteken, sleutelnummer, laptop-tag … */
  notitie?: string;
}

/** Eén team binnen de organisatiestructuur (teams per Vektis-locatie). */
export interface TeamDefinitie {
  naam: string;
  locatie: string;
}

export interface LocatieInventaris {
  locatie: string;
  /** Handmatig toegevoegde locatie (bijv. hoofdkantoor/opslag, niet in de EPD-export). */
  handmatig?: boolean;
  behandelkamers: number;
  boeken: number;
  diagnostiek: number;
}

export interface MiddelenState {
  medewerkers: MedewerkerMiddelen[];
  inventaris: LocatieInventaris[];
  /** Teamstructuur (teams per locatie). Ontbreekt in oudere opgeslagen staten;
      de provider vult dan de seed-structuur in (migratie-bij-lezen). */
  teams?: TeamDefinitie[];
  updatedAt: string;
}

// Grenzen voor de API-route: ruim boven reëel gebruik, maar een harde rem
// tegen misvormde of kwaadwillige payloads.
export const MIDDELEN_LIMITS = {
  medewerkers: 500,
  inventaris: 50,
  naam: 120,
  notitie: 300,
  functie: 80,
  talen: 12,
  taal: 40,
  teams: 60,
  teamnaam: 60,
  teamtags: 10,
  aantal: 100_000,
} as const;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MIDDELEN_LIMITS.aantal;
}

function isMedewerkerMiddelen(value: unknown): value is MedewerkerMiddelen {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.naam === "string" &&
    row.naam.trim().length > 0 &&
    row.naam.length <= MIDDELEN_LIMITS.naam &&
    (row.handmatig === undefined || typeof row.handmatig === "boolean") &&
    Array.isArray(row.middelen) &&
    row.middelen.every((middel) => (MIDDEL_TYPES as readonly string[]).includes(middel as string)) &&
    (row.functie === undefined || (typeof row.functie === "string" && row.functie.length <= MIDDELEN_LIMITS.functie)) &&
    (row.talen === undefined ||
      (Array.isArray(row.talen) &&
        row.talen.length <= MIDDELEN_LIMITS.talen &&
        row.talen.every(
          (taal) => typeof taal === "string" && taal.trim().length > 0 && taal.length <= MIDDELEN_LIMITS.taal,
        ))) &&
    (row.teams === undefined ||
      (Array.isArray(row.teams) &&
        row.teams.length <= MIDDELEN_LIMITS.teamtags &&
        row.teams.every(
          (team) => typeof team === "string" && team.trim().length > 0 && team.length <= MIDDELEN_LIMITS.teamnaam,
        ))) &&
    (row.notitie === undefined || (typeof row.notitie === "string" && row.notitie.length <= MIDDELEN_LIMITS.notitie))
  );
}

function isTeamDefinitie(value: unknown): value is TeamDefinitie {
  if (typeof value !== "object" || value === null) return false;
  const team = value as Record<string, unknown>;
  return (
    typeof team.naam === "string" &&
    team.naam.trim().length > 0 &&
    team.naam.length <= MIDDELEN_LIMITS.teamnaam &&
    typeof team.locatie === "string" &&
    team.locatie.trim().length > 0 &&
    team.locatie.length <= MIDDELEN_LIMITS.naam
  );
}

function isLocatieInventaris(value: unknown): value is LocatieInventaris {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.locatie === "string" &&
    row.locatie.trim().length > 0 &&
    row.locatie.length <= MIDDELEN_LIMITS.naam &&
    (row.handmatig === undefined || typeof row.handmatig === "boolean") &&
    isCount(row.behandelkamers) &&
    isCount(row.boeken) &&
    isCount(row.diagnostiek)
  );
}

export function isMiddelenState(value: unknown): value is MiddelenState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.updatedAt === "string" &&
    !Number.isNaN(Date.parse(state.updatedAt)) &&
    Array.isArray(state.medewerkers) &&
    state.medewerkers.length <= MIDDELEN_LIMITS.medewerkers &&
    state.medewerkers.every(isMedewerkerMiddelen) &&
    Array.isArray(state.inventaris) &&
    state.inventaris.length <= MIDDELEN_LIMITS.inventaris &&
    state.inventaris.every(isLocatieInventaris) &&
    (state.teams === undefined ||
      (Array.isArray(state.teams) && state.teams.length <= MIDDELEN_LIMITS.teams && state.teams.every(isTeamDefinitie)))
  );
}
