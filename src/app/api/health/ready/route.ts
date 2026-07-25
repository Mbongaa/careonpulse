import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function headers(): HeadersInit {
  return {
    apikey: SERVICE_KEY as string,
    Authorization: `Bearer ${SERVICE_KEY}`,
  };
}

export async function GET() {
  const requestId = randomUUID();
  const configured = {
    database: Boolean(SUPABASE_URL && SERVICE_KEY && process.env.NEXT_PUBLIC_CAREON_SYNC_TOKEN),
    assistant:
      process.env.CAREON_ASSISTANT_LIVE === "0" ||
      (Boolean(process.env.OPENAI_API_KEY) && Boolean(process.env.CAREON_ASSISTANT_SAFETY_SALT)),
    maintenance: Boolean(process.env.CRON_SECRET),
  };
  let databaseReachable = false;

  if (configured.database) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/careon_assistant_rate_limits?select=scope&limit=1`, {
        headers: headers(),
        cache: "no-store",
        signal: AbortSignal.timeout(2_500),
      });
      databaseReachable = response.ok;
    } catch {
      databaseReachable = false;
    }
  }

  const ready = Object.values(configured).every(Boolean) && databaseReachable;
  return Response.json(
    {
      status: ready ? "ready" : "not_ready",
      requestId,
      checks: { ...configured, databaseReachable },
      timestamp: new Date().toISOString(),
    },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store", "X-Careon-Request-Id": requestId },
    },
  );
}
