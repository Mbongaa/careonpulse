"use client";

export const ASSISTANT_THREADS_KEY = "careon:assistent:threads:v1";
export const ASSISTANT_MESSAGES_PREFIX = "careon:assistent:messages:v1:";

const HISTORY_MODE = process.env.NEXT_PUBLIC_CAREON_ASSISTANT_HISTORY_STORAGE ?? "session";
const parsedRetentionDays = Number(process.env.NEXT_PUBLIC_CAREON_ASSISTANT_HISTORY_RETENTION_DAYS);
export const ASSISTANT_HISTORY_RETENTION_MS =
  (Number.isFinite(parsedRetentionDays) ? Math.min(30, Math.max(1, parsedRetentionDays)) : 7) * 86_400_000;

export function careonAssistantStorage(): Storage | null {
  if (typeof window === "undefined" || HISTORY_MODE === "off") return null;
  try {
    const storage = HISTORY_MODE === "local" ? window.localStorage : window.sessionStorage;
    const probe = "__careon_assistent_probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

function clearFrom(storage: Storage): void {
  storage.removeItem(ASSISTANT_THREADS_KEY);
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(ASSISTANT_MESSAGES_PREFIX)) storage.removeItem(key);
  }
}

/** Wis assistentinhoud bij uitloggen, inclusief historie uit oudere releases. */
export function clearCareonAssistantHistory(): void {
  if (typeof window === "undefined") return;
  try {
    clearFrom(window.sessionStorage);
  } catch {
    // Opslag kan door browserbeleid geblokkeerd zijn.
  }
  try {
    clearFrom(window.localStorage);
  } catch {
    // Opslag kan door browserbeleid geblokkeerd zijn.
  }
}
