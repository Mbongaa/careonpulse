"use client";

import { useSyncExternalStore } from "react";

import { SCRIBE_LIMITS, type Spreker } from "./types";

const PREFIX = "careon-scribe-concept-";
const FRAGMENT_PREFIX = "careon-scribe-pending-fragments-";
let generation = 0;
const sessionGenerations = new Map<string, number>();
const listeners = new Set<() => void>();
const pending = new Map<string, number>();
const OWNER_KEY = "careon-scribe-eigenaar";
let activeOwner: string | null = null;
let ownerListenerInstalled = false;

export function scribeIdentityCurrent(): boolean {
  try {
    const current = window.localStorage.getItem(OWNER_KEY);
    return activeOwner === null || current === null || current === activeOwner;
  } catch {
    return true;
  }
}

/** Called by the authenticated shell before any personal clinical content mounts. */
export function bewaakScribeEigenaar(orgId: string | null, email: string): void {
  if (!email.trim()) return;
  const owner = `${orgId ?? ""}:${email.trim().toLowerCase()}`;
  try {
    if (window.sessionStorage.getItem(OWNER_KEY) !== owner) {
      clearScribeDrafts();
      window.localStorage.removeItem("careon-scribe-v1");
    }
    window.sessionStorage.setItem(OWNER_KEY, owner);
    window.localStorage.setItem(OWNER_KEY, owner);
  } catch {
    clearScribeDrafts();
  }
  activeOwner = owner;
  if (!ownerListenerInstalled) {
    ownerListenerInstalled = true;
    window.addEventListener("storage", (event) => {
      if (event.key === OWNER_KEY && !scribeIdentityCurrent()) clearScribeDrafts();
    });
  }
}

export function scribeDraftGeneration(sessieId = ""): string {
  return `${generation}:${sessionGenerations.get(sessieId) ?? 0}`;
}

function notify() {
  for (const listener of listeners) listener();
}

export function readScribeDraft(sessieId: string): { tekst: string; spreker: Spreker } {
  try {
    const raw = window.sessionStorage.getItem(`${PREFIX}${sessieId}`);
    if (!raw) return { tekst: "", spreker: "arts" };
    try {
      const value = JSON.parse(raw) as { tekst?: unknown; spreker?: unknown };
      if (typeof value.tekst === "string") {
        return {
          tekst: value.tekst,
          spreker: ["arts", "patient", "overig", "onbekend"].includes(String(value.spreker))
            ? (value.spreker as Spreker)
            : "arts",
        };
      }
    } catch {
      // Older drafts contained just the text.
    }
    return { tekst: raw, spreker: "arts" };
  } catch {
    return { tekst: "", spreker: "arts" };
  }
}

const draftInMemory = new Map<string, boolean>();

export function writeScribeDraft(sessieId: string, tekst: string, spreker: Spreker, token: string): void {
  if (token !== scribeDraftGeneration(sessieId) || !scribeIdentityCurrent()) return;
  draftInMemory.set(sessieId, tekst.trim().length > 0);
  try {
    if (tekst.length === 0) window.sessionStorage.removeItem(`${PREFIX}${sessieId}`);
    else
      window.sessionStorage.setItem(
        `${PREFIX}${sessieId}`,
        JSON.stringify({ tekst: tekst.slice(0, SCRIBE_LIMITS.segmentTekst), spreker }),
      );
  } catch {
    // The live editor still retains the text when storage is unavailable.
  }
  notify();
}

/** Successful submission clears exactly its draft without invalidating the editor. */
export function clearSubmittedScribeDraft(sessieId: string, token: string): void {
  writeScribeDraft(sessieId, "", "arts", token);
}

export function clearScribeDraft(sessieId: string): void {
  sessionGenerations.set(sessieId, (sessionGenerations.get(sessieId) ?? 0) + 1);
  draftInMemory.delete(sessieId);
  pending.delete(sessieId);
  try {
    window.sessionStorage.removeItem(`${PREFIX}${sessieId}`);
    window.sessionStorage.removeItem(`${FRAGMENT_PREFIX}${sessieId}`);
  } catch {
    /* Storage unavailable. */
  }
  notify();
}

/** Logout/account changes invalidate callbacks before removing all clinical drafts. */
export function clearScribeDrafts(): void {
  generation += 1;
  draftInMemory.clear();
  pending.clear();
  try {
    const keys = Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index));
    for (const key of keys)
      if (key?.startsWith(PREFIX) || key?.startsWith(FRAGMENT_PREFIX)) window.sessionStorage.removeItem(key);
  } catch {
    /* Storage unavailable. */
  }
  notify();
}

export interface ScribePendingFragment {
  id: string;
  duurMs: number;
}

/** Content-free recovery metadata. Audio and transcript text never enter this record. */
export function readScribePendingFragments(sessieId: string): ScribePendingFragment[] {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(`${FRAGMENT_PREFIX}${sessieId}`) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (row): row is ScribePendingFragment =>
        row &&
        typeof row.id === "string" &&
        /^[0-9a-f-]{36}$/i.test(row.id) &&
        Number.isSafeInteger(row.duurMs) &&
        row.duurMs > 0 &&
        row.duurMs <= 45_000,
    );
  } catch {
    return [];
  }
}

export function canPersistScribeFragments(): boolean {
  try {
    window.sessionStorage.setItem("careon-scribe-fragment-check", "1");
    window.sessionStorage.removeItem("careon-scribe-fragment-check");
    return true;
  } catch {
    return false;
  }
}

export function saveScribePendingFragment(sessieId: string, fragment: ScribePendingFragment, token: string): boolean {
  if (token !== scribeDraftGeneration(sessieId) || !scribeIdentityCurrent()) return false;
  try {
    const pendingFragments = new Map(readScribePendingFragments(sessieId).map((row) => [row.id, row]));
    pendingFragments.set(fragment.id, fragment);
    window.sessionStorage.setItem(`${FRAGMENT_PREFIX}${sessieId}`, JSON.stringify([...pendingFragments.values()]));
    return true;
  } catch {
    return false;
  }
}

export function acknowledgeScribePendingFragment(sessieId: string, id: string, token: string): void {
  if (token !== scribeDraftGeneration(sessieId) || !scribeIdentityCurrent()) return;
  try {
    const rows = readScribePendingFragments(sessieId).filter((row) => row.id !== id);
    if (rows.length === 0) window.sessionStorage.removeItem(`${FRAGMENT_PREFIX}${sessieId}`);
    else window.sessionStorage.setItem(`${FRAGMENT_PREFIX}${sessieId}`, JSON.stringify(rows));
  } catch {
    /* An unresolved acknowledgment is retried idempotently after reload. */
  }
}

export function setScribeDraftPending(sessieId: string, delta: number): void {
  pending.set(sessieId, Math.max(0, (pending.get(sessieId) ?? 0) + delta));
  notify();
}

export function hasUnsentScribeDraft(sessieId: string): boolean {
  return (
    (pending.get(sessieId) ?? 0) > 0 ||
    draftInMemory.get(sessieId) === true ||
    readScribeDraft(sessieId).tekst.trim().length > 0
  );
}

export function useUnsentScribeDraft(sessieId: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => hasUnsentScribeDraft(sessieId),
    () => false,
  );
}
