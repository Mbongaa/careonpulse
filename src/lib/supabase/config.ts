// Gedeelde Supabase-configuratie (client + server bruikbaar).
//
// Auth-modus: echte accounts met server-afgedwongen cookie-sessies, of de
// expliciete lokale demo wanneer CAREON_DEMO_MODE=1. Ontbrekende Supabase-
// configuratie zonder die vlag faalt gesloten met 503.
// De anon-key is publiek by design (NEXT_PUBLIC_); RLS beschermt de data.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function isCareonDemoMode(): boolean {
  return process.env.CAREON_DEMO_MODE === "1";
}

export function isSupabaseAuthConfigured(): boolean {
  return SUPABASE_URL.trim() !== "" && SUPABASE_ANON_KEY.trim() !== "";
}
