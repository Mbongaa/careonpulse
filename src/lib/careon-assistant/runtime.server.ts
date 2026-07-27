import { createHmac, randomUUID } from "node:crypto";

export const ASSISTANT_PROMPT_VERSION = "careon-assistant-2026-07-25.3";
export const ASSISTANT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini-2024-07-18";
export const ASSISTANT_API_MODE = process.env.OPENAI_API_MODE === "chat" ? "chat" : "responses";
export const OPENAI_API_BASE_URL = (process.env.OPENAI_API_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");

const REQUEST_TIMEOUT_MS = envInt("CAREON_ASSISTANT_TIMEOUT_MS", 45_000, 5_000, 120_000);
const DATABASE_TIMEOUT_MS = envInt("CAREON_ASSISTANT_DATABASE_TIMEOUT_MS", 6_000, 2_500, 15_000);
const MAX_RETRIES = envInt("CAREON_ASSISTANT_MAX_RETRIES", 2, 0, 4);
const RATE_LIMIT_PER_MINUTE = envInt("CAREON_ASSISTANT_RATE_LIMIT_PER_MINUTE", 20, 1, 500);
const RATE_LIMIT_PER_DAY = envInt("CAREON_ASSISTANT_RATE_LIMIT_PER_DAY", 500, 1, 100_000);
const AUDIT_RATE_LIMIT_PER_MINUTE = envInt("CAREON_ASSISTANT_AUDIT_RATE_LIMIT_PER_MINUTE", 60, 1, 1_000);
const AUDIT_RATE_LIMIT_PER_DAY = envInt("CAREON_ASSISTANT_AUDIT_RATE_LIMIT_PER_DAY", 2_000, 1, 100_000);
const LOGIN_RATE_LIMIT_PER_MINUTE = envInt("CAREON_LOGIN_RATE_LIMIT_PER_MINUTE", 10, 1, 100);
const LOGIN_RATE_LIMIT_PER_DAY = envInt("CAREON_LOGIN_RATE_LIMIT_PER_DAY", 150, 1, 10_000);
const EVENT_RETENTION_DAYS = envInt("CAREON_ASSISTANT_EVENT_RETENTION_DAYS", 90, 7, 365);
const MAX_MEMORY_RATE_LIMIT_ACTORS = 10_000;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const memoryRequests = new Map<string, number[]>();
let lastPruneAt = 0;

export type AssistantEventType =
  | "request_started"
  | "request_completed"
  | "request_failed"
  | "request_blocked"
  | "concept_applied"
  | "concept_rejected"
  | "sync_write"
  | "sync_conflict";

export interface AssistantUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AssistantEvent {
  requestId: string;
  actorHash: string;
  eventType: AssistantEventType;
  model?: string;
  statusCode?: number;
  durationMs?: number;
  usage?: AssistantUsage;
  toolNames?: string[];
  metadata?: Record<string, string | number | boolean | null>;
  /** Echte identiteit (Supabase-modus); oude rijen kennen alleen actor_hash. */
  orgId?: string | null;
  userId?: string | null;
}

function envInt(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function supabaseHeaders(extra?: HeadersInit): HeadersInit {
  return {
    apikey: SERVICE_KEY as string,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export function isAssistantLive(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && process.env.CAREON_ASSISTANT_LIVE !== "0";
}

export function createAssistantRequestId(): string {
  return randomUUID();
}

function actorHash(principal: string): string {
  const salt =
    process.env.CAREON_ASSISTANT_SAFETY_SALT ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.OPENAI_API_KEY ??
    "careon-local-development";
  return createHmac("sha256", salt).update(principal).digest("hex").slice(0, 32);
}

function visitorPrincipal(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("user-agent") ||
    "unknown"
  );
}

export function assistantActorHash(request: Request): string {
  const session = request.headers.get("x-careon-session")?.trim();
  const stableSession = session && /^[A-Za-z0-9._-]{16,80}$/.test(session) ? session : null;
  return actorHash(`assistant:${stableSession || visitorPrincipal(request)}`);
}

export function loginActorHash(request: Request): string {
  return actorHash(`login:${visitorPrincipal(request)}`);
}

export function authenticatedActorHash(userId: string): string {
  return actorHash(`user:${userId}`);
}

type RateLimitScope = "assistant" | "audit" | "login";

interface RemoteRateLimitRow {
  allowed?: boolean;
  retry_after_seconds?: number;
}

async function consumeRemoteQuota(
  scope: RateLimitScope,
  actorHash: string,
  limitPerMinute: number,
  limitPerDay: number,
): Promise<RemoteRateLimitRow | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/careon_consume_assistant_quota`, {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({
        p_scope: scope,
        p_actor_hash: actorHash,
        p_minute_limit: limitPerMinute,
        p_day_limit: limitPerDay,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(DATABASE_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("Assistant quota RPC failed", { status: response.status, scope });
      return null;
    }
    return (await response.json()) as RemoteRateLimitRow;
  } catch (error) {
    console.error("Assistant quota RPC unavailable", { scope, error });
    return null;
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  limitPerMinute: number;
  limitPerDay: number;
  source: "database" | "memory" | "unavailable";
}

async function consumeMemoryQuota(
  scope: RateLimitScope,
  actorHash: string,
  limitPerMinute: number,
  limitPerDay: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const dayAgo = now - 86_400_000;
  const minuteAgo = now - 60_000;
  const key = `${scope}:${actorHash}`;
  const recent = (memoryRequests.get(key) ?? []).filter((timestamp) => timestamp >= dayAgo);
  const memoryMinute = recent.filter((timestamp) => timestamp >= minuteAgo).length;

  if (memoryMinute >= limitPerMinute || recent.length >= limitPerDay) {
    return {
      allowed: false,
      retryAfterSeconds: memoryMinute >= limitPerMinute ? 60 : 3_600,
      limitPerMinute,
      limitPerDay,
      source: "memory",
    };
  }
  recent.push(now);
  if (!memoryRequests.has(key) && memoryRequests.size >= MAX_MEMORY_RATE_LIMIT_ACTORS) {
    const oldestActor = memoryRequests.keys().next().value;
    if (oldestActor) memoryRequests.delete(oldestActor);
  }
  memoryRequests.set(key, recent);
  return {
    allowed: true,
    retryAfterSeconds: 0,
    limitPerMinute,
    limitPerDay,
    source: "memory",
  };
}

async function enforceRateLimit(
  scope: RateLimitScope,
  actorHash: string,
  limitPerMinute: number,
  limitPerDay: number,
): Promise<RateLimitResult> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return consumeMemoryQuota(scope, actorHash, limitPerMinute, limitPerDay);
  }
  const remote = await consumeRemoteQuota(scope, actorHash, limitPerMinute, limitPerDay);
  if (!remote || typeof remote.allowed !== "boolean") {
    // A configured production database is the shared source of truth. Falling
    // back per-instance would make quotas bypassable during partial outages.
    return {
      allowed: false,
      retryAfterSeconds: 30,
      limitPerMinute,
      limitPerDay,
      source: "unavailable",
    };
  }
  return {
    allowed: remote.allowed,
    retryAfterSeconds: Math.max(0, Math.min(86_400, Number(remote.retry_after_seconds) || 0)),
    limitPerMinute,
    limitPerDay,
    source: "database",
  };
}

export function enforceAssistantRateLimit(actorHash: string): Promise<RateLimitResult> {
  return enforceRateLimit("assistant", actorHash, RATE_LIMIT_PER_MINUTE, RATE_LIMIT_PER_DAY);
}

export function enforceAssistantAuditRateLimit(actorHash: string): Promise<RateLimitResult> {
  return enforceRateLimit("audit", actorHash, AUDIT_RATE_LIMIT_PER_MINUTE, AUDIT_RATE_LIMIT_PER_DAY);
}

/**
 * Inloglimiet per gehasht bezoekers-IP (handoff 13, migratie 0013): alle
 * logins bereiken Supabase vanaf het server-IP, dus zonder eigen limiet is er
 * geen bescherming per aanvaller tegen brute force.
 */
export function enforceLoginRateLimit(actorHash: string): Promise<RateLimitResult> {
  return enforceRateLimit("login", actorHash, LOGIN_RATE_LIMIT_PER_MINUTE, LOGIN_RATE_LIMIT_PER_DAY);
}

export async function writeAssistantEvent(event: AssistantEvent): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  const payload = {
    request_id: event.requestId,
    actor_hash: event.actorHash,
    event_type: event.eventType,
    model: event.model ?? null,
    api_mode: ASSISTANT_API_MODE,
    prompt_version: ASSISTANT_PROMPT_VERSION,
    status_code: event.statusCode ?? null,
    duration_ms: event.durationMs ?? null,
    input_tokens: event.usage?.inputTokens ?? null,
    output_tokens: event.usage?.outputTokens ?? null,
    total_tokens: event.usage?.totalTokens ?? null,
    tool_names: event.toolNames ?? [],
    metadata: event.metadata ?? {},
    org_id: event.orgId ?? null,
    user_id: event.userId ?? null,
  };
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/careon_assistant_events`, {
      method: "POST",
      headers: supabaseHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2_500),
    });
  } catch {
    // Telemetry is best-effort and must never break the user request.
  }
}

