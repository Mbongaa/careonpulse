import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isSupabaseAuthConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

function hardenedCookieOptions(options?: Parameters<Awaited<ReturnType<typeof cookies>>["set"]>[2]) {
  return {
    ...options,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: options?.path ?? "/",
  };
}

/**
 * Cookie-gebonden Supabase-client voor route handlers en server components.
 * Werkt met de anon-key + de sessie van de aanvrager, zodat RLS in Postgres
 * de org-scheiding afdwingt — nooit de service-role key voor gebruikersdata.
 */
export async function supabaseServer(): Promise<SupabaseClient | null> {
  if (!isSupabaseAuthConfigured()) return null;
  let cookieStore: Awaited<ReturnType<typeof cookies>>;
  try {
    cookieStore = await cookies();
  } catch {
    // Buiten een Next-request-context (scripts/tests) is er geen cookie-store:
    // fail closed — aanroeper behandelt dit als "niet geconfigureerd".
    return null;
  }
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            // httpOnly kan hier aan (en blijft aan): er bestaat bewust geen
            // Supabase-browserclient, dus geen enkel script hoeft de
            // sessiecookies te lezen — XSS kan de tokens dan niet stelen.
            cookieStore.set(name, value, hardenedCookieOptions(options));
          }
        } catch {
          // In een server component mag je geen cookies zetten; de proxy
          // (src/proxy.ts) houdt de sessie daar vers.
        }
      },
    },
  });
}
