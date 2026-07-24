// Live AI endpoint for the Careon assistant.
//
// The OpenAI key lives ONLY here (server-side, via OPENAI_API_KEY in the
// environment) — it is never bundled to the client. The client sends the
// question plus a grounding context built from the deterministic demo
// dataset; the model is instructed to answer in Dutch using only that data.
// Without a configured key the route reports live:false and the client falls
// back to the deterministic demo answers, so the dashboard keeps working.
//
// Acties (handoff 11): naast lezen kan het model tools aanroepen om de
// handmatige registratie "Medewerkers & middelen" bij te werken. De tools
// worden hier alleen aan het model AANGEBODEN; uitvoering gebeurt uitsluitend
// client-side (assistant-executor.ts) op de bestaande provider-mutators. De
// response is daarom een NDJSON-stroom: tekst-tokens plus eventuele
// tool-aanroepen; de client voert uit en stuurt het tussenresultaat als
// `steps` terug voor de vervolgronde.

import { ASSISTANT_MAX_CONTEXT_CHARS } from "@/lib/careon-middelen/assistant-grounding";
import { MIDDELEN_TOOLS } from "@/lib/careon-middelen/assistant-tools";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const MAX_QUESTION_CHARS = 2000;
// Gedeeld met de client-samenstelling (assistant-grounding.ts): de client
// budgetteert de facts-sectie zodat de medewerkerslijst nooit wordt afgekapt.
const MAX_CONTEXT_CHARS = ASSISTANT_MAX_CONTEXT_CHARS;
const MAX_HISTORY_TURNS = 8;
const MAX_OUTPUT_TOKENS = 700;
// Actiebeurten dragen de tool-aanroep-JSON in de completion zelf; een
// bulkverzoek ("vul talen voor alle ~30 behandelaren") past niet in 700
// tokens — ruim nemen zodat één ronde tientallen aanroepen kan dragen.
const MAX_OUTPUT_TOKENS_TOOLS = 2400;
// Grenzen op het tussentranscript van de actielus (client stuurt per ronde
// één assistant-stap + één tool-resultaat per aanroep terug). Dit zijn
// misbruik-remmen, geen workflow-grenzen: ruim boven wat een echte bulkbeurt
// (tientallen aanroepen over meerdere rondes) nodig heeft — een te krappe cap
// zou een geldige vervolgronde met 400 afbreken.
const MAX_STEPS = 120;
const MAX_TOOL_CALLS_PER_STEP = 32;
const MAX_TOOL_ARGS_CHARS = 4000;
const MAX_TOOL_RESULT_CHARS = 6000;

function isLive(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && process.env.CAREON_ASSISTANT_LIVE !== "0";
}

export async function GET() {
  return Response.json(
    { live: isLive(), model: isLive() ? MODEL : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

interface AssistantRequest {
  question?: string;
  style?: "standaard" | "diep";
  context?: string;
  history?: { role: "user" | "assistant"; content: string }[];
  /** Actielus-transcript van de huidige beurt (OpenAI-formaat), zie sanitizeSteps. */
  steps?: unknown[];
  /** Client kan tools uitvoeren (middelen-registratie); dan bieden we ze aan. */
  tools?: boolean;
}

interface UpstreamToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type StepMessage =
  | { role: "assistant"; content: string | null; tool_calls: UpstreamToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

// Strikte validatie van het door de client teruggestuurde tussentranscript:
// alleen de twee verwachte vormen, met harde lengtegrenzen. Ongeldige input
// levert null op (→ 400), nooit een gedeeltelijk geaccepteerde stap.
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
        if (!MIDDELEN_TOOLS.some((tool) => tool.function.name === name)) return null;
        calls.push({ id: id.slice(0, 80), type: "function", function: { name, arguments: args } });
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
        tool_call_id: row.tool_call_id.slice(0, 80),
        content: row.content.slice(0, MAX_TOOL_RESULT_CHARS),
      });
    } else {
      return null;
    }
  }
  return result;
}

