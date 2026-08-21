import { NextResponse } from "next/server";

import { loginActorHash } from "@/lib/careon-assistant/runtime.server";
import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { provisionEntraJitMembership } from "@/lib/careon-entra/jit.server";
import { careonOAuthOrigin, isMicrosoftLoginEnabled } from "@/lib/supabase/oauth.server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

function loginRedirect(origin: string, error: string): NextResponse {
  return NextResponse.redirect(`${origin}/auth/v1/login?error=${encodeURIComponent(error)}`, 303);
}

/** Wisselt de eenmalige PKCE-code om voor de gewone Supabase-cookie-sessie.
    Een bestaand lid gaat direct door. Een nog niet ingericht account kan
    uitsluitend via de dubbel gevalideerde, app-role-gated G01-A JIT-route
    een normaal `member`-lidmaatschap krijgen; zonder complete configuratie of
    geldige providerclaims blijft het bestaande uitlog-/weigerpad actief. */
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
  let orgId = (membership.data?.[0] as { org_id?: string } | undefined)?.org_id ?? null;
  const isPlatformAdmin = Boolean(platformAdmin.data);
  let provisioning: "preprovisioned" | "jit_created" | "jit_existing" = "preprovisioned";
  let jitStatus = "not_attempted";

  if (!orgId && !isPlatformAdmin) {
    const jit = await provisionEntraJitMembership(user);
    jitStatus = jit.status;
    if (jit.status === "created" || jit.status === "existing") {
      orgId = jit.orgId;
      provisioning = jit.status === "created" ? "jit_created" : "jit_existing";
    }
  }

  if (!orgId && !isPlatformAdmin) {
    await supabase.auth.signOut({ scope: "local" });
    scheduleAuditEvent({
      action: "auth.login_failed",
      resource: "auth",
      userId: user.id,
      detail: { reason: "microsoft_no_access_assignment", jit_status: jitStatus, actor },
    });
    return loginRedirect(origin, "microsoft-no-access");
  }

  scheduleAuditEvent({
    action: "auth.login.microsoft",
    resource: "auth",
    orgId,
    userId: user.id,
    detail: { actor, provisioning },
  });
  return NextResponse.redirect(`${origin}${isPlatformAdmin ? "/admin" : "/modules"}`, 303);
}
