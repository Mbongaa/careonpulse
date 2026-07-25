"use client";

import { isMiddelenState, type MiddelenChangeAudit, type MiddelenState } from "./types";

// De v2-cache bewaart naast de staat ook de server-revisie en een eventuele
// nog niet gesynchroniseerde wijziging. De v1-sleutel blijft leesbaar voor
// bestaande browsers en andere oudere onderdelen.
const STORAGE_KEY = "careon-middelen-v1";
const CACHE_KEY = "careon-middelen-v2";

export interface MiddelenLocalCache {
  state: MiddelenState;
  revision: number;
  dirty: boolean;
  operationId?: string;
  audit?: MiddelenChangeAudit;
}

function isAudit(value: unknown): value is MiddelenChangeAudit {
  if (!value || typeof value !== "object") return false;
  const audit = value as Record<string, unknown>;
  return (
    (audit.source === "assistant" || audit.source === "manual") &&
    (audit.toolNames === undefined ||
      (Array.isArray(audit.toolNames) && audit.toolNames.every((name) => typeof name === "string"))) &&
    (audit.requestIds === undefined ||
      (Array.isArray(audit.requestIds) && audit.requestIds.every((id) => typeof id === "string")))
  );
}

function isLocalCache(value: unknown): value is MiddelenLocalCache {
  if (!value || typeof value !== "object") return false;
  const cache = value as Record<string, unknown>;
  return (
    isMiddelenState(cache.state) &&
    Number.isInteger(cache.revision) &&
    (cache.revision as number) >= 0 &&
    typeof cache.dirty === "boolean" &&
    (cache.operationId === undefined || typeof cache.operationId === "string") &&
    (cache.audit === undefined || isAudit(cache.audit))
  );
}

export function loadMiddelenCache(): MiddelenLocalCache | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isLocalCache(parsed)) return parsed;
    }
    const legacy = window.localStorage.getItem(STORAGE_KEY);
    if (!legacy) return null;
    const state: unknown = JSON.parse(legacy);
    return isMiddelenState(state) ? { state, revision: 0, dirty: false } : null;
  } catch {
    return null;
  }
}

export function loadMiddelenState(): MiddelenState | null {
  const cache = loadMiddelenCache();
  return cache ? cache.state : null;
}

/** `false` bij quota-overschrijding of ontbrekende localStorage. */
export function saveMiddelenState(
  state: MiddelenState,
  metadata: Omit<MiddelenLocalCache, "state"> = { revision: 0, dirty: false },
): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ state, ...metadata }));
    return true;
  } catch {
    return false;
  }
}

export function clearMiddelenState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // localStorage is unavailable; there is no durable state to clear.
  }
}
