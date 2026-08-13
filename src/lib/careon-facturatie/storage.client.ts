"use client";

import { DEMO_CONTACTEN, DEMO_FACTURATIE_INSTELLINGEN, DEMO_FACTUREN } from "@/data/careon/careon-facturatie";

import {
  type FacturatieContact,
  type FacturatieInstellingen,
  type Factuur,
  type FactuurMaillogRegel,
  isFacturatieContact,
  isFacturatieInstellingen,
  isFactuur,
  isFactuurMaillogRegel,
} from "./types";

// Demo-pad van de facturatiemodule (handoff 15, B12): de e2e-suite draait
// uitsluitend in demo-modus (alle routes geven 501) en de sales-demo moet de
// volledige werkstroom tonen. Deze localStorage-store is dan de opslag,
// inclusief een client-side nummerteller — de gedocumenteerde, enige
// uitzondering op B9 ("nummering is DB-werk"), uitsluitend actief zonder
// Supabase-sessie. De sleutel staat onvoorwaardelijk in wisCareonCaches().

export const FACTURATIE_CACHE_KEY = "careon-facturatie-v1";

export interface FacturatieLocalState {
  facturen: Factuur[];
  contacten: FacturatieContact[];
  instellingen: FacturatieInstellingen;
  /** Client-side teller per reeks+jaar — alleen demo (zie boven). */
  tellers: Record<string, number>;
  /** Fase B: gesimuleerde verzendhistorie. Optioneel — oudere opgeslagen
      demo-states (zonder dit veld) blijven geldig en worden niet gewist. */
  maillog?: FactuurMaillogRegel[];
}

function isTellers(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every(
    (teller) => typeof teller === "number" && Number.isInteger(teller) && teller >= 0,
  );
}

function isLocalState(value: unknown): value is FacturatieLocalState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return (
    Array.isArray(state.facturen) &&
    state.facturen.every(isFactuur) &&
    Array.isArray(state.contacten) &&
    state.contacten.every(isFacturatieContact) &&
    isFacturatieInstellingen(state.instellingen) &&
    isTellers(state.tellers) &&
    (state.maillog === undefined || (Array.isArray(state.maillog) && state.maillog.every(isFactuurMaillogRegel)))
  );
}

/** Deterministische demo-startstand (seeds uit careon-facturatie.ts). */
export function demoFacturatieState(): FacturatieLocalState {
  return {
    facturen: DEMO_FACTUREN.map((factuur) => ({ ...factuur })),
    contacten: DEMO_CONTACTEN.map((contact) => ({ ...contact })),
    instellingen: { ...DEMO_FACTURATIE_INSTELLINGEN },
    // De twee uitgereikte demo-facturen bezetten F/2026 t/m volgnummer 2.
    tellers: { "F:2026": 2 },
  };
}

export function loadFacturatieState(): FacturatieLocalState | null {
  try {
    const raw = window.localStorage.getItem(FACTURATIE_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isLocalState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** `false` bij quota-overschrijding of ontbrekende localStorage. */
export function saveFacturatieState(state: FacturatieLocalState): boolean {
  try {
    window.localStorage.setItem(FACTURATIE_CACHE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearFacturatieState(): void {
  try {
    window.localStorage.removeItem(FACTURATIE_CACHE_KEY);
  } catch {
    // localStorage is unavailable; there is no durable state to clear.
  }
}

/** Demo-nummertoekenning: teller per reeks+jaar, seed uit het sjabloon. */
export function volgendDemoNummer(
  state: FacturatieLocalState,
  reeks: string,
  jaar: number,
  startVolgnummer: number,
): number {
  const sleutel = `${reeks}:${jaar}`;
  const huidig = state.tellers[sleutel] ?? startVolgnummer - 1;
  const volgend = huidig + 1;
  state.tellers[sleutel] = volgend;
  return volgend;
}
