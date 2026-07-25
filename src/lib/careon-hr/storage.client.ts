"use client";

import { type HrChangeAudit, type HrState, isHrState } from "./types";

// De cache bewaart naast de staat de server-revisie en een eventuele nog niet
// gesynchroniseerde wijziging (zelfde vorm als careon-middelen).
const STORAGE_KEY = "careon-hr-v1";
const CACHE_KEY = "careon-hr-v2";

export interface HrLocalCache {
  state: HrState;
  revision: number;
  dirty: boolean;
  operationId?: string;
  audit?: HrChangeAudit;
}

function isAudit(value: unknown): value is HrChangeAudit {
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

function isLocalCache(value: unknown): value is HrLocalCache {
  if (!value || typeof value !== "object") return false;
  const cache = value as Record<string, unknown>;
  return (
    isHrState(cache.state) &&
    Number.isInteger(cache.revision) &&
    (cache.revision as number) >= 0 &&
    typeof cache.dirty === "boolean" &&
    (cache.operationId === undefined || typeof cache.operationId === "string") &&
    (cache.audit === undefined || isAudit(cache.audit))
  );
}

export function loadHrCache(): HrLocalCache | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isLocalCache(parsed)) return parsed;
    }
    const legacy = window.localStorage.getItem(STORAGE_KEY);
    if (!legacy) return null;
    const state: unknown = JSON.parse(legacy);
    return isHrState(state) ? { state, revision: 0, dirty: false } : null;
  } catch {
    return null;
  }
}

/** `false` bij quota-overschrijding of ontbrekende localStorage. */
export function saveHrState(
  state: HrState,
  metadata: Omit<HrLocalCache, "state"> = { revision: 0, dirty: false },
): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ state, ...metadata }));
    return true;
  } catch {
    return false;
  }
}

export function clearHrState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // localStorage is unavailable; there is no durable state to clear.
  }
}
