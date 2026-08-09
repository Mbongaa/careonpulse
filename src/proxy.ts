import { type NextRequest, NextResponse } from "next/server";

import type { CookieOptions } from "@supabase/ssr";
import { createServerClient } from "@supabase/ssr";

import { magFinancieelZien } from "@/lib/careon-financieel-rol";
import { CAREON_FINANCIELE_KPI_DETAIL_ID_SET, CAREON_KPI_DETAIL_ID_SET } from "@/lib/careon-kpi-route";
import { isCareonDemoMode, isSupabaseAuthConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

// Bewust hier gedefinieerd: careon-auth.ts trekt client-only modules mee.
const LOGIN_ROUTE = "/auth/v1/login";
const HOME_ROUTE = "/modules";
const ADMIN_ROUTE = "/admin";

/**
 * Letterlijke kopie van `isGeblokkeerd` uit src/lib/supabase/session.server.ts:
 * die module importeren zou hier de op next/headers gebouwde serverclient en
 * next/navigation meetrekken, wat in de proxy niet draait. Beide plekken moeten
 * dezelfde uitkomst geven — pas ze samen aan. De waarde komt uit het
 * getUser()-antwoord dat hieronder toch al wordt opgehaald, dus dit kost geen
 * extra database-aanroep per verzoek. Onleesbaar telt als geblokkeerd (fail
 * closed).
 */
function isGeblokkeerd(bannedUntil: string | null | undefined): boolean {
  if (!bannedUntil) return false;
  const tijdstip = Date.parse(bannedUntil);
  return Number.isNaN(tijdstip) || tijdstip > Date.now();
}

export async function proxy(request: NextRequest) {
  // ── Authenticatie (alleen in Supabase-modus; Playwright draait zonder) ────
  // Valideert én ververst de sessie-cookies; niet-ingelogde bezoekers gaan
  // naar de login, ingelogde bezoekers verlaten de loginpagina. API-routes
  // bewaken zichzelf (requireCareonSession) en vallen buiten de matcher.
  const pendingCookies: { name: string; value: string; options?: CookieOptions }[] = [];
  const path = request.nextUrl.pathname;
  // /oauth = het toestemmingsscherm van de OAuth 2.1-server (blueprint §4);
  // zonder sessie eerst inloggen, daarna herstart de module de flow zelf.
  const needsAuth =
    path.startsWith("/dashboard") ||
    path.startsWith("/admin") ||
    path.startsWith("/modules") ||
    path.startsWith("/oauth");
  if (!isCareonDemoMode() && !isSupabaseAuthConfigured() && needsAuth) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_ROUTE;
    url.search = "?error=configuration";
    return NextResponse.redirect(url);
  }
  if (!isCareonDemoMode() && isSupabaseAuthConfigured()) {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const cookie of cookiesToSet) {
            request.cookies.set(cookie.name, cookie.value);
          }
          // httpOnly afgedwongen: geen browserclient leest de sessiecookies.
          pendingCookies.push(
            ...cookiesToSet.map((cookie) => ({
              ...cookie,
              options: {
                ...cookie.options,
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax" as const,
                path: cookie.options?.path ?? "/",
              },
            })),
          );
        },
      },
    });
    const {
      data: { user: ingelogdeGebruiker },
    } = await supabase.auth.getUser();
    // Een geblokkeerd account telt hier als niet-ingelogd, net als in de
    // sessielaag: anders rendert de shell van /dashboard nog volledig en moet
    // de clientguard hem alsnog wegsturen. Als "niet-ingelogd" mag het account
    // ook de loginpagina weer bereiken (geen redirectlus).
    const user = ingelogdeGebruiker && !isGeblokkeerd(ingelogdeGebruiker.banned_until) ? ingelogdeGebruiker : null;

    const redirectTo = (pathname: string): NextResponse => {
      const url = request.nextUrl.clone();
      url.pathname = pathname;
      url.search = "";
      const redirect = NextResponse.redirect(url);
      for (const cookie of pendingCookies) {
        redirect.cookies.set(cookie.name, cookie.value, cookie.options);
      }
      return redirect;
    };
    if (!user && needsAuth) return redirectTo(LOGIN_ROUTE);
    // Financiële KPI-detailpagina's zijn statisch geprerenderd (een paginapoort
    // zou alle drill-downs dynamisch maken), dus de rolregel wordt hier
    // afgedwongen. De rol-leesquery draait uitsluitend op deze paden; zonder
    // bewezen recht (bijv. een DB-hapering) geldt gesloten-falen — financiële
    // vertrouwelijkheid weegt zwaarder dan een zeldzame omweg voor een admin.
    const financieelDetail = path.match(/^\/dashboard\/details\/([^/]+)\/?$/);
    if (user && financieelDetail && CAREON_FINANCIELE_KPI_DETAIL_ID_SET.has(financieelDetail[1])) {
      const [membership, platformAdmin] = await Promise.all([
        supabase.from("organization_members").select("role").order("created_at").limit(1),
        supabase.from("platform_admins").select("user_id").maybeSingle(),
      ]);
      const rol = (membership.data?.[0] as { role?: "org_admin" | "member" } | undefined)?.role ?? null;
      const toegestaan = magFinancieelZien({
        orgRole: rol,
        isSuperadmin: Boolean(platformAdmin.data),
        email: user.email,
      });
      if (!toegestaan) return redirectTo("/dashboard/directiecockpit");
    }
    if (user && path.startsWith("/auth/")) {
      const [membership, platformAdmin] = await Promise.all([
        supabase.from("organization_members").select("org_id").limit(1),
        supabase.from("platform_admins").select("user_id").maybeSingle(),
      ]);
      // Platformbeheerders horen op het superadmin-dashboard, niet op de
      // module-launcher van een organisatie.
      if (platformAdmin.data) return redirectTo(ADMIN_ROUTE);
      if ((membership.data?.length ?? 0) > 0) return redirectTo(HOME_ROUTE);
    }
  }

  // ── CSP + KPI-detailvalidatie (bestaand gedrag) ───────────────────────────
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const isDevelopment = process.env.NODE_ENV === "development";
  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Facturatie (handoff 15 §5.3): het live pdf-voorbeeld is een same-origin
    // blob die door onze eigen code is gegenereerd. 'self' + blob: laat geen
    // enkele externe herkomst toe; frame-ancestors en object-src blijven dicht.
    "frame-src 'self' blob:",
    "object-src 'none'",
    // 'wasm-unsafe-eval': de pdf-layoutengine van het facturatievoorbeeld
    // (yoga-layout in @react-pdf) is WebAssembly; deze bron staat uitsluitend
    // WASM-instantiatie toe — JavaScript-eval blijft verboden.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    // Recharts and several shadcn primitives intentionally use React style
    // props, which are governed by style-src-attr and cannot carry a nonce.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const detailMatch = request.nextUrl.pathname.match(/^\/dashboard\/details\/([^/]+)\/?$/);
  const invalidDetail = detailMatch && !CAREON_KPI_DETAIL_ID_SET.has(detailMatch[1]);
  const response = invalidDetail
    ? NextResponse.rewrite(new URL("/dashboard/__kpi-not-found", request.url), {
        status: 404,
        request: { headers: requestHeaders },
      })
    : NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  for (const cookie of pendingCookies) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sw.js|icons|manifest.webmanifest).*)"],
};
