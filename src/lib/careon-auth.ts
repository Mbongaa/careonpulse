import { clearCareonAssistantSession } from "./careon-assistant/session.client";
import { clearCareonAssistantHistory } from "./careon-assistant/storage.client";
import { clearHrState } from "./careon-hr/storage.client";
import { clearMiddelenState } from "./careon-middelen/storage.client";
import { clearAuxFacts, clearProductionState } from "./careon-production/storage.client";

export const CAREON_AUTH_KEY = "careon-auth";

export const CAREON_DEMO_CREDENTIALS = {
  username: "user1",
  password: "demo1234",
};

export const CAREON_LOGIN_ROUTE = "/auth/v1/login";

export function isCareonAuthed(): boolean {
  return typeof window !== "undefined" && window.sessionStorage.getItem(CAREON_AUTH_KEY) === "1";
}

export function careonLogin(): void {
  window.sessionStorage.setItem(CAREON_AUTH_KEY, "1");
}

export async function careonLogout(): Promise<void> {
  window.sessionStorage.removeItem(CAREON_AUTH_KEY);
  clearCareonAssistantHistory();
  clearCareonAssistantSession();
  clearProductionState();
  clearAuxFacts();
  clearMiddelenState();
  clearHrState();
  if ("caches" in window) {
    try {
      const names = await window.caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("careon-")).map((name) => window.caches.delete(name)));
    } catch {
      // CacheStorage may be unavailable in private browsing.
    }
  }
}
