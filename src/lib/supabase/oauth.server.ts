import { isCareonDemoMode, isSupabaseAuthConfigured } from "./config";

const PUBLIC_APP_URL = process.env.CAREON_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ?? "";

/**
 * De Microsoft-knop gaat pas live nadat de tenant-app in Entra én de Azure-
 * provider in Supabase zijn ingericht. Alleen een Supabase-URL is daarvoor
 * niet genoeg: zonder deze expliciete schakel zou productie een kapotte knop
 * tonen zolang TGC-IT de app-registratie nog niet heeft opgeleverd.
 */
export function isMicrosoftLoginEnabled(): boolean {
  return !isCareonDemoMode() && isSupabaseAuthConfigured() && process.env.CAREON_MICROSOFT_LOGIN_ENABLED === "1";
}

/**
 * Canonieke browser-origin voor OAuth redirects. In productie vertrouwen we
 * nooit Host/x-forwarded-host/request.url: een vervalste host zou de code naar
 * een aanvallersdomein kunnen sturen. Lokaal is request.url de praktische,
 * veilige fallback zolang de devserver rechtstreeks wordt benaderd.
 */
export function careonOAuthOrigin(request: Request): string | null {
  if (PUBLIC_APP_URL) return PUBLIC_APP_URL;
  if (process.env.NODE_ENV === "production") return null;
  try {
    const url = new URL(request.url);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}
