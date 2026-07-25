/**
 * Fault-injection gate for the production execution boundary. All provider
 * calls are mocked; no network, API key, or database is used.
 */

import { RequestPayloadTooLargeError, readJsonBodyLimited } from "../lib/http/read-json.server";

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

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database-unreachable.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.NEXT_PUBLIC_CAREON_SYNC_TOKEN = "test-sync-token";
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  globalThis.fetch = async () => {
    throw new TypeError("simulated DNS failure");
  };
  const storageRequest = new Request("http://careon.test/api/careon/production", {
    headers: { "x-careon-sync": "test-sync-token" },
  });
  const productionRoute = await import("../app/api/careon/production/route");
  const productionUnavailable = await productionRoute.GET(storageRequest);
  check("productie-opslag DNS-fout wordt gecontroleerde 502", productionUnavailable.status === 502);
  const { createAuxStateHandlers } = await import("../lib/careon-production/aux-route");
  const auxHandlers = createAuxStateHandlers("careon_test_state", (_value): _value is object => true, "teststaat");
  const auxUnavailable = await auxHandlers.GET(storageRequest);
  check("aanvullende opslag DNS-fout wordt gecontroleerde 502", auxUnavailable.status === 502);
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;

  process.env.OPENAI_API_KEY = "test-only-key";
  process.env.CAREON_ASSISTANT_LIVE = "1";
  process.env.CAREON_ASSISTANT_MAX_RETRIES = "0";
  process.env.OPENAI_MODERATION_ENABLED = "1";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
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
