import { NextResponse } from "next/server";

import { authenticatedActorHash } from "@/lib/careon-assistant/runtime.server";
import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import {
  downloadUitBucket,
  type FactuurRij,
  factuurVanRij,
  haalFactuurRij,
  serviceFactuurUpdate,
  serviceRestHeaders,
  storageBeschikbaar,
} from "@/lib/careon-facturatie/facturatie.server";
import { bouwFactuurMail, mailBeschikbaar, verstuurFactuurMail } from "@/lib/careon-facturatie/mail.server";
import { type FactuurMaillogRegel, isEmailAdres, type MaillogStatus } from "@/lib/careon-facturatie/types";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

export const runtime = "nodejs";

// Fase B (handoff 15 §7): synchroon verzenden mét maillog per poging.
// Fail-closed: zonder providerconfiguratie (DPA nog niet gesloten) antwoordt
// de route 503 en verandert er niets aan factuur of log.

const VERZENDBAAR = new Set(["definitief", "verzonden", "betaald"]);
const MAIL_LIMIT_PER_MINUTE = Math.min(60, Math.max(1, Number(process.env.CAREON_MAIL_RATE_LIMIT_PER_MINUTE) || 5));
const MAIL_LIMIT_PER_DAY = Math.min(2_000, Math.max(1, Number(process.env.CAREON_MAIL_RATE_LIMIT_PER_DAY) || 100));

interface MaillogRij {
  id: string;
  factuur_id: string;
  ontvanger: string;
  onderwerp: string;
  status: MaillogStatus;
  fout_tekst: string | null;
  poging: number;
  created_at: string;
}

const MAILLOG_SELECT = "id,factuur_id,ontvanger,onderwerp,status,fout_tekst,poging,created_at";

function maillogVanRij(rij: MaillogRij): FactuurMaillogRegel {
  return {
    id: rij.id,
    factuurId: rij.factuur_id,
    ontvanger: rij.ontvanger,
    onderwerp: rij.onderwerp,
    status: rij.status,
    foutTekst: rij.fout_tekst ?? undefined,
    poging: rij.poging,
    createdAt: rij.created_at,
  };
}

/** Quota-scope 'mail' (0021): degradeert open bij RPC-storing — de verzending
    zelf vergt toch al een bereikbare database, dus een stille extra rem
    zonder storing bestaat niet. */
