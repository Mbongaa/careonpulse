import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import { type CareonSession, requireCareonSession } from "@/lib/supabase/session.server";

// Gedeelde route-fabriek voor de aanvullende-exportopslag (agenda,
// verwijzers, toeslagen, declaraties): zelfde patroon en drempels als
// /api/careon/middelen — sessie-auth (cookie) en PostgREST met het JWT van de
// aanvrager zelf, zodat RLS de org-scheiding afdwingt. 501 zonder
// expliciete demo-modus zodat de client op localStorage terugvalt; ontbrekende
// productieconfiguratie faalt met 503. Append-only jsonb-rijen (nieuwste per
// organisatie wint).

// Aggregaten zijn klein (~300 kB); ruim plafond tegen misbruik van de route.
const MAX_BODY_BYTES = 4_000_000;

async function storageFetch(input: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(input, init);
  } catch (error) {
    console.error("Auxiliary storage request unavailable", error);
    return null;
  }
}

export function createAuxStateHandlers<T>(table: string, isValid: (value: unknown) => value is T, label: string) {
  async function GET() {
    const auth = await requireCareonSession();
    if ("denied" in auth) return auth.denied;
    const session: CareonSession = auth.session;

    const params = new URLSearchParams({
      select: "state",
      org_id: `eq.${session.orgId}`,
      order: "saved_at.desc",
      limit: "1",
    });
    const response = await storageFetch(`${POSTGREST_URL}/${table}?${params}`, {
      headers: userRestHeaders(session),
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
    const auth = await requireCareonSession();
    if ("denied" in auth) return auth.denied;
    const session: CareonSession = auth.session;

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

    const response = await storageFetch(`${POSTGREST_URL}/${table}`, {
      method: "POST",
      headers: userRestHeaders(session),
      body: JSON.stringify({ org_id: session.orgId, state: body.state, operation_id: body.operationId }),
    });
    if (!response?.ok) {
      if (response?.status === 409) {
        const existing = await storageFetch(
          `${POSTGREST_URL}/${table}?select=id&org_id=eq.${session.orgId}&operation_id=eq.${body.operationId}&limit=1`,
          { headers: userRestHeaders(session), cache: "no-store" },
        );
        if (existing?.ok && ((await existing.json()) as unknown[]).length === 1) {
          return NextResponse.json({ configured: true, idempotent: true });
        }
      }
      return NextResponse.json({ error: `${label} kon niet worden opgeslagen.` }, { status: 502 });
    }
    scheduleAuditEvent({
      action: "state.append",
      resource: table,
      orgId: session.orgId,
      userId: session.userId,
    });
    return NextResponse.json({ configured: true });
  }

  return { GET, POST };
}
