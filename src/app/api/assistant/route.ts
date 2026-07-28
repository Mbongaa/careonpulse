import {
  FINANCIEEL_PROMPTREGELS,
  FINANCIEEL_WEIGERTEKST,
  filterFinancieleHistory,
  isFinancieleAssistentVraag,
  verwijderFinancieleContext,
} from "@/lib/careon-assistant/financieel-gate";
import {
  ASSISTANT_API_MODE,
  ASSISTANT_MODEL,
  ASSISTANT_PROMPT_VERSION,
  type AssistantEvent,
  type AssistantUsage,
  assistantActorHash,
  authenticatedActorHash,
  createAssistantRequestId,
  enforceAssistantRateLimit,
  fetchOpenAIWithRetry,
  isAssistantLive,
  moderateAssistantQuestion,
  OPENAI_API_BASE_URL,
  pruneAssistantEvents,
  writeAssistantEvent as writeAssistantEventBase,
} from "@/lib/careon-assistant/runtime.server";
import { magFinancieelZien } from "@/lib/careon-financieel-rol";
import { ASSISTANT_MAX_CONTEXT_CHARS } from "@/lib/careon-middelen/assistant-grounding";
import {
  getAssistantChatTools,
  getAssistantResponsesTools,
  MIDDELEN_TOOL_NAMES,
  type MiddelenToolName,
} from "@/lib/careon-middelen/assistant-tools";
import { getCareonSession } from "@/lib/supabase/session.server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_REQUEST_BYTES = 450_000;
const MAX_QUESTION_CHARS = 2_000;
const MAX_CONTEXT_CHARS = ASSISTANT_MAX_CONTEXT_CHARS;
const MAX_HISTORY_TURNS = 8;
const MAX_OUTPUT_TOKENS = 700;
const MAX_OUTPUT_TOKENS_TOOLS = 2_400;
const MAX_STEPS = 120;
const MAX_TOOL_CALLS_PER_STEP = 32;
const MAX_TOOL_ARGS_CHARS = 4_000;
const MAX_TOOL_RESULT_CHARS = 6_000;

interface AssistantRequest {
  question?: string;
  style?: "standaard" | "diep";
  context?: string;
  history?: { role: "user" | "assistant"; content: string }[];
  steps?: unknown[];
  tools?: boolean;
  /** Nieuwe clients vragen NDJSON ook wanneer geen tools relevant zijn. */
  events?: boolean;
  allowedTools?: unknown;
  forceerTools?: boolean;
}

