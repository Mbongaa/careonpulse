"use client";

import { isMiddelenState, type MiddelenState } from "./types";

// Lokale opslag van de middelenregistratie: de directe bron bij het laden,
// en de enige opslag wanneer Supabase niet geconfigureerd is (route → 501).

const STORAGE_KEY = "careon-middelen-v1";

export function loadMiddelenState(): MiddelenState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isMiddelenState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** `false` bij quota-overschrijding of ontbrekende localStorage. */
export function saveMiddelenState(state: MiddelenState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
