"use client";

import { clearCareonAssistantSession } from "@/lib/careon-assistant/session.client";
import { clearCareonAssistantHistory } from "@/lib/careon-assistant/storage.client";
import { clearHrState } from "@/lib/careon-hr/storage.client";
import { clearMiddelenState } from "@/lib/careon-middelen/storage.client";
import { clearAuxFacts, clearProductionState } from "@/lib/careon-production/storage.client";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";

// Eigenaarsstempel voor álle browsercaches van het dashboard (productie-import,
// aanvullende exports, HR, middelen, assistent). Op een gedeelde werkplek is
// een sessiewissel zonder "Uitloggen" de lekroute: de caches overleven hem, en
// de "centraal wint alleen als nieuwer"-regel laat de vreemde kopie dan staan.
// Granulariteit = organisatie: binnen één organisatie is de centrale staat
// gedeeld, dus daar is een cache legitiem herbruikbaar tussen gebruikers.

const EIGENAAR_KEY = "careon-cache-eigenaar";

/** Vaste eigenaar van de demo-modus (geen organisatie, wel stabiel). */
export const CAREON_DEMO_EIGENAAR = "demo";

export interface CareonCacheEigenaarInput {
  authed: boolean;
  orgId: string | null;
  email: string;
}

/**
 * `null` = onbekende eigenaar: uitgelogd, verlopen of misconfiguratie terwijl
 * echte accounts aanstaan. Dan wordt er bewust niets gewist — die render toont
 * toch niets (de sessiepoort stuurt door naar login) en pas een écht
 * geïdentificeerde volgende sessie mag over andermans cache oordelen.
 */
export function careonCacheEigenaar(info: CareonCacheEigenaarInput): string | null {
  if (info.authed && info.orgId) return `org:${info.orgId}`;
  // Platformbeheerder zonder lidmaatschap: e-mail is de enige stabiele
  // identiteit die zowel de layout als /api/auth/session teruggeeft.
  if (info.authed && info.email) return `gebruiker:${info.email.toLowerCase()}`;
  return isSupabaseAuthConfigured() ? null : CAREON_DEMO_EIGENAAR;
}

function leesEigenaar(): string | null {
  try {
    return window.localStorage.getItem(EIGENAAR_KEY);
  } catch {
    return null;
  }
}

/**
 * Heeft een ándere identiteit deze browser overgenomen sinds dit tabblad laadde?
 * Een tab die open bleef staan houdt zijn eigen eigenaar in geheugen terwijl de
 * volgende gebruiker de stempel al heeft gezet; zijn retry-lus zou dan onder de
 * cookie van die nieuwe gebruiker landen en diens registratie overschrijven.
 * Bewust alleen `true` bij een aantoonbaar áfwijkende stempel: een onbekende
 * eigenaar (demo, misconfiguratie) of een nog ongestempelde browser mag gewoon
 * blijven bewaren.
 */
export function cacheEigenaarOvergenomen(eigenaar: string | null): boolean {
  if (typeof window === "undefined" || eigenaar === null) return false;
  const stempel = leesEigenaar();
  return stempel !== null && stempel !== eigenaar;
}

export function wisCareonCaches(): void {
  clearProductionState();
  clearAuxFacts();
  clearMiddelenState();
  clearHrState();
  clearCareonAssistantHistory();
  clearCareonAssistantSession();
}

/**
 * Wist elke cache die niet aantoonbaar van `eigenaar` is en zet de stempel.
 * Een cache zónder stempel (geschreven vóór deze release) geldt als vreemd:
 * weggooien is de veilige kant, want demo-data is een seed en centrale data
 * komt bij de eerstvolgende fetch gewoon terug. Idempotent, zodat elke
 * provider hem als eerste regel van zijn hydratatie mag aanroepen.
 */
export function bewaakCacheEigenaar(eigenaar: string | null): boolean {
  if (typeof window === "undefined" || eigenaar === null) return false;
  if (leesEigenaar() === eigenaar) return false;
  wisCareonCaches();
  try {
    window.localStorage.setItem(EIGENAAR_KEY, eigenaar);
  } catch {
    // Zonder localStorage is er ook niets blijvends om te scheiden.
  }
  return true;
}