function systemPrompt(style: "standaard" | "diep", context: string, toolsEnabled: boolean): string {
  const depth =
    style === "diep"
      ? "Geef een diepgaand, diagnostisch antwoord met oorzaken, verbanden en concrete vervolgacties (max ±10 zinnen)."
      : "Antwoord kort en zakelijk in 2-4 zinnen met de kern en één concreet advies.";

  const acties = toolsEnabled
    ? [
        "",
        "ACTIES (registratie Medewerkers & middelen) — CONCEPT-WERKWIJZE:",
        "Je kunt met tools de handmatige registratie bijwerken: middelen (auto, tankpas, sleutel, telefoon, laptop, gebouwtoegang) toewijzen of innemen, functie/talen/teamtags/notities zetten, medewerkers/teams/locaties toevoegen of verwijderen en inventarisaantallen (behandelkamers, boeken, diagnostiek, laptops op voorraad) aanpassen.",
        "Tool-aanroepen worden als CONCEPT klaargezet en pas opgeslagen nadat de gebruiker het concept in het canvas goedkeurt (Toepassen). Sluit een actiebeurt daarom altijd af met de melding dat het concept in het canvas klaarstaat ter beoordeling.",
        "Voer alleen acties uit waar de gebruiker expliciet om vraagt; nooit op eigen initiatief. Is er al een OPENSTAAND CONCEPT (zie context), dan bouwen nieuwe acties daarop voort — zo kan de gebruiker het concept via de chat laten aanpassen vóór goedkeuring.",
        "ALLE medewerkers = de velden `medewerkers` PLUS `bronMedewerkersZonderRegistratie` in de registratie-context (totaal = aantalMedewerkersTotaal) — de productie-toplijst elders in de context bevat alleen de 10 grootste caseloads en is NIET de volledige lijst.",
        "Voor verzoeken over 'iedereen'/'elke medewerker' of meerdere personen gebruik je de bulk-tools (wijzig_taal_bulk, wijzig_middel_bulk): met iedereen=true is volledige dekking gegarandeerd in één aanroep. Sluit een bulkbeurt pas af wanneer je dekking overeenkomt met aantalMedewerkersTotaal.",
        "Gebruik lees_middelen_registratie als je een naam of de huidige stand niet zeker weet; verzin nooit namen. Bij een dubbelzinnige naam vraag je de gebruiker welke persoon bedoeld wordt.",
        "Vraagt de gebruiker om een voorzet op basis van aannames (bijvoorbeeld een tweede taal inschatten op basis van de naam), zet die dan als concept klaar en benoem duidelijk dat het aannames zijn die de gebruiker vóór goedkeuring via de chat kan laten corrigeren.",
        "Vat aan het einde kort in het Nederlands samen wat er in het concept staat (en wat niet kon, met reden).",
      ]
    : [];

  return [
    "Je bent de Careon AI-assistent van het zorgdashboard Careon Pulse (TGC Groep, Nederlandse GGZ).",
    "Je antwoordt uitsluitend in het Nederlands, professioneel en direct (u-vorm).",
    "Gebruik ALLEEN de cijfers uit de meegeleverde context; verzin of extrapoleer nooit getallen.",
    "Als de vraag buiten de context valt, zeg dat eerlijk en verwijs naar de relevante dashboardpagina.",
    "Naast dit antwoord toont het dashboard automatisch een artefact met de bijbehorende visualisaties; verwijs daar kort naar waar relevant.",
    "Respecteer de 'toelichting'-regels in de context (proxy-definities): benoem waar relevant dat een cijfer een proxy of ondergrens is.",
    depth,
    ...acties,
    "",
    "CONTEXT (JSON, met actieve filters — het veld 'databron' beschrijft welke dataset dit is):",
    context,
  ].join("\n");
}

// NDJSON-regels naar de client: tekst-tokens direct, tool-aanroepen zodra de
// stroom compleet is, afgesloten met een done-regel die de reden draagt.
type WireEvent =
  | { t: "text"; d: string }
  | { t: "tool"; id: string; name: string; args: string }
  | { t: "done"; reason: "stop" | "tool_calls" };

