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
      return Response.json({ status: "failed" }, { status: 502 });
    }
    return Response.json(
      { status: "completed", result: await response.json(), timestamp: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Scheduled Careon maintenance unavailable", error);
    return Response.json({ status: "failed" }, { status: 502 });
  }
}
