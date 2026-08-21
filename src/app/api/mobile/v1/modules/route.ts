import { NextResponse } from "next/server";

import { CAREON_MODULES } from "@/data/careon/careon-modules";
import { buildCareonShellRegistry } from "@/lib/careon-mobile/module-registry";
import { getCareonShellSession } from "@/lib/supabase/bearer-session.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Server-gestuurd, per-account moduleregister voor de native shell (D13).
 * Alleen Supabase OAuth 2.1 access tokens van CAREON_SHELL_OAUTH_CLIENT_ID
 * worden geaccepteerd; de geretourneerde lijst is al server-side gefilterd.
 */
export async function GET(request: Request) {
  let result: Awaited<ReturnType<typeof getCareonShellSession>>;
  try {
    result = await getCareonShellSession(request);
  } catch {
    console.error("Careon shell session lookup failed");
    return NextResponse.json(
      { error: "De mobiele werkplek is tijdelijk niet bereikbaar." },
      { status: 503, headers: RESPONSE_HEADERS },
    );
  }
  if (result.status === "misconfigured") {
    return NextResponse.json(
      { error: "De mobiele shell is nog niet geactiveerd." },
      { status: 503, headers: RESPONSE_HEADERS },
    );
  }
  if (result.status === "unauthenticated") {
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401, headers: RESPONSE_HEADERS });
  }
  if (result.status === "wrong-client") {
    return NextResponse.json(
      { error: "Dit toegangstoken is niet voor de Careon Pulse-app uitgegeven." },
      { status: 403, headers: RESPONSE_HEADERS },
    );
  }
  if (result.status === "no-org") {
    return NextResponse.json(
      { error: "Geen organisatie gekoppeld aan dit account." },
      { status: 403, headers: RESPONSE_HEADERS },
    );
  }

  const registry = buildCareonShellRegistry(CAREON_MODULES, result.session, process.env.CAREON_PUBLIC_APP_URL);
  return NextResponse.json(registry, { headers: RESPONSE_HEADERS });
}