export async function POST(request: Request) {
  if (!isLive()) {
    return new Response("AI is niet geconfigureerd.", { status: 503 });
  }
  if (request.headers.get("x-careon-assistant") !== "1") {
    return new Response("Ongeldige aanvraag.", { status: 401 });
  }

  let body: AssistantRequest;
  try {
    body = (await request.json()) as AssistantRequest;
  } catch {
    return new Response("Ongeldige aanvraag.", { status: 400 });
  }

  const question = (body.question ?? "").slice(0, MAX_QUESTION_CHARS).trim();
  const context = (body.context ?? "").slice(0, MAX_CONTEXT_CHARS);
  const style = body.style === "diep" ? "diep" : "standaard";
  const toolsEnabled = body.tools === true;
  if (!question) {
    return new Response("Lege vraag.", { status: 400 });
  }

  const steps = sanitizeSteps(Array.isArray(body.steps) ? body.steps : []);
  if (steps === null) {
    return new Response("Ongeldige aanvraag.", { status: 400 });
  }

  const history = (body.history ?? [])
    .filter((turn) => (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string")
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, MAX_QUESTION_CHARS) }));

  const upstream = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      temperature: 0.3,
      max_tokens: toolsEnabled ? MAX_OUTPUT_TOKENS_TOOLS : MAX_OUTPUT_TOKENS,
      ...(toolsEnabled ? { tools: MIDDELEN_TOOLS, tool_choice: "auto" } : {}),
      messages: [
        { role: "system", content: systemPrompt(style, context, toolsEnabled) },
        ...history,
        { role: "user", content: question },
        ...steps,
      ],
    }),
    signal: request.signal,
  });

  if (!upstream.ok || !upstream.body) {
    // Never forward provider error bodies (they can include request details).
    return new Response("De AI-dienst is tijdelijk niet beschikbaar.", { status: 502 });
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffered = "";

  // Compat: een client die geen tools:true meestuurt (ouder gebundelde pagina,
  // bijv. een nog niet ververste tab) verwacht platte tekst — die mag nooit
  // rauwe NDJSON-regels in de chat te zien krijgen.
  if (!toolsEnabled) {
    const textStream = upstream.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          buffered += decoder.decode(chunk, { stream: true });
          const lines = buffered.split("\n");
          buffered = lines.pop() ?? "";
          for (const line of lines) {
            const data = line.trim();
            if (!data.startsWith("data:")) continue;
            const payload = data.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
              const token = parsed.choices?.[0]?.delta?.content;
              if (token) {
                controller.enqueue(encoder.encode(token));
              }
            } catch {
              // Ignore malformed keep-alive frames.
            }
          }
        },
      }),
    );
    return new Response(textStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Careon-Assistant-Model": MODEL,
      },
    });
  }

  // Parse OpenAI's SSE en zend NDJSON door. Tool-aanroepen druppelen bij
  // OpenAI als fragmenten per index binnen; we verzamelen ze en zenden ze in
  // de flush als complete regels, gevolgd door de done-regel.
  let finishReason: string | null = null;
  const toolCalls = new Map<number, { id: string; name: string; args: string }>();

  interface DeltaChunk {
    choices?: {
      delta?: {
        content?: string;
        tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
      };
      finish_reason?: string | null;
    }[];
  }

  const emit = (controller: TransformStreamDefaultController<Uint8Array>, event: WireEvent) => {
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
  };

  const handlePayload = (controller: TransformStreamDefaultController<Uint8Array>, payload: string) => {
    const parsed = JSON.parse(payload) as DeltaChunk;
    const choice = parsed.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const token = choice.delta?.content;
    if (token) emit(controller, { t: "text", d: token });
    for (const fragment of choice.delta?.tool_calls ?? []) {
      const call = toolCalls.get(fragment.index) ?? { id: "", name: "", args: "" };
      if (fragment.id) call.id = fragment.id;
      if (fragment.function?.name) call.name += fragment.function.name;
      if (fragment.function?.arguments) call.args += fragment.function.arguments;
      toolCalls.set(fragment.index, call);
    }
  };

  const wireStream = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffered += decoder.decode(chunk, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          const data = line.trim();
          if (!data.startsWith("data:")) continue;
          const payload = data.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            handlePayload(controller, payload);
          } catch {
            // Ignore malformed keep-alive frames.
          }
        }
      },
      flush(controller) {
        const complete = [...toolCalls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, call]) => call)
          .filter((call) => call.id && call.name);
        for (const call of complete) {
          emit(controller, { t: "tool", id: call.id, name: call.name, args: call.args });
        }
        emit(controller, {
          t: "done",
          reason: finishReason === "tool_calls" || complete.length > 0 ? "tool_calls" : "stop",
        });
      },
    }),
  );

  return new Response(wireStream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Careon-Assistant-Model": MODEL,
    },
  });
}
