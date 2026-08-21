import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { mintCareonMobileHandoff } from "@/lib/careon-mobile/handoff.server";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { getCareonShellSession } from "@/lib/supabase/bearer-session.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_096;
const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
};

export async function POST(request: Request) {
  let auth: Awaited<ReturnType<typeof getCareonShellSession>>;
  try {
    auth = await getCareonShellSession(request);
  } catch {
    console.error("Careon mobile handoff authentication failed");
    return NextResponse.json(
      { error: "De mobiele werkplek is tijdelijk niet bereikbaar." },
      { status: 503, headers: RESPONSE_HEADERS },
    );
  }
  if (auth.status === "misconfigured") {
    return NextResponse.json(
      { error: "De mobiele werkplek is nog niet geactiveerd." },
      { status: 503, headers: RESPONSE_HEADERS },
    );
  }
  if (auth.status === "unauthenticated") {
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401, headers: RESPONSE_HEADERS });
  }
  if (auth.status === "wrong-client") {
    return NextResponse.json(
      { error: "Dit toegangstoken is niet voor de Careon Pulse-app uitgegeven." },
      { status: 403, headers: RESPONSE_HEADERS },
    );
  }
  if (auth.status === "no-org") {
    return NextResponse.json(
      { error: "Geen organisatie gekoppeld aan dit account." },
      { status: 403, headers: RESPONSE_HEADERS },
    );
  }

  let body: { moduleId?: unknown; target?: unknown };
  try {
    body = await readJsonBodyLimited<{ moduleId?: unknown; target?: unknown }>(request, MAX_BODY_BYTES);
  } catch (error) {
    const status = error instanceof RequestPayloadTooLargeError ? 413 : 400;
    if (!(error instanceof InvalidJsonBodyError) && !(error instanceof RequestPayloadTooLargeError)) {
      console.error("Careon mobile handoff body read failed");
    }
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status, headers: RESPONSE_HEADERS });
  }
  if (
    typeof body.moduleId !== "string" ||
    (body.target !== undefined && body.target !== null && typeof body.target !== "string")
  ) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const result = await mintCareonMobileHandoff(
    auth.session,
    body.moduleId,
    typeof body.target === "string" ? body.target : null,
  );
  if (result.status === "invalid_module") {
    return NextResponse.json(
      { error: "Deze module is niet beschikbaar voor jouw account." },
      { status: 403, headers: RESPONSE_HEADERS },
    );
  }
  if (result.status === "invalid_target") {
    return NextResponse.json({ error: "Ongeldige modulebestemming." }, { status: 400, headers: RESPONSE_HEADERS });
  }
  if (result.status === "unavailable") {
    return NextResponse.json(
      { error: "De module kon niet veilig worden geopend." },
      { status: 503, headers: RESPONSE_HEADERS },
    );
  }

  scheduleAuditEvent({
    action: "auth.mobile_handoff.mint",
    resource: "module",
    resourceId: body.moduleId,
    orgId: auth.session.orgId,
    userId: auth.session.userId,
    detail: { client: "careonpulse-shell" },
  });
  return NextResponse.json(
    { code: result.code, endpoint: result.endpoint, expiresAt: result.expiresAt },
    { status: 201, headers: RESPONSE_HEADERS },
  );
}
