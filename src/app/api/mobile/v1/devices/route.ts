import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { parseMobilePushDeviceInput, parseMobilePushUnregisterInput } from "@/lib/careon-mobile/push-device";
import { registerMobilePushDevice, unregisterMobilePushDevice } from "@/lib/careon-mobile/push-device.server";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { getCareonShellSession } from "@/lib/supabase/bearer-session.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_192;
const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
};

async function shellSession(request: Request) {
  try {
    const auth = await getCareonShellSession(request);
    if (auth.status === "ok") return { session: auth.session, response: null };
    if (auth.status === "misconfigured") {
      return {
        session: null,
        response: NextResponse.json(
          { error: "Mobiele meldingen zijn nog niet geactiveerd." },
          { status: 503, headers: RESPONSE_HEADERS },
        ),
      };
    }
    if (auth.status === "unauthenticated") {
      return {
        session: null,
        response: NextResponse.json({ error: "Niet ingelogd." }, { status: 401, headers: RESPONSE_HEADERS }),
      };
    }
    return {
      session: null,
      response: NextResponse.json(
        {
          error:
            auth.status === "wrong-client"
              ? "Dit toegangstoken is niet voor de Careon Pulse-app uitgegeven."
              : "Geen organisatie gekoppeld aan dit account.",
        },
        { status: 403, headers: RESPONSE_HEADERS },
      ),
    };
  } catch {
    console.error("Careon mobile device authentication failed");
    return {
      session: null,
      response: NextResponse.json(
        { error: "Mobiele meldingen zijn tijdelijk niet bereikbaar." },
        { status: 503, headers: RESPONSE_HEADERS },
      ),
    };
  }
}

async function limitedBody(request: Request): Promise<{ body: unknown; response: NextResponse | null }> {
  try {
    return { body: await readJsonBodyLimited<unknown>(request, MAX_BODY_BYTES), response: null };
  } catch (error) {
    const status = error instanceof RequestPayloadTooLargeError ? 413 : 400;
    if (!(error instanceof InvalidJsonBodyError) && !(error instanceof RequestPayloadTooLargeError)) {
      console.error("Careon mobile device body read failed");
    }
    return {
      body: null,
      response: NextResponse.json({ error: "Ongeldige aanvraag." }, { status, headers: RESPONSE_HEADERS }),
    };
  }
}

export async function PUT(request: Request) {
  const auth = await shellSession(request);
  if (!auth.session) return auth.response;
  const parsedBody = await limitedBody(request);
  if (parsedBody.response) return parsedBody.response;
  const input = parseMobilePushDeviceInput(parsedBody.body);
  if (!input) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const result = await registerMobilePushDevice(auth.session, input);
  if (result === "misconfigured") {
    return NextResponse.json(
      { error: "Mobiele meldingen zijn nog niet geactiveerd." },
      { status: 503, headers: RESPONSE_HEADERS },
    );
  }
  if (result === "membership_missing") {
    return NextResponse.json(
      { error: "Dit account heeft geen actuele organisatietoegang." },
      { status: 403, headers: RESPONSE_HEADERS },
    );
  }
  if (result !== "ok") {
    return NextResponse.json(
      { error: "Het apparaat kon niet veilig worden geregistreerd." },
      { status: 503, headers: RESPONSE_HEADERS },
    );
  }

  scheduleAuditEvent({
    action: "mobile.push_device.register",
    resource: "mobile_device",
    orgId: auth.session.orgId,
    userId: auth.session.userId,
    detail: { platform: input.platform, appVersion: input.appVersion },
  });
  return NextResponse.json({ registered: true }, { status: 200, headers: RESPONSE_HEADERS });
}

export async function DELETE(request: Request) {
  const auth = await shellSession(request);
  if (!auth.session) return auth.response;
  const parsedBody = await limitedBody(request);
  if (parsedBody.response) return parsedBody.response;
  const input = parseMobilePushUnregisterInput(parsedBody.body);
  if (!input) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const result = await unregisterMobilePushDevice(auth.session, input.installationId);
  if (result !== "ok") {
    return NextResponse.json(
      { error: "De apparaatregistratie kon niet worden beëindigd." },
      { status: 503, headers: RESPONSE_HEADERS },
    );
  }

  scheduleAuditEvent({
    action: "mobile.push_device.unregister",
    resource: "mobile_device",
    orgId: auth.session.orgId,
    userId: auth.session.userId,
    detail: {},
  });
  return NextResponse.json({ registered: false }, { status: 200, headers: RESPONSE_HEADERS });
}
