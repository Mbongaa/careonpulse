import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";

import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EVENT_RETENTION_DAYS = Math.min(
  365,
  Math.max(7, Number(process.env.CAREON_ASSISTANT_EVENT_RETENTION_DAYS) || 90),
);
// Chat-retentie (handoff 13): centraal opgeslagen gesprekken verdwijnen na
// deze termijn; moet overeenkomen met de AVG-melding op de assistentpagina.
const CHAT_RETENTION_DAYS = Math.min(365, Math.max(1, Number(process.env.CAREON_ASSISTANT_CHAT_RETENTION_DAYS) || 30));
// Audit-logboek: 12 maanden (besluit 5, handoff 13).
const AUDIT_RETENTION_DAYS = Math.min(1_095, Math.max(30, Number(process.env.CAREON_AUDIT_RETENTION_DAYS) || 365));
// Facturatie (handoff 15 §3.5): uitgereikte facturen vallen BUITEN elke
// opschoning (bewaarplicht 7 jaar); alleen verlaten CONCEPTEN — met
// afnemer-persoonsgegevens in de snapshot — worden opgeruimd.
const FACTURATIE_CONCEPT_RETENTION_DAYS = Math.min(
  1_095,
  Math.max(30, Number(process.env.CAREON_FACTURATIE_CONCEPT_RETENTION_DAYS) || 180),
);

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization");
  if (!secret || !supplied) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return Response.json({ status: "not_configured" }, { status: 503 });
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/careon_prune_runtime_data`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_event_retention_days: EVENT_RETENTION_DAYS,
        p_chat_retention_days: CHAT_RETENTION_DAYS,
        p_audit_retention_days: AUDIT_RETENTION_DAYS,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error("Scheduled Careon maintenance failed", { status: response.status });
      // Ook een mislukte run laat een spoor na: zonder auditrij is een stil
      // gestopte cron (verlopen CRON_SECRET, RPC-fout) in het product
      // onzichtbaar, terwijl de retentiebeloftes eraan hangen.
      scheduleAuditEvent({
        action: "maintenance.prune_failed",
        resource: "careon_prune_runtime_data",
        detail: { status: String(response.status) },
      });
      return Response.json({ status: "failed" }, { status: 502 });
    }
    const result = await response.json();
    // Aparte RPC (0020) — bewust niet in careon_prune_runtime_data gevlochten,
    // zodat de facturatietabellen nooit per ongeluk in de algemene opschoning
    // belanden. Best effort: een fout hier laat de hoofdprune geldig.
    let conceptenOpgeruimd: number | null = null;
    try {
      const conceptResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/careon_prune_facturatie_concepten`, {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_days: FACTURATIE_CONCEPT_RETENTION_DAYS }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (conceptResponse.ok) {
        conceptenOpgeruimd = (await conceptResponse.json()) as number;
      } else {
        console.error("Facturatie concept-prune failed", { status: conceptResponse.status });
      }
    } catch (error) {
      console.error("Facturatie concept-prune unavailable", error);
    }
    // Fase B (handoff 15 §7): maillogregels die in "in_wachtrij" blijven
    // hangen (functie stierf tussen insert en providerantwoord) worden als
    // "mislukt" gemarkeerd zodat de beheerder een zichtbare "Opnieuw
    // versturen"-ingang heeft. Bewust GEEN automatische herverzending: als de
    // provider de mail wél accepteerde vóór de crash, zou een automatische
    // retry dubbel verzenden — een mens beoordeelt dat veiliger.
    let mailwachtrijOpgeruimd: number | null = null;
    try {
      const grens = new Date(Date.now() - 15 * 60_000).toISOString();
      const sweepParams = new URLSearchParams({ status: "eq.in_wachtrij", created_at: `lt.${grens}` });
      const sweepResponse = await fetch(`${SUPABASE_URL}/rest/v1/careon_facturatie_maillog?${sweepParams}`, {
        method: "PATCH",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          status: "mislukt",
          fout_code: "timeout",
          fout_tekst: "Verzending afgebroken (geen providerantwoord geregistreerd) — handmatig opnieuw versturen.",
          updated_at: new Date().toISOString(),
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (sweepResponse.ok) {
        mailwachtrijOpgeruimd = ((await sweepResponse.json()) as unknown[]).length;
      } else {
        console.error("Facturatie maillog-sweep failed", { status: sweepResponse.status });
      }
      // Zelfde sweep voor de in-flight-markering op de factuur zelf: zonder
      // deze reset zou "verzending onderweg" na een crash eeuwig blijven staan.
      const factuurSweepParams = new URLSearchParams({ mail_status: "eq.in_wachtrij", updated_at: `lt.${grens}` });
      const factuurSweep = await fetch(`${SUPABASE_URL}/rest/v1/careon_facturatie_facturen?${factuurSweepParams}`, {
        method: "PATCH",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mail_status: "mislukt", updated_at: new Date().toISOString() }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!factuurSweep.ok) console.error("Facturatie mail_status-sweep failed", { status: factuurSweep.status });
    } catch (error) {
      console.error("Facturatie maillog-sweep unavailable", error);
    }
    scheduleAuditEvent({
      action: "maintenance.prune",
      resource: "careon_prune_runtime_data",
      detail: {
        events: String(EVENT_RETENTION_DAYS),
        chats: String(CHAT_RETENTION_DAYS),
        audit: String(AUDIT_RETENTION_DAYS),
        facturatieConcepten: conceptenOpgeruimd === null ? "failed" : String(conceptenOpgeruimd),
        mailwachtrij: mailwachtrijOpgeruimd === null ? "failed" : String(mailwachtrijOpgeruimd),
      },
    });
    return Response.json(
      { status: "completed", result, timestamp: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Scheduled Careon maintenance unavailable", error);
    scheduleAuditEvent({
      action: "maintenance.prune_failed",
      resource: "careon_prune_runtime_data",
      detail: { status: "unavailable" },
    });
    return Response.json({ status: "failed" }, { status: 502 });
  }
}
