"use client";

import type { PushResult } from "../careon-production/remote.client";
import { isMiddelenState, type MiddelenState } from "./types";

// Dunne client voor de centrale middelenopslag, zelfde patroon als de
// productie-state: zonder geconfigureerde Supabase-omgeving antwoordt de
// route met 501 en blijft localStorage de bron.

const ENDPOINT = "/api/careon/middelen";

const SYNC_TOKEN = process.env.NEXT_PUBLIC_CAREON_SYNC_TOKEN;

function syncHeaders(extra?: HeadersInit): HeadersInit {
  return { ...(SYNC_TOKEN ? { "x-careon-sync": SYNC_TOKEN } : {}), ...extra };
}

export interface RemoteMiddelenResult {
  /** true: centrale opslag werkt (ook wanneer er nog niets is opgeslagen). */
  configured: boolean;
  state: MiddelenState | null;
}

// "Geconfigureerd maar nog leeg" en "niet geconfigureerd" zijn verschillende
// situaties: de eerste hoort géén lokale-opslag-waarschuwing te tonen.
export async function fetchRemoteMiddelenState(): Promise<RemoteMiddelenResult> {
  try {
    const response = await fetch(ENDPOINT, { cache: "no-store", headers: syncHeaders() });
    if (!response.ok) {
      return { configured: false, state: null };
    }
    const payload = (await response.json()) as { configured?: boolean; state?: unknown };
    return {
      configured: payload.configured === true,
      state: isMiddelenState(payload.state) ? payload.state : null,
    };
  } catch {
    return { configured: false, state: null };
  }
}

export async function pushRemoteMiddelenState(state: MiddelenState): Promise<PushResult> {
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