interface UpstreamToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type StepMessage =
  | { role: "assistant"; content: string | null; tool_calls: UpstreamToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type WireEvent =
  | { t: "meta"; requestId: string; model: string; promptVersion: string }
  | { t: "text"; d: string }
  | { t: "tool"; id: string; name: string; args: string }
  | { t: "error"; code: string; message: string }
  | { t: "done"; reason: "stop" | "tool_calls"; usage?: AssistantUsage };

function sanitizeSteps(steps: unknown[]): StepMessage[] | null {
  if (steps.length > MAX_STEPS) return null;
  const result: StepMessage[] = [];
  for (const step of steps) {
    if (typeof step !== "object" || step === null) return null;
    const row = step as Record<string, unknown>;
    if (row.role === "assistant") {
      const content = row.content ?? null;
      if (content !== null && typeof content !== "string") return null;
      if (!Array.isArray(row.tool_calls) || row.tool_calls.length > MAX_TOOL_CALLS_PER_STEP) return null;
      const calls: UpstreamToolCall[] = [];
      for (const call of row.tool_calls) {
        if (typeof call !== "object" || call === null) return null;
        const fn = (call as Record<string, unknown>).function;
        const id = (call as Record<string, unknown>).id;
        if (typeof id !== "string" || typeof fn !== "object" || fn === null) return null;
        const name = (fn as Record<string, unknown>).name;
        const args = (fn as Record<string, unknown>).arguments;
        if (typeof name !== "string" || typeof args !== "string" || args.length > MAX_TOOL_ARGS_CHARS) return null;
        if (!(MIDDELEN_TOOL_NAMES as readonly string[]).includes(name)) return null;
        calls.push({ id: id.slice(0, 120), type: "function", function: { name, arguments: args } });
      }
      result.push({
        role: "assistant",
        content: content === null ? null : content.slice(0, MAX_QUESTION_CHARS),
        tool_calls: calls,
      });
    } else if (row.role === "tool") {
      if (typeof row.tool_call_id !== "string" || typeof row.content !== "string") return null;
      result.push({
        role: "tool",
        tool_call_id: row.tool_call_id.slice(0, 120),
        content: row.content.slice(0, MAX_TOOL_RESULT_CHARS),
      });
    } else {
      return null;
    }
  }
  return result;
}

function allowedTools(body: AssistantRequest): MiddelenToolName[] {
  if (body.tools !== true) return [];
  if (!Array.isArray(body.allowedTools)) return [...MIDDELEN_TOOL_NAMES];
  return [
    ...new Set(
      body.allowedTools.filter(
        (name): name is MiddelenToolName =>
          typeof name === "string" && (MIDDELEN_TOOL_NAMES as readonly string[]).includes(name),
      ),
    ),
  ];
}

function systemPrompt(
  style: "standaard" | "diep",
  context: string,
  tools: readonly MiddelenToolName[],
  financieelGeblokkeerd = false,
): string {
  const depth =
    style === "diep"
      ? "Geef een diepgaand, diagnostisch antwoord met oorzaken, verbanden en concrete vervolgacties (maximaal circa 10 zinnen)."
      : "Antwoord kort en zakelijk in 2-4 zinnen met de kern en één concreet advies.";
  const acties = tools.length
    ? [
        "",
        "ACTIES — CONCEPT-WERKWIJZE:",
        `Alleen deze tools zijn voor dit verzoek beschikbaar: ${tools.join(", ")}.`,
        "Gebruik uitsluitend tools die direct nodig zijn voor de expliciete opdracht. De AI schrijft nooit zelf: elke tool-aanroep wordt als bewerkbaar concept klaargezet en pas na Toepassen opgeslagen.",
        "Vertrek, ontslag of 'uit dienst' gebruikt zet_dienstverband; verwijder_medewerker is uitsluitend voor foutief aangemaakte rijen.",
        "Bij opdrachten voor 'iedereen', 'alle medewerkers' of 'elke medewerker' is volledige dekking verplicht. Kies zelf de efficiëntste beschikbare toolcombinatie en sla niemand stilzwijgend over.",
        "Vraagt de gebruiker expliciet om een voorzet op basis van aannames, bijvoorbeeld om per medewerker een tweede taal in te schatten op basis van de naam, zet die aannames dan direct met de beschikbare wijzigingstools als bewerkbaar concept klaar. Kies zelf de benodigde tools en gebruik Engels als conceptvoorstel wanneer de naam geen andere bruikbare aanwijzing geeft. Presenteer alles als aannames die de gebruiker vóór Toepassen kan corrigeren; sla ze nooit zelfstandig op.",
        "Gebruik de registratie-tool wanneer een naam of actuele stand onzeker is; verzin nooit medewerkersnamen.",
        "Kondig een actie nooit alleen aan: roep in dezelfde beurt de benodigde tools aan. Vraag alleen door bij echte dubbelzinnigheid.",
        "Sluit af met een korte samenvatting van het concept en vermeld wat niet kon.",
      ]
    : [];
  return [
    "U bent de Careon AI-assistent van het Nederlandse GGZ-managementdashboard Careon Pulse.",
    "Antwoord uitsluitend in het Nederlands, professioneel en direct in de u-vorm.",
    "Gebruik alleen feiten uit de context. Verzin, reconstrueer of extrapoleer geen getallen, namen of oorzaken.",
    "Als gegevens ontbreken, benoem precies welke bron ontbreekt. Gebruik nooit demo-cijfers als productiefeiten.",
    "Respecteer proxy- en ondergrensdefinities in de context.",
    "Een antwoord is managementondersteuning en geen diagnose, behandeladvies of geautomatiseerd klinisch besluit.",
    depth,
    ...(financieelGeblokkeerd ? ["", ...FINANCIEEL_PROMPTREGELS] : []),
    ...acties,
    "",
    `PROMPTVERSIE: ${ASSISTANT_PROMPT_VERSION}`,
    "CONTEXT:",
    context,
  ].join("\n");
}

async function readLimitedJson(request: Request): Promise<AssistantRequest | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let read = await reader.read();
  while (!read.done) {
    const { value } = read;
    if (value) {
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    read = await reader.read();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as AssistantRequest;
  } catch {
    return null;
  }
}

function responsesInput(
  history: { role: "user" | "assistant"; content: string }[],
  question: string,
  steps: StepMessage[],
): unknown[] {
  const input: unknown[] = [
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: question },
  ];
  for (const step of steps) {
    if (step.role === "assistant") {
      if (step.content) input.push({ role: "assistant", content: step.content });
      for (const call of step.tool_calls) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        });
      }
    } else {
      input.push({ type: "function_call_output", call_id: step.tool_call_id, output: step.content });
    }
  }
  return input;
}

