"use client";

import { getLocalStorageValue, setLocalStorageValue } from "@/lib/local-storage.client";

import { isProductionState, type ProductionState } from "./types";

// Productie-state (gepseudonimiseerde records + importmetadata) wordt lokaal
// bewaard zodat productie-modus een herlaad overleeft. Bij een geconfigureerde
// Supabase-omgeving is de server de bron; localStorage blijft de fallback.

const STORAGE_KEY = "careon-production-v1";

// Expliciete demo-keuze: gezet door "Herstel demo-data" (of een csv/api-
// activatie) zodat een centrale Supabase-run productie-modus niet ongevraagd
// opnieuw activeert na een herlaad.
const OPTOUT_KEY = "careon-production-optout";

/**
 * Bewaart de productie-state; `false` bij quota-overschrijding of ontbrekende
 * localStorage. De aanroeper toont dan een waarschuwing — een stil verlies
 * betekent dat het dashboard na een herlaad onaangekondigd terugvalt op demo.
 */
export function saveProductionState(state: ProductionState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearProductionState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage niet beschikbaar — niets te wissen.
  }
}

export function setProductionOptOut(optedOut: boolean): void {
  try {
    if (optedOut) {
      setLocalStorageValue(OPTOUT_KEY, "1");
    } else {
      window.localStorage.removeItem(OPTOUT_KEY);
    }
  } catch {
    // Niet persistent — hooguit één extra remote-fetch na herlaad.
  }
}

export function hasProductionOptOut(): boolean {
  return getLocalStorageValue(OPTOUT_KEY) === "1";
}

export function loadProductionState(): ProductionState | null {
  const raw = getLocalStorageValue(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isProductionState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
