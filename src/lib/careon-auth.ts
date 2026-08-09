import { clearCareonAssistantSession } from "./careon-assistant/session.client";
import { clearCareonAssistantHistory } from "./careon-assistant/storage.client";
import { CAREON_HOSTED_DEMO_USERNAME } from "./careon-demo-account";
import { clearFacturatieState } from "./careon-facturatie/storage.client";
import { clearHrState } from "./careon-hr/storage.client";
import { clearMiddelenState } from "./careon-middelen/storage.client";
import { clearAuxFacts, clearProductionState } from "./careon-production/storage.client";
import { bewaakCacheEigenaar, CAREON_DEMO_EIGENAAR, careonCacheEigenaar } from "./careon-tenant/cache-owner.client";
import { flushOnbewaardeRegistraties, type OnbewaardeRegistraties } from "./careon-tenant/pending.client";
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

export type CareonSignInResult = "ok" | "invalid" | "no-org" | "unavailable";

/**
 * Meldingen per uitkomst. "invalid" houdt exact de geauditeerde tekst; een
 * geldig account zónder organisatie (403) kreeg die tekst voorheen ook en
 * belandde daardoor in een herprobeerlus tegen de rate limiter aan.
 */
export const CAREON_SIGNIN_MESSAGES: Record<Exclude<CareonSignInResult, "ok">, string> = {
  invalid: "Onjuiste combinatie — probeer het opnieuw.",
  "no-org": "Dit account is nog niet aan een organisatie gekoppeld. Neem contact op met de beheerder.",
  unavailable: "Inloggen is tijdelijk niet beschikbaar — probeer het later opnieuw.",
};

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
    // 403 = wél geauthenticeerd, maar geen organisatie/platformrol.
    if (response.status === 403) return "no-org";
    return response.status === 401 ? "invalid" : "unavailable";
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
 *
 * Hier staat ook de eerste eigenaarscontrole: caches van een vorige gebruiker
 * horen weg vóór het dashboard laadt, niet pas bij een expliciete uitlog — een
 * verlopen sessie zonder "Uitloggen" is juist de lekroute op een gedeelde
 * werkplek. De providers herhalen de controle bij hun hydratatie.
 */
export async function careonPostLoginRoute(): Promise<string> {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as {
      orgId?: string | null;
      email?: string;
      isSuperadmin?: boolean;
      demo?: boolean;
    } | null;
    if (response.ok) {
      bewaakCacheEigenaar(
        careonCacheEigenaar({
          authed: true,
          orgId: typeof payload?.orgId === "string" ? payload.orgId : null,
          email: typeof payload?.email === "string" ? payload.email : "",
        }),
      );
      if (payload?.isSuperadmin === true) return "/admin";
    } else if (response.status === 501 && payload?.demo === true) {
      bewaakCacheEigenaar(CAREON_DEMO_EIGENAAR);
    }
  } catch {
    // Val terug op de launcher; de proxy en (admin)-layout bewaken de routes.
  }
  return "/modules";
}

export interface CareonLogoutResultaat {
  ok: boolean;
  /** Registraties die ná de laatste bewaarpoging nog alleen lokaal staan; die
      caches zijn bewust blijven staan en verdienen een waarschuwing. */
  onbewaard: OnbewaardeRegistraties;
}

/**
 * Uitloggen mét signaal over niet-gesynchroniseerde registraties. De laatste
 * bewaarpoging gaat vooraf aan de uitlog-call: daarna weigert elke dataroute
 * de push (geen sessie meer).
 */
export async function careonLogoutMetSignaal(): Promise<CareonLogoutResultaat> {
  const onbewaard = await flushOnbewaardeRegistraties();
  let response: Response;
  try {
    response = await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
  } catch {
    return { ok: false, onbewaard };
  }
  if (!response.ok && response.status !== 501) return { ok: false, onbewaard };
  if (response.status === 501) {
    const payload = (await response.json().catch(() => null)) as { demo?: boolean } | null;
    if (payload?.demo !== true) return { ok: false, onbewaard };
  }
  window.sessionStorage.removeItem(CAREON_AUTH_KEY);
  clearCareonAssistantHistory();
  clearCareonAssistantSession();
  clearProductionState();
  clearAuxFacts();
  // Facturatie: centraal werk staat al via autosave in Supabase; de lokale
  // sleutel draagt alleen demo-staat en verdwijnt — zelfde lijn als productie.
  clearFacturatieState();
  // HR en middelen zijn handmatige registraties zonder tweede bron: een cache
  // die nog niet centraal staat wissen betekent definitief verlies. Die blijft
  // staan tot dezelfde eigenaar hem alsnog kan wegschrijven; een ándere
  // gebruiker op deze werkplek ruimt hem op via de eigenaarscontrole.
  if (!onbewaard.middelen) clearMiddelenState();
  if (!onbewaard.hr) clearHrState();
  if ("caches" in window) {
    try {
      const names = await window.caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("careon-")).map((name) => window.caches.delete(name)));
    } catch {
      // CacheStorage may be unavailable in private browsing.
    }
  }
  return { ok: true, onbewaard };
}

// Bewust géén careonLogout()-wrapper die het onbewaard-signaal weggooit: elk
// uitlogpunt hoort de gebruiker via careonLogoutMetSignaal te waarschuwen dat
// er nog niet-gesynchroniseerd werk in deze browser staat.

export type { OnbewaardeRegistraties } from "./careon-tenant/pending.client";
export { heeftOnbewaardeRegistraties, onbewaardeRegistraties } from "./careon-tenant/pending.client";
