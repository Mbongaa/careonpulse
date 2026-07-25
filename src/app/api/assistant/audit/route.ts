import {
  ASSISTANT_MODEL,
  assistantActorHash,
  createAssistantRequestId,
  enforceAssistantAuditRateLimit,
  writeAssistantEvent,
} from "@/lib/careon-assistant/runtime.server";
import { MIDDELEN_TOOL_NAMES } from "@/lib/careon-middelen/assistant-tools";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";

export const runtime = "nodejs";

interface AuditRequest {
  decision?: "applied" | "rejected";
  requestIds?: unknown;
  toolNames?: unknown;
  successful?: unknown;
  failed?: unknown;
  destructive?: unknown;
}

export async function POST(request: Request) {
  if (request.headers.get("x-careon-assistant") !== "1") {
    return new Response("Ongeldige aanvraag.", { status: 401 });
  }
  const actorHash = assistantActorHash(request);
  const limit = await enforceAssistantAuditRateLimit(actorHash);
  if (!limit.allowed) {
    return new Response(
      limit.source === "unavailable"
        ? "De gedeelde aanvraaglimiet is tijdelijk niet beschikbaar."
        : "Te veel audit-aanvragen.",
      {
        status: limit.source === "unavailable" ? 503 : 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }
  let body: AuditRequest;
  try {
    body = await readJsonBodyLimited<AuditRequest>(request, 12_000);
  } catch (error) {
    if (error instanceof RequestPayloadTooLargeError) {
      return new Response("Aanvraag te groot.", { status: 413 });
    }
    if (!(error instanceof InvalidJsonBodyError)) {
      console.error("Assistant audit body read failed", error);
    }
    return new Response("Ongeldige aanvraag.", { status: 400 });
  }
  if (body.decision !== "applied" && body.decision !== "rejected") {
    return new Response("Ongeldige aanvraag.", { status: 400 });
  }
  const requestIds = Array.isArray(body.requestIds)
    ? body.requestIds.filter((value): value is string => typeof value === "string").slice(0, 12)
    : [];
  const toolNames = Array.isArray(body.toolNames)
    ? [
        ...new Set(
          body.toolNames.filter(
            (value): value is string =>
              typeof value === "string" && (MIDDELEN_TOOL_NAMES as readonly string[]).includes(value),
          ),
        ),
      ]
    : [];
  const count = (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) ? Math.max(0, Math.min(1_000, value)) : 0;
  const auditId = createAssistantRequestId();
  await writeAssistantEvent({
    requestId: auditId,
    actorHash,
    eventType: body.decision === "applied" ? "concept_applied" : "concept_rejected",
    model: ASSISTANT_MODEL,
    statusCode: 200,
    toolNames,
    metadata: {
      linkedRequests: requestIds.length,
      successful: count(body.successful),
      failed: count(body.failed),
      destructive: count(body.destructive),
    },
  });
  return Response.json({ recorded: true, auditId }, { headers: { "Cache-Control": "no-store" } });
}
