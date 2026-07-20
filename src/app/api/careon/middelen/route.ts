import { NextResponse } from "next/server";

import { isMiddelenState, type MiddelenState } from "@/lib/careon-middelen/types";

// Centrale opslag van de handmatige middelen- en inventarisregistratie
// (handoff 09), zelfde patroon en drempels als /api/careon/production:
// PostgREST-fetch met server-side service-role key, sync-token als drempel
// (géén authenticatie — echte auth blijft voorwaarde vóór publieke hosting),
// en 501 zonder geconfigureerde omgeving zodat de client op localStorage
// terugvalt. Elke opslag is een append-only rij: gratis historie ("wie had
// wat vorige maand") en geen verloren data bij een misgelopen schrijfactie.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SYNC_TOKEN = process.env.NEXT_PUBLIC_CAREON_SYNC_TOKEN;

function restHeaders(): HeadersInit {
  return {
    apikey: SERVICE_KEY as string,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
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

export async function GET(request: Request) {
  const denied = guard(request);
  if (denied) return denied;

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/careon_middelen_state?select=state&order=saved_at.desc&limit=1`,
    {
      headers: restHeaders(),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
  const rows = (await response.json()) as { state: unknown }[];
  const state = rows[0] && isMiddelenState(rows[0].state) ? rows[0].state : null;
  return NextResponse.json({ configured: true, state });
}

export async function POST(request: Request) {
  const denied = guard(request);
  if (denied) return denied;

  let body: MiddelenState;
  try {
    body = (await request.json()) as MiddelenState;
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON." }, { status: 400 });
  }
  if (!isMiddelenState(body)) {
    return NextResponse.json({ error: "Ongeldige middelen-state." }, { status: 400 });
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/careon_middelen_state`, {
    method: "POST",
    headers: restHeaders(),
    body: JSON.stringify({ state: body }),
  });
  if (!response.ok) {
    return NextResponse.json({ error: "Middelen-state kon niet worden opgeslagen." }, { status: 502 });
  }
  return NextResponse.json({ configured: true });
}
