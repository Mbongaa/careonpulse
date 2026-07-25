import { NextResponse } from "next/server";

import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";

// Gedeelde route-fabriek voor de aanvullende-exportopslag (agenda,
// verwijzers): zelfde patroon en drempels als /api/careon/middelen —
// PostgREST-fetch met server-side service-role key, sync-token als drempel
// (géén authenticatie), 501 zonder configuratie zodat de client op
// localStorage terugvalt, en append-only jsonb-rijen (nieuwste wint).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SYNC_TOKEN = process.env.NEXT_PUBLIC_CAREON_SYNC_TOKEN;

// Aggregaten zijn klein (~300 kB); ruim plafond tegen misbruik van de route.
const MAX_BODY_BYTES = 4_000_000;

function restHeaders(): HeadersInit {
  return {
    apikey: SERVICE_KEY as string,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function storageFetch(input: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(input, init);
  } catch (error) {
    console.error("Auxiliary storage request unavailable", error);
    return null;
  }
}

function guard(request: Request): NextResponse | null {
  if (!SUPABASE_URL || !SERVICE_KEY || !SYNC_TOKEN) {
    return NextResponse.json({ configured: false }, { status: 501 });
  }
  if (request.headers.get("x-careon-sync") !== SYNC_TOKEN) {
    return NextResponse.json({ error: "Niet geautoriseerd." }, { status: 401 });
  }
  return null;
}

export function createAuxStateHandlers<T>(table: string, isValid: (value: unknown) => value is T, label: string) {
  async function GET(request: Request) {
    const denied = guard(request);
    if (denied) return denied;

    const response = await storageFetch(`${SUPABASE_URL}/rest/v1/${table}?select=state&order=saved_at.desc&limit=1`, {
      headers: restHeaders(),
      cache: "no-store",
    });
    if (!response?.ok) {
      return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
    }
    const rows = (await response.json()) as { state: unknown }[];
    const state = rows[0] && isValid(rows[0].state) ? rows[0].state : null;
    return NextResponse.json({ configured: true, state });
  }

  async function POST(request: Request) {
    const denied = guard(request);
    if (denied) return denied;

    let body: { state?: unknown; operationId?: unknown };
    try {
      body = await readJsonBodyLimited<{ state?: unknown; operationId?: unknown }>(request, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof RequestPayloadTooLargeError) {
        return NextResponse.json({ error: `${label} is te groot voor centrale opslag.` }, { status: 413 });
      }
      if (!(error instanceof InvalidJsonBodyError)) {
        console.error(`Auxiliary ${label} body read failed`, error);
      }
      return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
    }
    if (
      typeof body.operationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.operationId) ||
      !isValid(body.state)
    ) {
      return NextResponse.json({ error: `Ongeldige ${label}.` }, { status: 400 });
    }

    const response = await storageFetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: restHeaders(),
      body: JSON.stringify({ state: body.state, operation_id: body.operationId }),
    });
    if (!response?.ok) {
      if (response?.status === 409) {
        const existing = await storageFetch(
          `${SUPABASE_URL}/rest/v1/${table}?select=id&operation_id=eq.${body.operationId}&limit=1`,
          { headers: restHeaders(), cache: "no-store" },
        );
        if (existing?.ok && ((await existing.json()) as unknown[]).length === 1) {
          return NextResponse.json({ configured: true, idempotent: true });
        }
      }
      return NextResponse.json({ error: `${label} kon niet worden opgeslagen.` }, { status: 502 });
    }
    return NextResponse.json({ configured: true });
  }

  return { GET, POST };
}