function providerRequest(
  body: AssistantRequest,
  question: string,
  context: string,
  history: { role: "user" | "assistant"; content: string }[],
  steps: StepMessage[],
  tools: MiddelenToolName[],
  actorHash: string,
  financieelGeblokkeerd: boolean,
): { url: string; body: Record<string, unknown> } {
  const instructions = systemPrompt(
    body.style === "diep" ? "diep" : "standaard",
    context,
    tools,
    financieelGeblokkeerd,
  );
  if (ASSISTANT_API_MODE === "responses") {
    return {
      url: `${OPENAI_API_BASE_URL}/responses`,
      body: {
        model: ASSISTANT_MODEL,
        stream: true,
        store: false,
        instructions,
        input: responsesInput(history, question, steps),
        max_output_tokens: tools.length ? MAX_OUTPUT_TOKENS_TOOLS : MAX_OUTPUT_TOKENS,
        ...(tools.length
          ? {
              tools: getAssistantResponsesTools(tools),
              tool_choice: body.forceerTools === true ? "required" : "auto",
            }
          : {}),
        safety_identifier: actorHash,
      },
    };
  }
  return {
    url: `${OPENAI_API_BASE_URL}/chat/completions`,
    body: {
      model: ASSISTANT_MODEL,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.3,
      max_tokens: tools.length ? MAX_OUTPUT_TOKENS_TOOLS : MAX_OUTPUT_TOKENS,
      ...(tools.length
        ? {
            tools: getAssistantChatTools(tools),
            tool_choice: body.forceerTools === true ? "required" : "auto",
          }
        : {}),
      messages: [{ role: "system", content: instructions }, ...history, { role: "user", content: question }, ...steps],
    },
  };
}

