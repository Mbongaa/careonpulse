import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import type { CareonSession } from "./session.server";

// PostgREST-toegang namens de ingelogde gebruiker: anon-key als apikey en het
// eigen JWT als Bearer. Postgres draait dan als rol `authenticated` en RLS
// dwingt de org-scheiding af — de service-role key komt hier bewust niet voor.

export const POSTGREST_URL = `${SUPABASE_URL}/rest/v1`;

export function userRestHeaders(session: CareonSession, extra?: HeadersInit): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
    ...extra,
  };
}
