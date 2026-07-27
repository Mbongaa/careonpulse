import { NextResponse } from "next/server";

import { enforceLoginRateLimit, loginActorHash } from "@/lib/careon-assistant/runtime.server";
import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { CAREON_PASSWORD_HINT, isStrongCareonPassword } from "@/lib/careon-password";
import { InvalidJsonBodyError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { isCareonDemoMode, isSupabaseAuthConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

// Wachtwoord instellen via een persoonlijk verstrekte herstel-link (variant A,
// geen e-mailinfrastructuur): de beheerder maakt een account zonder wachtwoord
// aan en geeft de link door; de gebruiker kiest hier zijn eigen wachtwoord.
// Volledig server-side (CSP connect-src 'self'): deze route verzilvert het
// token bij GoTrue en zet het wachtwoord met de kortstondige sessie — er
// worden geen sessiecookies gezet, de gebruiker logt daarna gewoon in.

export const runtime = "nodejs";

const MAX_BODY_BYTES = 10_000;
// GoTrue hashed_token: hex-digest, ruim valideren maar nooit vrije tekst.
const TOKEN_PATTERN = /^[a-zA-Z0-9_-]{10,255}$/;

export async function POST(request: Request) {
  if (isCareonDemoMode()) {
    return NextResponse.json({ configured: false, demo: true }, { status: 501 });
  }
  if (!isSupabaseAuthConfigured()) {
    return NextResponse.json({ error: "Authenticatie is niet geconfigureerd." }, { status: 503 });
  }

  // Zelfde brute-force-rem als de login: dit is een onge-authenticeerd
  // credential-endpoint (token raden + wachtwoord zetten). Fail closed.
  const actorHash = loginActorHash(request);
  const limit = await enforceLoginRateLimit(actorHash);
  if (!limit.allowed) {
    scheduleAuditEvent({
      action: "auth.set_password_blocked",
      resource: "auth",
      detail: { reason: limit.source === "unavailable" ? "rate_limit_unavailable" : "rate_limit" },
    });
    const status = limit.source === "unavailable" ? 503 : 429;
    return NextResponse.json(
      { error: status === 429 ? "Te veel pogingen. Probeer het later opnieuw." : "Tijdelijk niet beschikbaar." },
      { status, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: { tokenHash?: unknown; password?: unknown };
  try {
    body = await readJsonBodyLimited<{ tokenHash?: unknown; password?: unknown }>(request, MAX_BODY_BYTES);
  } catch (error) {
    if (!(error instanceof InvalidJsonBodyError)) {
      console.error("Set-password body read failed", error);
    }
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const tokenHash = typeof body.tokenHash === "string" ? body.tokenHash.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!TOKEN_PATTERN.test(tokenHash)) {
    return NextResponse.json({ error: "Deze link is ongeldig of verlopen. Vraag een nieuwe link." }, { status: 400 });
  }
  if (!isStrongCareonPassword(password)) {
    return NextResponse.json({ error: CAREON_PASSWORD_HINT }, { status: 400 });
  }

  // Token verzilveren → kortstondige sessie voor uitsluitend deze route.
  const verifyResponse = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "recovery", token_hash: tokenHash }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!verifyResponse?.ok) {
    return NextResponse.json({ error: "Deze link is ongeldig of verlopen. Vraag een nieuwe link." }, { status: 400 });
  }
  const session = (await verifyResponse.json()) as { access_token?: string; user?: { id?: string } };
  if (!session.access_token) {
    return NextResponse.json({ error: "Deze link is ongeldig of verlopen. Vraag een nieuwe link." }, { status: 400 });
  }

  const updateResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);

  // De tijdelijke sessie is na gebruik waardeloos; best effort intrekken.
  void fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
    signal: AbortSignal.timeout(4_000),
  }).catch(() => undefined);

  if (!updateResponse?.ok) {
    return NextResponse.json({ error: "Wachtwoord instellen mislukte. Probeer het opnieuw." }, { status: 502 });
  }

  scheduleAuditEvent({
    action: "auth.password.set_via_link",
    resource: "auth.users",
    resourceId: session.user?.id,
  });
  return NextResponse.json({ ok: true });
}
