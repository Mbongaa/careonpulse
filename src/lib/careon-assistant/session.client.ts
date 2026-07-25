"use client";

const SESSION_KEY = "careon-assistant-session-v1";

function fallbackId(): string {
  const random = Math.random().toString(36).slice(2);
  return `careon-${Date.now().toString(36)}-${random}-${random}`;
}

export function getCareonAssistantSessionId(): string {
  try {
    const current = window.sessionStorage.getItem(SESSION_KEY);
    if (current) return current;
    const created = globalThis.crypto?.randomUUID?.() ?? fallbackId();
    window.sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return fallbackId();
  }
}

export function clearCareonAssistantSession(): void {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // sessionStorage is unavailable; there is no durable identifier to clear.
  }
}