export async function GET() {
  return Response.json(
    {
      live: isAssistantLive(),
      model: isAssistantLive() ? ASSISTANT_MODEL : null,
      apiMode: ASSISTANT_API_MODE,
      promptVersion: ASSISTANT_PROMPT_VERSION,
      protections: { strictTools: true, moderation: process.env.OPENAI_MODERATION_ENABLED !== "0", rateLimited: true },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = createAssistantRequestId();
  let actorHash = assistantActorHash(request);
  const responseHeaders = {
    "Cache-Control": "no-store",
    "X-Careon-Assistant-Model": ASSISTANT_MODEL,
    "X-Careon-Request-Id": requestId,
  };

  if (!isAssistantLive()) {
    return new Response("AI is niet geconfigureerd.", { status: 503, headers: responseHeaders });
  }
  if (request.headers.get("x-careon-assistant") !== "1") {
    return new Response("Ongeldige aanvraag.", { status: 401, headers: responseHeaders });
  }

  // In Supabase-modus is inloggen verplicht: de route kost geld (OpenAI) en
  // acties moeten herleidbaar zijn naar een account. Demo-modus (geen
  // Supabase-omgeving) behoudt het oude gedrag.
  const sessionResult = await getCareonSession();
  if (sessionResult.status === "misconfigured") {
    return new Response("Authenticatie is niet geconfigureerd.", { status: 503, headers: responseHeaders });
  }
  if (sessionResult.status === "unauthenticated") {
    return new Response("Niet ingelogd.", { status: 401, headers: responseHeaders });
  }
  if (sessionResult.status === "no-org") {
    return new Response("Geen organisatie gekoppeld aan dit account.", { status: 403, headers: responseHeaders });
  }
  const identity = sessionResult.status === "ok" ? sessionResult.session : null;
  if (identity) actorHash = authenticatedActorHash(identity.userId);
  // Schaduwt bewust de import: elk event in deze aanvraag draagt de identiteit.
  const writeAssistantEvent = (event: AssistantEvent) =>
    writeAssistantEventBase({ ...event, orgId: identity?.orgId ?? null, userId: identity?.userId ?? null });

  const limit = await enforceAssistantRateLimit(actorHash);
  if (!limit.allowed) {
    void writeAssistantEvent({
      requestId,
      actorHash,
      eventType: "request_blocked",
      model: ASSISTANT_MODEL,
      statusCode: limit.source === "unavailable" ? 503 : 429,
      metadata: { reason: limit.source === "unavailable" ? "rate_limit_unavailable" : "rate_limit" },
    });
    if (limit.source === "unavailable") {
      return new Response("De gedeelde aanvraaglimiet is tijdelijk niet beschikbaar.", {
        status: 503,
        headers: { ...responseHeaders, "Retry-After": String(limit.retryAfterSeconds) },
      });
    }
    return new Response("Te veel AI-aanvragen. Probeer het later opnieuw.", {
      status: 429,
      headers: { ...responseHeaders, "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const body = await readLimitedJson(request);
  if (!body) return new Response("Ongeldige of te grote aanvraag.", { status: 400, headers: responseHeaders });
  const question = (body.question ?? "").slice(0, MAX_QUESTION_CHARS).trim();
  let context = (body.context ?? "").slice(0, MAX_CONTEXT_CHARS);
  if (!question) return new Response("Lege vraag.", { status: 400, headers: responseHeaders });

  const steps = sanitizeSteps(Array.isArray(body.steps) ? body.steps : []);
  if (steps === null) return new Response("Ongeldige aanvraag.", { status: 400, headers: responseHeaders });
  const tools = allowedTools(body);
  const eventStream = body.events === true || body.tools === true;
  let history = (body.history ?? [])
    .filter((turn) => (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string")
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, MAX_QUESTION_CHARS) }));

  // Financiële rolregel (klantbesluit 28-07-2026). Alleen hier afdwingbaar:
  // de context is een client-samengestelde string. Vóór de moderatiecall,
  // zodat een weigering geen OpenAI-verkeer kost. Demo-modus (identity null)
  // kent geen rollen en blijft volledig.
  const financieelToegestaan = identity === null || magFinancieelZien(identity);
  if (!financieelToegestaan) {
    if (isFinancieleAssistentVraag(question)) {
      void writeAssistantEvent({
        requestId,
        actorHash,
        eventType: "request_blocked",
        model: ASSISTANT_MODEL,
        statusCode: 200,
        durationMs: Date.now() - startedAt,
        metadata: { reason: "financieel_rol" },
      });
      // Zelfde wire-vorm als een normaal antwoord: de weigering landt gewoon
      // als assistentbericht in de chat.
      if (eventStream) {
        const frames = [
          JSON.stringify({ t: "meta", requestId, model: ASSISTANT_MODEL, promptVersion: ASSISTANT_PROMPT_VERSION }),
          JSON.stringify({ t: "text", d: FINANCIEEL_WEIGERTEKST }),
          JSON.stringify({ t: "done", reason: "stop" }),
        ].join("\n");
        return new Response(`${frames}\n`, {
          headers: { ...responseHeaders, "Content-Type": "application/x-ndjson; charset=utf-8" },
        });
      }
      return new Response(FINANCIEEL_WEIGERTEKST, {
        headers: { ...responseHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    const geschoond = verwijderFinancieleContext(context);
    context = geschoond.context;
    history = filterFinancieleHistory(history);
    if (geschoond.verwijderd) {
      void writeAssistantEvent({
        requestId,
        actorHash,
        eventType: "request_blocked",
        model: ASSISTANT_MODEL,
        statusCode: 200,
        metadata: { reason: "financiele_context_verwijderd" },
      });
    }
  }

  void pruneAssistantEvents();
  void writeAssistantEvent({
    requestId,
    actorHash,
    eventType: "request_started",
    model: ASSISTANT_MODEL,
    metadata: { toolsOffered: tools.length, contextChars: context.length },
  });

  const moderation = await moderateAssistantQuestion(question, request.signal);
  if (moderation !== "allowed") {
    void writeAssistantEvent({
      requestId,
      actorHash,
      eventType: "request_blocked",
      model: ASSISTANT_MODEL,
      statusCode: moderation === "flagged" ? 400 : 503,
      metadata: { reason: moderation === "flagged" ? "moderation" : "moderation_unavailable" },
    });
    if (moderation === "unavailable") {
      return new Response("De veiligheidscontrole is tijdelijk niet beschikbaar.", {
        status: 503,
        headers: { ...responseHeaders, "Retry-After": "30" },
      });
    }
    return new Response("Deze aanvraag kan niet door de assistent worden verwerkt.", {
      status: 400,
      headers: responseHeaders,
    });
  }

  const provider = providerRequest(body, question, context, history, steps, tools, actorHash, !financieelToegestaan);
  let upstream: Response;
  try {
    upstream = await fetchOpenAIWithRetry(
      provider.url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(provider.body),
      },
      request.signal,
    );
  } catch {
    void writeAssistantEvent({
      requestId,
      actorHash,
      eventType: "request_failed",
      model: ASSISTANT_MODEL,
      statusCode: 504,
      durationMs: Date.now() - startedAt,
      metadata: { reason: "timeout_or_network" },
    });
    return new Response("De AI-dienst reageerde niet op tijd.", { status: 504, headers: responseHeaders });
  }
  if (!upstream.ok || !upstream.body) {
    void writeAssistantEvent({
      requestId,
      actorHash,
      eventType: "request_failed",
      model: ASSISTANT_MODEL,
      statusCode: upstream.status,
      durationMs: Date.now() - startedAt,
      metadata: { reason: "provider_status" },
    });
    return new Response("De AI-dienst is tijdelijk niet beschikbaar.", { status: 502, headers: responseHeaders });
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffered = "";
  let usage: AssistantUsage | undefined;
  let finishReason: string | null = null;
  let responsesTerminal: "completed" | "failed" | "incomplete" | "error" | null = null;
  let streamFailureCode = "";
  let chatDoneSeen = false;
  const toolCalls = new Map<number, { id: string; name: string; args: string }>();

  type EnqueueController = Pick<TransformStreamDefaultController<Uint8Array>, "enqueue">;
  const emit = (controller: EnqueueController, event: WireEvent) => {
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
  };
  const callAt = (index: number) => toolCalls.get(index) ?? { id: "", name: "", args: "" };

  const handleChatPayload = (controller: EnqueueController, payload: string) => {
    const parsed = JSON.parse(payload) as {
      choices?: {
        delta?: {
          content?: string;
          tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
        };
        finish_reason?: string | null;
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    if (parsed.usage) {
      usage = {
        inputTokens: parsed.usage.prompt_tokens,
        outputTokens: parsed.usage.completion_tokens,
        totalTokens: parsed.usage.total_tokens,
      };
    }
    const choice = parsed.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    if (choice.delta?.content) emit(controller, { t: "text", d: choice.delta.content });
    for (const fragment of choice.delta?.tool_calls ?? []) {
      const call = callAt(fragment.index);
      if (fragment.id) call.id = fragment.id;
      if (fragment.function?.name) call.name += fragment.function.name;
      if (fragment.function?.arguments) call.args += fragment.function.arguments;
      toolCalls.set(fragment.index, call);
    }
  };

  const handleResponsesPayload = (controller: EnqueueController, payload: string) => {
    const parsed = JSON.parse(payload) as {
      type?: string;
      delta?: string;
      output_index?: number;
      item?: { type?: string; call_id?: string; name?: string; arguments?: string };
      response?: {
        status?: string;
        error?: { code?: string; message?: string };
        incomplete_details?: { reason?: string };
        usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
      };
      error?: { code?: string; message?: string };
    };
    if (parsed.type === "response.output_text.delta" && parsed.delta) {
      emit(controller, { t: "text", d: parsed.delta });
    }
    if (parsed.type === "response.output_item.added" && parsed.item?.type === "function_call") {
      const index = parsed.output_index ?? toolCalls.size;
      toolCalls.set(index, {
        id: parsed.item.call_id ?? "",
        name: parsed.item.name ?? "",
        args: parsed.item.arguments ?? "",
      });
    }
    if (parsed.type === "response.function_call_arguments.delta" && parsed.delta) {
      const index = parsed.output_index ?? 0;
      const call = callAt(index);
      call.args += parsed.delta;
      toolCalls.set(index, call);
    }
    if (parsed.type === "response.output_item.done" && parsed.item?.type === "function_call") {
      const index = parsed.output_index ?? 0;
      toolCalls.set(index, {
        id: parsed.item.call_id ?? callAt(index).id,
        name: parsed.item.name ?? callAt(index).name,
        args: parsed.item.arguments ?? callAt(index).args,
      });
    }
    if (parsed.type === "response.completed") {
      responsesTerminal = "completed";
      finishReason = "stop";
      usage = {
        inputTokens: parsed.response?.usage?.input_tokens,
        outputTokens: parsed.response?.usage?.output_tokens,
        totalTokens: parsed.response?.usage?.total_tokens,
      };
    }
    if (parsed.type === "response.failed") {
      responsesTerminal = "failed";
      streamFailureCode = parsed.response?.error?.code ?? "response_failed";
    }
    if (parsed.type === "response.incomplete") {
      responsesTerminal = "incomplete";
      streamFailureCode = parsed.response?.incomplete_details?.reason ?? "response_incomplete";
    }
    if (parsed.type === "error") {
      responsesTerminal = "error";
      streamFailureCode = parsed.error?.code ?? "provider_stream_error";
    }
  };

  const processSse = (controller: EnqueueController, data: string) => {
    const payload = data.slice(5).trim();
    if (!payload) return;
    if (payload === "[DONE]") {
      chatDoneSeen = true;
      return;
    }
    try {
      if (ASSISTANT_API_MODE === "responses") handleResponsesPayload(controller, payload);
      else handleChatPayload(controller, payload);
    } catch {
      responsesTerminal = "error";
      streamFailureCode = "malformed_provider_frame";
    }
  };

  if (!eventStream) {
    const plainStream = upstream.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          buffered += decoder.decode(chunk, { stream: true });
          const lines = buffered.split("\n");
          buffered = lines.pop() ?? "";
          for (const line of lines) {
            const data = line.trim();
            if (!data.startsWith("data:")) continue;
            const tokens: Uint8Array[] = [];
            const shim: EnqueueController = {
              enqueue(value) {
                if (value) tokens.push(value);
              },
            };
            processSse(shim, data);
            for (const token of tokens) {
              try {
                const event = JSON.parse(decoder.decode(token)) as WireEvent;
                if (event.t === "text") controller.enqueue(encoder.encode(event.d));
              } catch {
                // No output for non-text events.
              }
            }
          }
        },
        flush() {
          const succeeded =
            ASSISTANT_API_MODE === "responses"
              ? responsesTerminal === "completed"
              : chatDoneSeen && (finishReason === "stop" || finishReason === "tool_calls");
          void writeAssistantEvent({
            requestId,
            actorHash,
            eventType: succeeded ? "request_completed" : "request_failed",
            model: ASSISTANT_MODEL,
            statusCode: succeeded ? 200 : 502,
            durationMs: Date.now() - startedAt,
            usage,
            metadata: { reason: succeeded ? "stream_completed" : streamFailureCode || "stream_ended_early" },
          });
        },
      }),
    );
    return new Response(plainStream, {
      headers: { ...responseHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const wireStream = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      start(controller) {
        emit(controller, {
          t: "meta",
          requestId,
          model: ASSISTANT_MODEL,
          promptVersion: ASSISTANT_PROMPT_VERSION,
        });
      },
      transform(chunk, controller) {
        buffered += decoder.decode(chunk, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          const data = line.trim();
          if (data.startsWith("data:")) processSse(controller, data);
        }
      },
      flush(controller) {
        const trailing = `${buffered}${decoder.decode()}`.trim();
        if (trailing.startsWith("data:")) processSse(controller, trailing);
        const complete = [...toolCalls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, call]) => call)
          .filter(
            (call) =>
              call.id &&
              (MIDDELEN_TOOL_NAMES as readonly string[]).includes(call.name) &&
              call.args.length <= MAX_TOOL_ARGS_CHARS,
          );
        const providerSucceeded =
          ASSISTANT_API_MODE === "responses"
            ? responsesTerminal === "completed"
            : chatDoneSeen && (finishReason === "stop" || finishReason === "tool_calls");
        const everyToolComplete = complete.length === toolCalls.size;
        if (!providerSucceeded || !everyToolComplete) {
          let code = "invalid_tool_call";
          if (!providerSucceeded) {
            code = streamFailureCode ? streamFailureCode : (responsesTerminal ?? "stream_ended_early");
          }
          emit(controller, {
            t: "error",
            code,
            message: "De AI-stream is niet volledig afgerond; er zijn geen acties klaargezet.",
          });
          void writeAssistantEvent({
            requestId,
            actorHash,
            eventType: "request_failed",
            model: ASSISTANT_MODEL,
            statusCode: 502,
            durationMs: Date.now() - startedAt,
            usage,
            metadata: { reason: code, toolsDiscarded: toolCalls.size },
          });
          return;
        }
        for (const call of complete) emit(controller, { t: "tool", id: call.id, name: call.name, args: call.args });
        const reason = finishReason === "tool_calls" || complete.length ? "tool_calls" : "stop";
        emit(controller, { t: "done", reason, usage });
        void writeAssistantEvent({
          requestId,
          actorHash,
          eventType: "request_completed",
          model: ASSISTANT_MODEL,
          statusCode: 200,
          durationMs: Date.now() - startedAt,
          usage,
          toolNames: complete.map((call) => call.name),
          metadata: { toolsOffered: tools.length, toolCalls: complete.length },
        });
      },
    }),
  );
  return new Response(wireStream, {
    headers: { ...responseHeaders, "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
