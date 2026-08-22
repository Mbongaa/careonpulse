import { createHash, timingSafeEqual } from "node:crypto";

const POWER_AUTOMATE_SUFFIX = ".environment.api.powerplatform.com";
const MAX_WEBHOOK_URL_BYTES = 8_192;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{1,251}[a-z0-9])?$/;

export const OPERATIONS_ALERT_STATES = ["available", "offline", "unknown"] as const;
export const OPERATIONS_ALERT_AGE_BUCKETS = ["under_2m", "2m_15m", "15m_1h", "1h_plus", "unknown"] as const;

export type OperationsAlertState = (typeof OPERATIONS_ALERT_STATES)[number];
export type OperationsAlertAgeBucket = (typeof OPERATIONS_ALERT_AGE_BUCKETS)[number];
export type OperationsAlertEventType = "incident" | "recovery";

export type OperationsAlertConfiguration =
  | { status: "disabled"; required: false }
  | { status: "invalid"; required: boolean; reason: string }
  | {
      status: "ready";
      required: boolean;
      webhookUrl: string;
    };

export interface OperationsAlert {
  id: string;
  eventType: OperationsAlertEventType;
  workerState: OperationsAlertState;
  previousState: OperationsAlertState | null;
  ageBucket: OperationsAlertAgeBucket;
  observedAt: string;
  attempt: number;
}

function binaryFlag(value: string | undefined, name: string): boolean {
  const normalized = value?.trim() || "0";
  if (normalized !== "0" && normalized !== "1") throw new Error(`${name} moet 0 of 1 zijn.`);
  return normalized === "1";
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validateWebhook(rawUrl: string, expectedHost: string, expectedDigest: string): string | null {
  if (
    Buffer.byteLength(rawUrl, "utf8") > MAX_WEBHOOK_URL_BYTES ||
    !HOST_PATTERN.test(expectedHost) ||
    expectedHost.includes("..") ||
    !expectedHost.endsWith(POWER_AUTOMATE_SUFFIX) ||
    !SHA256_PATTERN.test(expectedDigest)
  ) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== expectedHost ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    !url.pathname.startsWith("/powerautomate/automations/direct/") ||
    !url.pathname.includes("/workflows/") ||
    !url.pathname.includes("/triggers/") ||
    !url.pathname.endsWith("/paths/invoke")
  ) {
    return null;
  }
  for (const key of ["api-version", "sp", "sv", "sig"]) {
    const values = url.searchParams.getAll(key);
    if (values.length !== 1 || values[0].trim() === "") return null;
  }
  return safeEqual(sha256(rawUrl), expectedDigest) ? rawUrl : null;
}

export function resolveOperationsAlertConfiguration(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
): OperationsAlertConfiguration {
  let enabled: boolean;
  let required: boolean;
  try {
    enabled = binaryFlag(environment.CAREON_OPERATIONS_ALERT_TEAMS_ENABLED, "TEAMS_ENABLED");
    required = binaryFlag(environment.CAREON_OPERATIONS_ALERT_TEAMS_REQUIRED, "TEAMS_REQUIRED");
  } catch (error) {
    return { status: "invalid", required: false, reason: error instanceof Error ? error.message : "Ongeldige vlag." };
  }
  const rawUrl = environment.CAREON_OPERATIONS_ALERT_TEAMS_WEBHOOK_URL?.trim() || "";
  const expectedHost = environment.CAREON_OPERATIONS_ALERT_TEAMS_WEBHOOK_HOST?.trim().toLowerCase() || "";
  const expectedDigest = environment.CAREON_OPERATIONS_ALERT_TEAMS_WEBHOOK_SHA256?.trim().toLowerCase() || "";
  const configured = [rawUrl, expectedHost, expectedDigest].filter(Boolean).length;
  if (required && !enabled) {
    return { status: "invalid", required, reason: "Verplichte Teams-alarmering is niet ingeschakeld." };
  }
  if (configured !== 0 && configured !== 3) {
    return { status: "invalid", required, reason: "Teams-workflowconfiguratie is gedeeltelijk." };
  }
  if (enabled && configured !== 3) {
    return { status: "invalid", required, reason: "Complete Teams-workflowconfiguratie ontbreekt." };
  }
  if (configured === 3 && !validateWebhook(rawUrl, expectedHost, expectedDigest)) {
    return { status: "invalid", required, reason: "Teams-workflowbestemming voldoet niet aan het vaste contract." };
  }
  if (!enabled) return { status: "disabled", required: false };
  return { status: "ready", required, webhookUrl: rawUrl };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseOperationsAlert(value: unknown): OperationsAlert | null {
  const item = record(value);
  if (!item) return null;
  if (
    typeof item.id !== "string" ||
    !UUID_V4_PATTERN.test(item.id) ||
    (item.eventType !== "incident" && item.eventType !== "recovery") ||
    !OPERATIONS_ALERT_STATES.includes(item.workerState as OperationsAlertState) ||
    (item.previousState !== null && !OPERATIONS_ALERT_STATES.includes(item.previousState as OperationsAlertState)) ||
    !OPERATIONS_ALERT_AGE_BUCKETS.includes(item.ageBucket as OperationsAlertAgeBucket) ||
    typeof item.observedAt !== "string" ||
    Number.isNaN(Date.parse(item.observedAt)) ||
    !Number.isSafeInteger(item.attempt) ||
    (item.attempt as number) < 1 ||
    (item.attempt as number) > 10_000
  ) {
    return null;
  }
  if (
    (item.eventType === "incident" && item.workerState !== "offline" && item.workerState !== "unknown") ||
    (item.eventType === "recovery" &&
      (item.workerState !== "available" || (item.previousState !== "offline" && item.previousState !== "unknown")))
  ) {
    return null;
  }
  return {
    id: item.id,
    eventType: item.eventType,
    workerState: item.workerState as OperationsAlertState,
    previousState: item.previousState as OperationsAlertState | null,
    ageBucket: item.ageBucket as OperationsAlertAgeBucket,
    observedAt: new Date(item.observedAt).toISOString(),
    attempt: item.attempt as number,
  };
}

const AGE_LABELS: Record<OperationsAlertAgeBucket, string> = {
  under_2m: "minder dan 2 minuten",
  "2m_15m": "2–15 minuten",
  "15m_1h": "15–60 minuten",
  "1h_plus": "meer dan 1 uur",
  unknown: "onbekend",
};

export function operationsAlertPayload(alert: OperationsAlert): { text: string } {
  const incident = alert.eventType === "incident";
  const title = incident ? "TGC-importworker niet bereikbaar" : "TGC-importworker hersteld";
  const status = incident
    ? `Status: ${alert.workerState}. Heartbeatleeftijd: ${AGE_LABELS[alert.ageBucket]}.`
    : `Status: beschikbaar; vorige status: ${alert.previousState}.`;
  return {
    text: `Careon Pulse productiealarm — ${title}. ${status} Waargenomen: ${alert.observedAt}. Incident: ${alert.id}. Controleer Databron: https://www.careonpulse.com/dashboard/databron`,
  };
}

export function serializedOperationsAlertPayload(alert: OperationsAlert): string {
  const payload = JSON.stringify(operationsAlertPayload(alert));
  if (Buffer.byteLength(payload, "utf8") > 2_048) throw new Error("Operations-alertpayload is te groot.");
  return payload;
}

export function operationsAlertWebhookDigest(url: string): string {
  return sha256(url.trim());
}
