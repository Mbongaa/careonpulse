import { type NextRequest, NextResponse } from "next/server";

import type { CookieOptions } from "@supabase/ssr";
import { createServerClient } from "@supabase/ssr";

import { CAREON_KPI_DETAIL_ID_SET } from "@/lib/careon-kpi-route";
import { isCareonDemoMode, isSupabaseAuthConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

// Bewust hier gedefinieerd: careon-auth.ts trekt client-only modules mee.
const LOGIN_ROUTE = "/auth/v1/login";
const HOME_ROUTE = "/dashboard/directiecockpit";

export async function proxy(request: NextRequest) {
  // ── Authenticatie (alleen in Supabase-modus; Playwright draait zonder) ────
  // Valideert én ververst de sessie-cookies; niet-ingelogde bezoekers gaan
  // naar de login, ingelogde bezoekers verlaten de loginpagina. API-routes
  // bewaken zichzelf (requireCareonSession) en vallen buiten de matcher.
  const pendingCookies: { name: string; value: string; options?: CookieOptions }[] = [];
  const path = request.nextUrl.pathname;
  const needsAuth = path.startsWith("/dashboard") || path.startsWith("/admin");
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
      data: { user },
    } = await supabase.auth.getUser();

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
    if (user && path.startsWith("/auth/")) {
      const [membership, platformAdmin] = await Promise.all([
        supabase.from("organization_members").select("org_id").limit(1),
        supabase.from("platform_admins").select("user_id").maybeSingle(),
      ]);
      if ((membership.data?.length ?? 0) > 0 || platformAdmin.data) return redirectTo(HOME_ROUTE);
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
    "frame-src 'none'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
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
