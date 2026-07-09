// Live AI endpoint for the Careon assistant.
//
// The OpenAI key lives ONLY here (server-side, via OPENAI_API_KEY in the
// environment) — it is never bundled to the client. The client sends the
// question plus a grounding context built from the deterministic demo
// dataset; the model is instructed to answer in Dutch using only that data.
// Without a configured key the route reports live:false and the client falls
// back to the deterministic demo answers, so the dashboard keeps working.

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const MAX_QUESTION_CHARS = 2000;
const MAX_CONTEXT_CHARS = 24000;
const MAX_HISTORY_TURNS = 8;
const MAX_OUTPUT_TOKENS = 700;

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
}

function systemPrompt(style: "standaard" | "diep", context: string): string {
  const depth =
    style === "diep"
      ? "Geef een diepgaand, diagnostisch antwoord met oorzaken, verbanden en concrete vervolgacties (max ±10 zinnen)."
      : "Antwoord kort en zakelijk in 2-4 zinnen met de kern en één concreet advies.";

  return [
    "Je bent de Careon AI-assistent van het zorgdashboard Careon Pulse (TGC Groep, Nederlandse GGZ).",
    "Je antwoordt uitsluitend in het Nederlands, professioneel en direct (u-vorm).",
    "Gebruik ALLEEN de cijfers uit de meegeleverde context; verzin of extrapoleer nooit getallen.",
    "Als de vraag buiten de context valt, zeg dat eerlijk en verwijs naar de relevante dashboardpagina.",
    "Naast dit antwoord toont het dashboard automatisch een artefact met de bijbehorende visualisaties; verwijs daar kort naar waar relevant.",
    depth,
    "",
    "CONTEXT (JSON, geauditeerde demo-dataset met actieve filters):",
    context,
  ].join("\n");
}

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
  if (!question) {
    return new Response("Lege vraag.", { status: 400 });
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
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: "system", content: systemPrompt(style, context) },
        ...history,
        { role: "user", content: question },
      ],
    }),
    signal: request.signal,
  });

  if (!upstream.ok || !upstream.body) {
    // Never forward provider error bodies (they can include request details).
    return new Response("De AI-dienst is tijdelijk niet beschikbaar.", { status: 502 });
  }

  // Re-stream OpenAI's SSE as plain text tokens.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffered = "";

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
