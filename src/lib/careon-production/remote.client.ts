"use client";

import { isProductionState, type ProductionState } from "./types";

// Dunne client voor de optionele Supabase-persistentie. Zonder geconfigureerde
// omgeving antwoordt de route met 501; alle functies degraderen dan stil naar
// null/no-op en localStorage blijft de bron.

const ENDPOINT = "/api/careon/production";

// Gedeeld sync-token: de route weigert verzoeken zonder dit token. Het zit in
// de client-bundle en is dus een drempel tegen scanners/toevallige bezoekers,
// géén vervanging voor echte authenticatie (zie PRODUCTION_MODE.md).
const SYNC_TOKEN = process.env.NEXT_PUBLIC_CAREON_SYNC_TOKEN;

function syncHeaders(extra?: HeadersInit): HeadersInit {
  return { ...(SYNC_TOKEN ? { "x-careon-sync": SYNC_TOKEN } : {}), ...extra };
}

export type PushResult = "ok" | "unconfigured" | "failed";

export async function fetchRemoteProductionState(): Promise<ProductionState | null> {
  try {
    const response = await fetch(ENDPOINT, { cache: "no-store", headers: syncHeaders() });
    if (!response.ok) return null;
    const payload = (await response.json()) as { state?: unknown };
    return isProductionState(payload.state) ? payload.state : null;
  } catch {
    return null;
  }
}

/**
 * Centrale opslag is best-effort, maar het resultaat wordt wél gemeld: een
 * stil mislukte push betekent dat collega's (en verse browsers) een oudere
 * import blijven zien zonder dat iemand het merkt.
 */
export async function pushRemoteProductionState(state: ProductionState): Promise<PushResult> {
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: syncHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(state),
    });
    if (response.status === 501) return "unconfigured";
    return response.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}
