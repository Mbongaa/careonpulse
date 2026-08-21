import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { consumeCareonMobileHandoff, establishCareonBrowserSession } from "@/lib/careon-mobile/handoff.server";
import { RequestPayloadTooLargeError, readTextBodyLimited } from "@/lib/http/read-json.server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2_048;
const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: RESPONSE_HEADERS });
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return errorResponse("Niet-ondersteund aanvraagformaat.", 415);
  }
  let encodedBody: string;
  try {
    encodedBody = await readTextBodyLimited(request, MAX_BODY_BYTES);
  } catch (error) {
    const status = error instanceof RequestPayloadTooLargeError ? 413 : 400;
    if (!(error instanceof RequestPayloadTooLargeError)) console.error("Careon mobile session body read failed");
    return errorResponse("Ongeldige aanvraag.", status);
  }
  const parameters = new URLSearchParams(encodedBody);
  const codes = parameters.getAll("code");
  if (codes.length !== 1 || [...parameters.keys()].some((key) => key !== "code")) {
    return errorResponse("Ongeldige aanvraag.", 400);
  }

  const result = await consumeCareonMobileHandoff(codes[0]);
  if (result.status === "invalid_or_expired") {
    return errorResponse("Deze eenmalige modulekoppeling is verlopen of al gebruikt.", 401);
  }
  if (result.status === "no_longer_allowed") {
    return errorResponse("Dit account heeft geen toegang meer tot deze module.", 403);
  }
  if (result.status === "unavailable") {
    return errorResponse("De module kon niet veilig worden geopend.", 503);
  }

  const browserClient = await supabaseServer();
  if (!browserClient) return errorResponse("Authenticatie is tijdelijk niet beschikbaar.", 503);
  const established = await establishCareonBrowserSession(browserClient, result.handoff);
  if (established !== "ready") return errorResponse("Authenticatie is tijdelijk niet beschikbaar.", 503);

  scheduleAuditEvent({
    action: "auth.mobile_handoff.consume",
    resource: "module",
    resourceId: result.handoff.moduleId,
    orgId: result.handoff.session.orgId,
    userId: result.handoff.user.id,
    detail: { client: "careonpulse-shell" },
  });
  const response = NextResponse.redirect(result.handoff.targetUrl, 303);
  for (const [name, value] of Object.entries(RESPONSE_HEADERS)) response.headers.set(name, value);
  return response;
}
