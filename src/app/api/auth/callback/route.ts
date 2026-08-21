import { NextResponse } from "next/server";

import { loginActorHash } from "@/lib/careon-assistant/runtime.server";
import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { careonOAuthOrigin, isMicrosoftLoginEnabled } from "@/lib/supabase/oauth.server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

function loginRedirect(origin: string, error: string): NextResponse {
  return NextResponse.redirect(`${origin}/auth/v1/login?error=${encodeURIComponent(error)}`, 303);
}

/** Wisselt de eenmalige PKCE-code om voor de gewone Supabase-cookie-sessie.
    Geen JIT-lidmaatschap: een geldig Microsoft-account zonder vooraf
    ingericht org-lidmaatschap wordt meteen weer uitgelogd. */
export async function GET(request: Request) {
  const origin = careonOAuthOrigin(request);
  if (!origin || !isMicrosoftLoginEnabled()) {
    return NextResponse.json({ error: "Authenticatie is niet volledig geconfigureerd." }, { status: 503 });
  }

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const providerError = requestUrl.searchParams.get("error");
  const actor = loginActorHash(request);
  if (!code || providerError) {
    scheduleAuditEvent({
      action: "auth.login_failed",
      resource: "auth",
      detail: { reason: providerError ? "microsoft_provider_error" : "microsoft_code_missing", actor },
    });
    return loginRedirect(origin, "microsoft-cancelled");
  }

  const supabase = await supabaseServer();
  if (!supabase) return loginRedirect(origin, "microsoft-unavailable");
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    console.error("Microsoft login code exchange failed", { code: exchangeError.code });
    scheduleAuditEvent({
      action: "auth.login_failed",
      resource: "auth",
      detail: { reason: "microsoft_code_exchange", actor },
    });
    return loginRedirect(origin, "microsoft-unavailable");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return loginRedirect(origin, "microsoft-unavailable");
  }

  const [membership, platformAdmin] = await Promise.all([
    supabase.from("organization_members").select("org_id").eq("user_id", user.id).order("created_at").limit(1),
    supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  const orgId = (membership.data?.[0] as { org_id?: string } | undefined)?.org_id ?? null;
  const isPlatformAdmin = Boolean(platformAdmin.data);
  if (!orgId && !isPlatformAdmin) {
    await supabase.auth.signOut({ scope: "local" });
    scheduleAuditEvent({
      action: "auth.login_failed",
      resource: "auth",
      userId: user.id,
      detail: { reason: "microsoft_no_access_assignment", actor },
    });
    return loginRedirect(origin, "microsoft-no-access");
  }

  scheduleAuditEvent({
    action: "auth.login.microsoft",
    resource: "auth",
    orgId,
    userId: user.id,
    detail: { actor },
  });
  return NextResponse.redirect(`${origin}${isPlatformAdmin ? "/admin" : "/modules"}`, 303);
}
