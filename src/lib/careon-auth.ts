import { clearCareonAssistantSession } from "./careon-assistant/session.client";
import { clearCareonAssistantHistory } from "./careon-assistant/storage.client";
import { CAREON_HOSTED_DEMO_USERNAME } from "./careon-demo-account";
import { clearHrState } from "./careon-hr/storage.client";
import { clearMiddelenState } from "./careon-middelen/storage.client";
import { clearAuxFacts, clearProductionState } from "./careon-production/storage.client";
import { isSupabaseAuthConfigured } from "./supabase/config";

// Twee auth-standen (zie handoff 13):
//  - Supabase-modus: echte accounts; inloggen loopt via /api/auth/login
//    (server-side cookies, CSP blijft connect-src 'self'), afdwinging zit in
//    src/proxy.ts + requireCareonSession in elke route.
//  - Expliciete demo-modus (server antwoordt 501 + demo:true): de oorspronkelijke
//    sessionStorage-flow met user1/demo1234. Ontbrekende config geeft 503.

export const CAREON_AUTH_KEY = "careon-auth";

export const CAREON_DEMO_CREDENTIALS = {
  username: CAREON_HOSTED_DEMO_USERNAME,
  password: "demo1234",
};

export const CAREON_LOGIN_ROUTE = "/auth/v1/login";

export type CareonSignInResult = "ok" | "invalid" | "unavailable";

/** Echte accounts actief? (NEXT_PUBLIC_-waarden: zelfde antwoord op server en client.) */
export function isSupabaseAuthMode(): boolean {
  return isSupabaseAuthConfigured();
}

export function isCareonAuthed(): boolean {
  return typeof window !== "undefined" && window.sessionStorage.getItem(CAREON_AUTH_KEY) === "1";
}

export function careonLogin(): void {
  window.sessionStorage.setItem(CAREON_AUTH_KEY, "1");
}

/**
 * Logt in met gebruikersnaam (of e-mailadres) + wachtwoord. In Supabase-modus
 * Altijd eerst via de server. Alleen een expliciet demo-contract (501 +
 * demo:true) activeert de lokale controle met de geauditeerde laadtoestand.
 */
export async function careonSignIn(username: string, password: string): Promise<CareonSignInResult> {
  let response: Response;
  try {
    response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
  } catch {
    return "unavailable";
  }
  if (response.ok) {
    careonLogin();
    return "ok";
  }
  if (response.status !== 501) {
    return response.status === 401 || response.status === 403 ? "invalid" : "unavailable";
  }
  const payload = (await response.json().catch(() => null)) as { demo?: boolean } | null;
  if (payload?.demo !== true) return "unavailable";
  await new Promise((resolve) => window.setTimeout(resolve, 800));
  // Gebruikersnaam is niet hoofdlettergevoelig; het wachtwoord wel.
  const ok =
    username.trim().toLowerCase() === CAREON_DEMO_CREDENTIALS.username.toLowerCase() &&
    password === CAREON_DEMO_CREDENTIALS.password;
  if (ok) careonLogin();
  return ok ? "ok" : "invalid";
}

/**
 * Landingsroute na een geslaagde login: platformbeheerders gaan direct naar
 * het superadmin-dashboard, alle andere accounts naar de module-launcher.
 * Demo-modus (501) en elke fout vallen terug op de launcher.
 */
export async function careonPostLoginRoute(): Promise<string> {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json().catch(() => null)) as { isSuperadmin?: boolean } | null;
      if (payload?.isSuperadmin === true) return "/admin";
    }
  } catch {
    // Val terug op de launcher; de proxy en (admin)-layout bewaken de routes.
  }
  return "/modules";
}

export async function careonLogout(): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
  } catch {
    return false;
  }
  if (!response.ok && response.status !== 501) return false;
  if (response.status === 501) {
    const payload = (await response.json().catch(() => null)) as { demo?: boolean } | null;
    if (payload?.demo !== true) return false;
  }
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
  return true;
}
