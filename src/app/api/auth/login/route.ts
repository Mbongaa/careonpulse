import { NextResponse } from "next/server";

import { authenticatedActorHash, enforceLoginRateLimit, loginActorHash } from "@/lib/careon-assistant/runtime.server";
import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { CAREON_HOSTED_DEMO_EMAIL_DOMAIN, isCareonHostedDemoEmail } from "@/lib/careon-demo-account";
import { normalizeCareonPassword } from "@/lib/careon-password";
import { InvalidJsonBodyError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { isCareonDemoMode, isSupabaseAuthConfigured, SUPABASE_URL } from "@/lib/supabase/config";
import { supabaseServer } from "@/lib/supabase/server";

// Server-side login: de browser praat nooit rechtstreeks met Supabase (de
// strikte CSP met connect-src 'self' blijft zo intact); deze route zet de
// sessie-cookies. Alleen CAREON_DEMO_MODE=1 antwoordt 501 + demo:true;
// ontbrekende productieconfiguratie faalt gesloten met 503.
//
// Gebruikersnaam → e-mail: invoer met "@" is een e-mailadres; kale namen
// (zoals de demo-login "user1") krijgen het demodomein erachter.

const MAX_BODY_BYTES = 10_000;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ACCOUNT_QUOTA_TIMEOUT_MS = 6_000;
// Tweede rem, per doelaccount in plaats van per bron-IP. De IP-rem stopt één
// aanvaller; een gespreide aanval op één bekend account (botnet, wisselende
// mobiele IP's) passeert die volledig. Bewust ruim gekozen: een harde
// accountvergrendeling is zélf een DoS — wie het adres van een beheerder kent,
// zou die anders een dag kunnen buitensluiten. De minuutdrempel remt raden af
// tot een tempo waarop online brute force tegen het wachtwoordbeleid zinloos
// is; de dagdrempel is enkel een runaway-plafond en ligt zo hoog dat een echte
// gebruiker hem nooit haalt.
const ACCOUNT_RATE_LIMIT_PER_MINUTE = 8;
const ACCOUNT_RATE_LIMIT_PER_DAY = 10_000;

function toEmail(username: string): string {
  const trimmed = username.trim();
  return trimmed.includes("@") ? trimmed : `${trimmed.toLowerCase()}@${CAREON_HOSTED_DEMO_EMAIL_DOMAIN}`;
}

/**
 * Gezouten, onomkeerbare sleutel voor het doelaccount. Hergebruikt bewust de
 * bestaande hash-helper (zelfde server-salt, zelfde 32-hex-vorm die de
 * quota-RPC eist); het extra voorvoegsel houdt deze emmer gescheiden van de
 * gebruikers- en IP-emmers. Het adres zelf verlaat deze functie nooit.
 */
function loginAccountHash(email: string): string {
  return authenticatedActorHash(`login-account:${email.trim().toLowerCase()}`);
}

/**
 * Per-account-quota via dezelfde atomische RPC als de IP-rem, maar met een
 * eigen scope en eigen drempels (migratie 0016).
 *
 * Degradeert bewust ópen: de IP-rem hierboven faalt al gesloten, dus een
 * onbereikbare quota-opslag levert nooit een login op die anders geblokkeerd
 * was. Open falen is alleen bereikbaar wanneer de opslag wél antwoordt maar
 * juist deze scope faalt — precies het venster waarin migratie 0016 nog niet
 * is toegepast. Gesloten falen zou dan élke login blokkeren.
 */
async function enforceAccountLoginRateLimit(accountHash: string): Promise<{
  allowed: boolean;
  retryAfterSeconds: number;
}> {
  if (!SUPABASE_URL || !SERVICE_KEY) return { allowed: true, retryAfterSeconds: 0 };
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/careon_consume_assistant_quota`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_scope: "login_account",
        p_actor_hash: accountHash,
        p_minute_limit: ACCOUNT_RATE_LIMIT_PER_MINUTE,
        p_day_limit: ACCOUNT_RATE_LIMIT_PER_DAY,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(ACCOUNT_QUOTA_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("Account login quota RPC failed", { status: response.status });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const row = (await response.json()) as { allowed?: boolean; retry_after_seconds?: number };
    if (typeof row.allowed !== "boolean") return { allowed: true, retryAfterSeconds: 0 };
    return {
      allowed: row.allowed,
      retryAfterSeconds: Math.max(1, Math.min(3_600, Number(row.retry_after_seconds) || 60)),
    };
  } catch (error) {
    console.error("Account login quota RPC unavailable", error);
    return { allowed: true, retryAfterSeconds: 0 };
  }
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
    // De actor-hash hoort in de rij: zonder identiteit is een reeks blokkades
    // niet te onderscheiden van ruis, en is opsporing na een incident onmogelijk.
    scheduleAuditEvent({
      action: "auth.login_blocked",
      resource: "auth",
      detail: {
        reason: limit.source === "unavailable" ? "rate_limit_unavailable" : "rate_limit",
        scope: "ip",
        actor: actorHash,
      },
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
  const accountHash = loginAccountHash(email);
  // Het vaste demoaccount blijft buiten de accountrem: dat ene adres wordt door
  // alle demobezoekers tegelijk gebruikt, dus een gedeelde emmer zou hen elkaar
  // laten buitensluiten. Er valt bij dat account ook niets te raden — het
  // wachtwoord is publiek. De IP-rem geldt er onverkort.
  const accountLimit = isCareonHostedDemoEmail(email)
    ? { allowed: true, retryAfterSeconds: 0 }
    : await enforceAccountLoginRateLimit(accountHash);
  if (!accountLimit.allowed) {
    scheduleAuditEvent({
      action: "auth.login_blocked",
      resource: "auth",
      detail: { reason: "rate_limit", scope: "account", actor: actorHash, account: accountHash },
    });
    return NextResponse.json(
      { error: "Te veel inlogpogingen. Probeer het later opnieuw." },
      { status: 429, headers: { "Retry-After": String(accountLimit.retryAfterSeconds) } },
    );
  }
  let { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: body.password,
  });
  // Vergevingsgezind voor rand-spaties (kopieerfout, mobiel toetsenbord):
  // eerst exact proberen (bestaande wachtwoorden mét rand-spatie blijven
  // werken), daarna dezelfde poging getrimd. Eén gebruikersactie, één
  // rate-limit-consumptie; spaties bínnen het wachtwoord blijven exact.
  if (error) {
    const trimmed = normalizeCareonPassword(body.password);
    if (trimmed !== body.password && trimmed !== "") {
      ({ data, error } = await supabase.auth.signInWithPassword({ email, password: trimmed }));
    }
  }
  if (error) {
    // Supabase Auth kent eigen brute-force-limieten; de foutmelding blijft
    // bewust generiek (geen onderscheid bestaat-niet/verkeerd-wachtwoord).
    // In de audit staan alleen de twee gezouten hashes — nooit het adres,
    // nooit het wachtwoord — zodat "één IP op één account" achteraf te zien is.
    scheduleAuditEvent({
      action: "auth.login_failed",
      resource: "auth",
      detail: { reason: "invalid_credentials", actor: actorHash, account: accountHash },
    });
    return NextResponse.json({ error: "Onjuiste combinatie" }, { status: 401 });
  }

  // Zelfde volgorde als getCareonSession(): de organisatie in de auditrij is
  // dan gegarandeerd dezelfde die de sessie verderop hanteert.
  const [membership, platformAdmin] = await Promise.all([
    supabase.from("organization_members").select("org_id").order("created_at").limit(1),
    supabase.from("platform_admins").select("user_id").maybeSingle(),
  ]);
  if ((membership.data?.length ?? 0) === 0 && !platformAdmin.data) {
    await supabase.auth.signOut({ scope: "local" });
    // Bewust zonder org_id: het ontbreken van elk lidmaatschap ís hier de
    // weigeringsgrond, dus er valt geen organisatie aan te hangen.
    scheduleAuditEvent({
      action: "auth.login_failed",
      resource: "auth",
      userId: data.user?.id ?? null,
      detail: { reason: "no_access_assignment", actor: actorHash, account: accountHash },
    });
    return NextResponse.json({ error: "Geen organisatie gekoppeld aan dit account." }, { status: 403 });
  }

  // Zonder org_id valt elke inlogrij buiten het organisatiefilter van
  // /admin/activiteit — precies het filter dat een beheerder gebruikt om een
  // incident bij één klant te reconstrueren. Een platformbeheerder zonder
  // lidmaatschap houdt null; die hoort bij geen enkele organisatie.
  const orgId = (membership.data?.[0] as { org_id?: string } | undefined)?.org_id ?? null;
  scheduleAuditEvent({
    action: "auth.login",
    resource: "auth",
    orgId,
    userId: data.user?.id ?? null,
    detail: { actor: actorHash },
  });
  return NextResponse.json({ ok: true });
}