export async function pruneAssistantEvents(): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY || Date.now() - lastPruneAt < 86_400_000) return;
  lastPruneAt = Date.now();
  const before = new Date(Date.now() - EVENT_RETENTION_DAYS * 86_400_000).toISOString();
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/careon_assistant_events?created_at=lt.${encodeURIComponent(before)}`, {
      method: "DELETE",
      headers: supabaseHeaders({ Prefer: "return=minimal" }),
      signal: AbortSignal.timeout(2_500),
    });
  } catch {
    // A failed retention sweep is retried after the next process cold start.
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchOpenAIWithRetry(
  url: string,
  init: RequestInit,
  requestSignal: AbortSignal,
): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("OpenAI request timeout")), REQUEST_TIMEOUT_MS);
    const abort = () => controller.abort(requestSignal.reason);
    requestSignal.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      lastResponse = response;
      if (![408, 409, 429, 500, 502, 503, 504].includes(response.status) || attempt === MAX_RETRIES) {
        return response;
      }
      await response.body?.cancel();
    } catch (error) {
      if (requestSignal.aborted || attempt === MAX_RETRIES) throw error;
    } finally {
      clearTimeout(timeout);
      requestSignal.removeEventListener("abort", abort);
    }
    await wait(250 * 2 ** attempt + Math.floor(Math.random() * 150), requestSignal);
  }
  if (lastResponse) return lastResponse;
  throw new Error("OpenAI request failed");
}

export type ModerationResult = "allowed" | "flagged" | "unavailable";

export async function moderateAssistantQuestion(
  question: string,
  requestSignal: AbortSignal,
): Promise<ModerationResult> {
  if (process.env.OPENAI_MODERATION_ENABLED === "0") return "allowed";
  try {
    const response = await fetchOpenAIWithRetry(
      `${OPENAI_API_BASE_URL}/moderations`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ model: "omni-moderation-latest", input: question }),
      },
      requestSignal,
    );
    if (!response.ok) return "unavailable";
    const payload = (await response.json()) as { results?: { flagged?: boolean }[] };
    return payload.results?.some((result) => result.flagged === true) ? "flagged" : "allowed";
  } catch {
    return "unavailable";
  }
}