async function consumeMailQuota(userId: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  try {
    const response = await fetch(`${POSTGREST_URL}/rpc/careon_consume_assistant_quota`, {
      method: "POST",
      headers: serviceRestHeaders(),
      body: JSON.stringify({
        p_scope: "mail",
        p_actor_hash: authenticatedActorHash(userId),
        p_minute_limit: MAIL_LIMIT_PER_MINUTE,
        p_day_limit: MAIL_LIMIT_PER_DAY,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) {
      console.error("Facturatie: mail-quota-RPC faalde", response.status);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const body = (await response.json()) as { allowed?: boolean; retry_after_seconds?: number };
    return { allowed: body.allowed !== false, retryAfterSeconds: body.retry_after_seconds ?? 0 };
  } catch (error) {
    console.error("Facturatie: mail-quota-RPC onbereikbaar", error);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

async function serviceMaillogInsert(rij: Record<string, unknown>): Promise<MaillogRij | null> {
  const response = await fetch(`${POSTGREST_URL}/careon_facturatie_maillog?select=${MAILLOG_SELECT}`, {
    method: "POST",
    headers: serviceRestHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(rij),
  });
  if (!response.ok) return null;
  const rows = (await response.json()) as MaillogRij[];
  return rows[0] ?? null;
}

async function serviceMaillogUpdate(orgId: string, logId: string, patch: Record<string, unknown>): Promise<void> {
  const params = new URLSearchParams({ org_id: `eq.${orgId}`, id: `eq.${logId}` });
  const response = await fetch(`${POSTGREST_URL}/careon_facturatie_maillog?${params}`, {
    method: "PATCH",
    headers: serviceRestHeaders(),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) console.error("Facturatie: maillog-update faalde", response.status);
}

/** Verzendhistorie van één factuur (caller-JWT — de select-policy dekt dit). */
export async function GET(_request: Request, context: { params: Promise<{ factuurId: string }> }) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;
  const { factuurId } = await context.params;
  try {
    const params = new URLSearchParams({
      select: MAILLOG_SELECT,
      org_id: `eq.${session.orgId}`,
      factuur_id: `eq.${factuurId}`,
      order: "created_at.desc",
      limit: "20",
    });
    const response = await fetch(`${POSTGREST_URL}/careon_facturatie_maillog?${params}`, {
      headers: userRestHeaders(session),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("storage-unavailable");
    const rows = (await response.json()) as MaillogRij[];
    return NextResponse.json({ configured: true, maillog: rows.map(maillogVanRij) });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ factuurId: string }> }) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;
  const { factuurId } = await context.params;

  if (!storageBeschikbaar()) {
    return NextResponse.json({ error: "Authenticatie is niet geconfigureerd." }, { status: 503 });
  }
  // Fail-closed tot de DPA rond is en de sleutels in Vercel staan (§7/D19).
  if (!mailBeschikbaar()) {
    return NextResponse.json(
      { error: "E-mailverzending is nog niet geconfigureerd voor dit platform." },
      { status: 503 },
    );
  }

  let body: unknown = {};
  try {
    body = await readJsonBodyLimited<unknown>(request, 2_000);
  } catch (error) {
    if (error instanceof RequestPayloadTooLargeError) {
      return NextResponse.json({ error: "Payload te groot." }, { status: 413 });
    }
    if (!(error instanceof InvalidJsonBodyError)) console.error("Facturatie mail body read failed", error);
    // Lege body is toegestaan: de ontvanger valt dan op het afnemer-adres.
  }
  const gewensteOntvanger =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).ontvanger === "string"
      ? ((body as Record<string, unknown>).ontvanger as string).trim()
      : null;

  try {
    const rij = await haalFactuurRij(session, factuurId);
    if (!rij) {
      return NextResponse.json({ error: "Deze factuur bestaat niet (meer) voor deze organisatie." }, { status: 404 });
    }
    if (!VERZENDBAAR.has(rij.status) || !rij.nummer) {
      return NextResponse.json(
        { error: "Alleen uitgereikte facturen kunnen per e-mail worden verzonden." },
        {
          status: 409,
        },
      );
    }
    const factuur = factuurVanRij(rij);
    // Lege of ontbrekende invoer valt terug op het afnemer-adres uit de snapshot.
    const ontvanger =
      (gewensteOntvanger !== null && gewensteOntvanger.length > 0 ? gewensteOntvanger : factuur.afnemer?.email) ?? "";
    if (!isEmailAdres(ontvanger)) {
      return NextResponse.json({ error: "Geen geldig e-mailadres voor de ontvanger." }, { status: 400 });
    }
    if (!rij.pdf_pad) {
      return NextResponse.json({ error: "Pdf ontbreekt — genereer opnieuw." }, { status: 409 });
    }

    // Quota vóór de dure stappen (Storage-download + provider-call).
    const quota = await consumeMailQuota(session.userId as string);
    if (!quota.allowed) {
      return NextResponse.json(
        { error: "Verzendlimiet bereikt — probeer het later opnieuw." },
        { status: 429, headers: { "Retry-After": String(quota.retryAfterSeconds || 60) } },
      );
    }

    const pdfBytes = await downloadUitBucket(rij.pdf_pad);
    if (!pdfBytes) {
      return NextResponse.json({ error: "Pdf ontbreekt — genereer opnieuw." }, { status: 409 });
    }

    const inhoud = bouwFactuurMail(factuur);

    // Pogingnummer: bestaande logregels voor deze factuur + 1 (service-role).
    const telParams = new URLSearchParams({
      org_id: `eq.${session.orgId}`,
      factuur_id: `eq.${factuurId}`,
      select: "id",
    });
    const telResponse = await fetch(`${POSTGREST_URL}/careon_facturatie_maillog?${telParams}`, {
      headers: serviceRestHeaders({ Prefer: "count=exact" }),
      method: "HEAD",
      cache: "no-store",
    });
    const totaalEerder = Number.parseInt(telResponse.headers.get("content-range")?.split("/")[1] ?? "0", 10);
    const poging = (Number.isFinite(totaalEerder) ? totaalEerder : 0) + 1;

    const orgId = session.orgId as string;
    const log = await serviceMaillogInsert({
      org_id: session.orgId,
      factuur_id: factuurId,
      ontvanger,
      onderwerp: inhoud.onderwerp,
      status: "in_wachtrij",
      poging,
      verzonden_door: session.userId,
    });
    if (!log) throw new Error("storage-unavailable");
    // In-flight-markering op de factuur zelf: sterft de functie tussen dit
    // punt en het providerantwoord, dan blijft er een zíchtbaar signaal in de
    // UI achter ("verzending onderweg of afgebroken") — de maintenance-cron
    // zet beide daarna op "mislukt".
    await serviceFactuurUpdate(orgId, factuurId, { mail_status: "in_wachtrij" });

    const resultaat = await verstuurFactuurMail({
      ontvanger,
      inhoud,
      pdfBytes,
      pdfNaam: `${rij.nummer}.pdf`,
      replyTo: factuur.afzender?.email,
    });

    // Audit ONMIDDELLIJK na het providerantwoord en onafhankelijk van de
    // administratie hieronder: een werkelijk verzonden e-mail met
    // persoonsgegevens mag nooit zonder auditregel blijven doordat een
    // latere DB-write faalde. Zonder e-mailadres (AVG) — dat staat alleen
    // in het maillog, onder RLS en de 7-jaarsadministratie.
    scheduleAuditEvent({
      action: "facturatie.factuur.send",
      resource: "careon_facturatie_facturen",
      resourceId: factuurId,
      orgId: session.orgId,
      userId: session.userId,
      detail: { nummer: rij.nummer, poging, uitkomst: resultaat.ok ? "verzonden" : "mislukt" },
    });

    // Administratie ná een GESLAAGDE verzending in een eigen try/catch: de
    // mail ís de deur uit, dus een falende boekhoud-write mag nooit als
    // "Supabase niet bereikbaar" terugkomen — dat leest als "niets verzonden"
    // en lokt precies de dubbele verzending uit die we willen voorkomen.
    let versRij: FactuurRij | null = null;
    if (resultaat.ok) {
      try {
        await serviceMaillogUpdate(orgId, log.id, { status: "verzonden", provider_id: resultaat.providerId ?? null });
        versRij = await serviceFactuurUpdate(orgId, factuurId, {
          mail_status: "verzonden",
          mail_verzonden_op: new Date().toISOString(),
          // Verzenden per e-mail ís de verzending: een definitieve factuur
          // schuift door naar "verzonden" (administratief veld, §2.4).
          ...(rij.status === "definitief" ? { status: "verzonden" } : {}),
        });
      } catch (error) {
        console.error("Facturatie: administratie na geslaagde verzending faalde", error);
        return NextResponse.json({
          configured: true,
          factuur: null,
          ontvanger,
          melding:
            "De e-mail is verzonden, maar de administratie kon niet direct worden bijgewerkt. " +
            "Verstuur niet opnieuw; ververs de pagina om de actuele status te zien.",
        });
      }
    } else {
      await serviceMaillogUpdate(orgId, log.id, {
        status: "mislukt",
        fout_code: resultaat.foutCode ?? null,
        fout_tekst: resultaat.foutTekst ?? null,
      });
      versRij = await serviceFactuurUpdate(orgId, factuurId, { mail_status: "mislukt" });
      return NextResponse.json(
        {
          error: "De e-mail kon niet worden verzonden. Probeer het opnieuw.",
          factuur: versRij ? factuurVanRij(versRij) : undefined,
        },
        { status: 502 },
      );
    }

    const definitieveRij = versRij ?? (await haalFactuurRij(session, factuurId));
    return NextResponse.json({
      configured: true,
      factuur: definitieveRij ? factuurVanRij(definitieveRij) : null,
      ontvanger,
    });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}
