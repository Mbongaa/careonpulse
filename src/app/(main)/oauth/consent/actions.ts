"use server";

import { redirect } from "next/navigation";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { getCareonSession } from "@/lib/supabase/session.server";

// Toestemmingsbesluit voor de OAuth 2.1-server van de identiteitshub
// (blueprint §4): Supabase levert geen consent-UI, dus het dashboard is het
// autorisatiescherm. Alles loopt server-side — de CSP staat geen
// browserverkeer naar Supabase toe (connect-src 'self') en het access token
// hoort de browser sowieso niet te bereiken.
async function beslis(formData: FormData, actie: "approve" | "deny"): Promise<void> {
  const authorizationId = String(formData.get("authorization_id") ?? "");
  // Vorm-check vóór interpolatie in het pad; een onbruikbaar id betekent dat
  // de flow niet meer te herstellen is — terug naar de launcher.
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(authorizationId)) redirect("/modules");
  const resultaat = await getCareonSession();
  if (resultaat.status !== "ok") redirect("/auth/v1/login");

  const antwoord = await fetch(`${SUPABASE_URL}/auth/v1/oauth/authorizations/${authorizationId}/consent`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${resultaat.session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: actie }),
    cache: "no-store",
  });
  const data = (await antwoord.json().catch(() => null)) as { redirect_url?: string; url?: string } | null;
  const doel = data?.redirect_url ?? data?.url;
  if (!antwoord.ok || !doel) {
    console.error("OAuth consent: besluit mislukt", antwoord.status, data);
    redirect(`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}&error=besluit`);
  }
  // Terug naar de module (redirect_uri van de client) met code, of met de
  // weigering — de OAuth-server bepaalt het doel, wij sturen alleen door.
  redirect(doel);
}

export async function verleenToegang(formData: FormData): Promise<void> {
  await beslis(formData, "approve");
}

export async function weigerToegang(formData: FormData): Promise<void> {
  await beslis(formData, "deny");
}
