/**
 * Fault-injection gate for the production execution boundary. All provider
 * calls are mocked; no network, API key, or database is used.
 */

import { authenticatedActorHash, loginActorHash } from "../lib/careon-assistant/runtime.server";
import { isCareonHostedDemoEmail } from "../lib/careon-demo-account";
import { RequestPayloadTooLargeError, readJsonBodyLimited } from "../lib/http/read-json.server";
import * as fs from "node:fs";
import * as path from "node:path";

let passes = 0;
let failures = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    passes += 1;
  } else {
    failures += 1;
    console.error(`FAIL ${name}`);
  }
}

function assistantRequest(question: string): Request {
  return new Request("http://careon.test/api/assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-careon-assistant": "1",
      "x-careon-session": "careon-runtime-hardening-test",
    },
    body: JSON.stringify({
      question,
      context: "{}",
      events: true,
      tools: true,
      allowedTools: ["wijzig_taal"],
    }),
  });
}

function sse(...events: unknown[]): Response {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\n`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function main() {
  const proxySource = fs.readFileSync(path.resolve(process.cwd(), "src/proxy.ts"), "utf8");
  check("proxy matcher slaat prefetch niet over", !proxySource.includes("missing:"));
  check("proxy gebruikt expliciete demo-vlag", proxySource.includes("isCareonDemoMode()"));
  check("vast demoaccount wordt hoofdletterongevoelig herkend", isCareonHostedDemoEmail(" USER1@CAREON-DEMO.NL "));
  check("gewone accounts zijn niet beschermd", !isCareonHostedDemoEmail("user1@example.nl"));
  const adminUsersSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/admin/users/route.ts"), "utf8");
  check(
    "admin-API beschermt vaste demoaccount tegen lock-out",
    adminUsersSource.includes("isCareonHostedDemoEmail(target.email)") &&
      adminUsersSource.includes('action !== "unban"'),
  );
  const logoutSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/auth/logout/route.ts"), "utf8");
  const loginSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/auth/login/route.ts"), "utf8");
  check(
    "logout beëindigt alleen huidige sessie",
    logoutSource.includes('signOut({ scope: "local" })') && loginSource.includes('signOut({ scope: "local" })'),
  );
  const chatMigration = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260726175252_auth_security_hardening.sql"),
    "utf8",
  );
  check(
    "chat-updatepolicy controleert organisatie in USING en WITH CHECK",
    (chatMigration.match(/app\.is_org_member\(org_id\)/g) ?? []).length >= 4,
  );

  const loginRequestA = new Request("http://careon.test/api/auth/login", {
    headers: { "x-forwarded-for": "203.0.113.8", "x-careon-session": "aaaaaaaaaaaaaaaa" },
  });
  const loginRequestB = new Request("http://careon.test/api/auth/login", {
    headers: { "x-forwarded-for": "203.0.113.8", "x-careon-session": "bbbbbbbbbbbbbbbb" },
  });
  const loginRequestC = new Request("http://careon.test/api/auth/login", {
    headers: { "x-forwarded-for": "203.0.113.9", "x-careon-session": "aaaaaaaaaaaaaaaa" },
  });
  check("login-identiteit negeert client-session-id", loginActorHash(loginRequestA) === loginActorHash(loginRequestB));
  check("login-identiteit onderscheidt bezoekers-IP", loginActorHash(loginRequestA) !== loginActorHash(loginRequestC));
  const authenticatedHashA = authenticatedActorHash("user-a");
  const authenticatedHashARepeat = authenticatedActorHash("user-a");
  const authenticatedHashB = authenticatedActorHash("user-b");
  check(
    "accountidentiteit is stabiel en per gebruiker",
    authenticatedHashA === authenticatedHashARepeat && authenticatedHashA !== authenticatedHashB,
  );

  const parsed = await readJsonBodyLimited<{ ok: boolean }>(
    new Request("http://careon.test/body", { method: "POST", body: '{"ok":true}' }),
    32,
  );
  check("begrensde JSON-reader parseert geldige body", parsed.ok === true);

  let tooLarge = false;
  try {
    await readJsonBodyLimited(
      new Request("http://careon.test/body", { method: "POST", body: JSON.stringify({ value: "x".repeat(80) }) }),
      32,
    );
  } catch (error) {
    tooLarge = error instanceof RequestPayloadTooLargeError;
  }
  check("begrensde JSON-reader stopt body zonder content-length", tooLarge);

  // Sessie-auth (handoff 13): buiten een Next-request-context bestaat er geen
  // cookie-store, dus de routes moeten gecontroleerd 501 antwoorden in plaats
  // van crashen. (De DNS-tak zelf blijft ongewijzigd achter storageFetch-
  // try/catch; die is alleen bereikbaar mét een geldige sessie.)
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database-unreachable.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  globalThis.fetch = async () => {
    throw new TypeError("simulated DNS failure");
  };
  const productionRoute = await import("../app/api/careon/production/route");
  const productionUnavailable = await productionRoute.GET();
  check("productie-route zonder request-context faalt gesloten met 503", productionUnavailable.status === 503);
  const { createAuxStateHandlers } = await import("../lib/careon-production/aux-route");
  const auxHandlers = createAuxStateHandlers("careon_test_state", (_value): _value is object => true, "teststaat");
  const auxUnavailable = await auxHandlers.GET();
  check("aanvullende route zonder request-context faalt gesloten met 503", auxUnavailable.status === 503);
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;

  process.env.OPENAI_API_KEY = "test-only-key";
  process.env.CAREON_ASSISTANT_LIVE = "1";
  process.env.CAREON_DEMO_MODE = "1";
  process.env.CAREON_ASSISTANT_MAX_RETRIES = "0";
  process.env.OPENAI_MODERATION_ENABLED = "1";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  let providerMode: "complete" | "failed" | "incomplete" | "malformed" | "moderation-down" = "complete";
  let providerCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/moderations")) {
      if (providerMode === "moderation-down") return new Response("down", { status: 503 });
      return Response.json({ results: [{ flagged: false }] });
    }
    providerCalls += 1;
    if (providerMode === "failed") {
      return sse(
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { type: "function_call", call_id: "call-failed", name: "wijzig_taal", arguments: "{}" },
        },
        { type: "response.failed", response: { error: { code: "provider_failed" } } },
      );
    }
    if (providerMode === "incomplete") {
      return sse({ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } });
    }
    if (providerMode === "malformed") {
      return new Response('data: {"type":"response.output_text.delta","delta":"x"}\n\ndata: {broken}\n\n');
    }
    return sse(
      {
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "function_call", call_id: "call-ok", name: "wijzig_taal", arguments: "{}" },
      },
      { type: "response.completed", response: { status: "completed", usage: { total_tokens: 3 } } },
    );
  };

  try {
    const { POST } = await import("../app/api/assistant/route");

    providerMode = "complete";
    const completed = await (await POST(assistantRequest("Voeg de geregistreerde taal Turks toe."))).text();
    check("complete stream eindigt met done", completed.includes('"t":"done"'));
    check("complete stream levert tool", completed.includes('"t":"tool"'));
    check("complete stream bevat geen fout", !completed.includes('"t":"error"'));

    providerMode = "failed";
    const failed = await (await POST(assistantRequest("Voeg de geregistreerde taal Turks toe."))).text();
    check("provider failure levert wire-error", failed.includes('"t":"error"'));
    check("provider failure levert geen tool", !failed.includes('"t":"tool"'));
    check("provider failure levert geen done", !failed.includes('"t":"done"'));

    providerMode = "incomplete";
    const incomplete = await (await POST(assistantRequest("Voeg de geregistreerde taal Turks toe."))).text();
    check(
      "incomplete response faalt gesloten",
      incomplete.includes('"t":"error"') && !incomplete.includes('"t":"tool"'),
    );

    providerMode = "malformed";
    const malformed = await (await POST(assistantRequest("Voeg de geregistreerde taal Turks toe."))).text();
    check("misvormd SSE-frame faalt gesloten", malformed.includes('"t":"error"') && !malformed.includes('"t":"done"'));

    providerMode = "moderation-down";
    const callsBeforeModerationFailure = providerCalls;
    const moderationDown = await POST(assistantRequest("Voeg de geregistreerde taal Turks toe."));
    check("moderation-uitval antwoordt 503", moderationDown.status === 503);
    check("moderation-uitval bereikt modelprovider niet", providerCalls === callsBeforeModerationFailure);

    providerMode = "complete";
    const callsBeforeConceptRequest = providerCalls;
    const conceptResponse = await POST(assistantRequest("Voeg een taal toe op basis van zijn naam."));
    const conceptBody = await conceptResponse.text();
    check("aanname-opdracht bereikt de modelprovider", providerCalls === callsBeforeConceptRequest + 1);
    check("aanname-opdracht kan een concepttool opleveren", conceptBody.includes('"t":"tool"'));
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`Runtime hardening verification: ${passes} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
