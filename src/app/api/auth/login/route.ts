import { NextResponse } from "next/server";

import { enforceLoginRateLimit, loginActorHash } from "@/lib/careon-assistant/runtime.server";
import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { CAREON_HOSTED_DEMO_EMAIL_DOMAIN } from "@/lib/careon-demo-account";
import { InvalidJsonBodyError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { isCareonDemoMode, isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { supabaseServer } from "@/lib/supabase/server";

// Server-side login: de browser praat nooit rechtstreeks met Supabase (de
// strikte CSP met connect-src 'self' blijft zo intact); deze route zet de
// sessie-cookies. Alleen CAREON_DEMO_MODE=1 antwoordt 501 + demo:true;
// ontbrekende productieconfiguratie faalt gesloten met 503.
//
// Gebruikersnaam → e-mail: invoer met "@" is een e-mailadres; kale namen
// (zoals de demo-login "user1") krijgen het demodomein erachter.

const MAX_BODY_BYTES = 10_000;

function toEmail(username: string): string {
  const trimmed = username.trim();
  return trimmed.includes("@") ? trimmed : `${trimmed.toLowerCase()}@${CAREON_HOSTED_DEMO_EMAIL_DOMAIN}`;
}

export async function POST(request: Request) {
  if (isCareonDemoMode()) {
    return NextResponse.json({ configured: false, demo: true }, { status: 501 });
  }
  if (!isSupabaseAuthConfigured()) {
    return NextResponse.json({ error: "Authenticatie is niet geconfigureerd." }, { status: 503 });
  }

  // Brute-force-rem per gehasht bezoekers-IP (migratie 0013): alle logins
  // bereiken Supabase vanaf het server-IP, dus diens IP-limieten helpen hier
  // niet. Fail closed wanneer de limietopslag onbereikbaar is.
  const actorHash = loginActorHash(request);
  const limit = await enforceLoginRateLimit(actorHash);
  if (!limit.allowed) {
    scheduleAuditEvent({
      action: "auth.login_blocked",
      resource: "auth",
      detail: { reason: limit.source === "unavailable" ? "rate_limit_unavailable" : "rate_limit" },
    });
    if (limit.source === "unavailable") {
      return NextResponse.json(
        { error: "Inloggen is tijdelijk niet beschikbaar." },
        { status: 503, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }
    return NextResponse.json(
      { error: "Te veel inlogpogingen. Probeer het later opnieuw." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = await readJsonBodyLimited<{ username?: unknown; password?: unknown }>(request, MAX_BODY_BYTES);
  } catch (error) {
    if (!(error instanceof InvalidJsonBodyError)) {
      console.error("Login body read failed", error);
    }
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }
  if (
    typeof body.username !== "string" ||
    typeof body.password !== "string" ||
    body.username.trim() === "" ||
    body.password === ""
  ) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const supabase = await supabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Authenticatie is niet geconfigureerd." }, { status: 503 });
  }
  const email = toEmail(body.username);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: body.password,
  });
  if (error) {
    // Supabase Auth kent eigen brute-force-limieten; de foutmelding blijft
    // bewust generiek (geen onderscheid bestaat-niet/verkeerd-wachtwoord).
    scheduleAuditEvent({ action: "auth.login_failed", resource: "auth" });
    return NextResponse.json({ error: "Onjuiste combinatie" }, { status: 401 });
  }

  const [membership, platformAdmin] = await Promise.all([
    supabase.from("organization_members").select("org_id").limit(1),
    supabase.from("platform_admins").select("user_id").maybeSingle(),
  ]);
  if ((membership.data?.length ?? 0) === 0 && !platformAdmin.data) {
    await supabase.auth.signOut({ scope: "local" });
    scheduleAuditEvent({
      action: "auth.login_failed",
      resource: "auth",
      userId: data.user?.id ?? null,
      detail: { reason: "no_access_assignment" },
    });
    return NextResponse.json({ error: "Geen organisatie gekoppeld aan dit account." }, { status: 403 });
  }

  scheduleAuditEvent({ action: "auth.login", resource: "auth", userId: data.user?.id ?? null });
  return NextResponse.json({ ok: true });
}
