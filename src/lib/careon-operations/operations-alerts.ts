import { createHash, timingSafeEqual } from "node:crypto";

const POWER_AUTOMATE_SUFFIX = ".environment.api.powerplatform.com";
const MAX_WEBHOOK_URL_BYTES = 8_192;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{1,251}[a-z0-9])?$/;

export const OPERATIONS_ALERT_SOURCES = ["tgc_worker", "facturatie_backup"] as const;
export const TGC_WORKER_ALERT_STATES = ["available", "offline", "unknown"] as const;
export const FACTURATIE_BACKUP_ALERT_STATES = ["healthy", "failed", "stale", "unknown"] as const;
export const OPERATIONS_ALERT_STATES = [...TGC_WORKER_ALERT_STATES, "healthy", "failed", "stale"] as const;
export const OPERATIONS_ALERT_AGE_BUCKETS = [
  "under_2m",
  "2m_15m",
  "15m_1h",
  "1h_plus",
  "1h_24h",
  "24h_36h",
  "36h_plus",
  "unknown",
] as const;

export type OperationsAlertSource = (typeof OPERATIONS_ALERT_SOURCES)[number];
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
  source: OperationsAlertSource;
  eventType: OperationsAlertEventType;
  state: OperationsAlertState;
  previousState: OperationsAlertState | null;
  ageBucket: OperationsAlertAgeBucket;
  observedAt: string;
  attempt: number;
}

export type FacturatieBackupMonitorConfiguration =
  | { status: "disabled"; required: false }
  | { status: "invalid"; required: boolean; reason: string }
  | { status: "ready"; required: boolean; maximumAgeHours: number };

export interface FacturatieBackupStatusInput {
  lastResult: "healthy" | "failed";
  lastAttemptAt: string;
  lastSuccessAt: string | null;
}

export interface FacturatieBackupObservation {
  state: "healthy" | "failed" | "stale" | "unknown";
  ageBucket: OperationsAlertAgeBucket;
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

export function resolveFacturatieBackupMonitorConfiguration(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
): FacturatieBackupMonitorConfiguration {
  let enabled: boolean;
  let required: boolean;
  try {
    enabled = binaryFlag(environment.CAREON_FACTURATIE_BACKUP_MONITOR_ENABLED, "BACKUP_MONITOR_ENABLED");
    required = binaryFlag(environment.CAREON_FACTURATIE_BACKUP_MONITOR_REQUIRED, "BACKUP_MONITOR_REQUIRED");
  } catch (error) {
    return { status: "invalid", required: false, reason: error instanceof Error ? error.message : "Ongeldige vlag." };
  }
  const rawMaximumAge = environment.CAREON_FACTURATIE_BACKUP_MONITOR_MAX_AGE_HOURS?.trim() || "36";
  const maximumAgeHours = Number(rawMaximumAge);
  if (!Number.isSafeInteger(maximumAgeHours) || maximumAgeHours < 1 || maximumAgeHours > 8_760) {
    return { status: "invalid", required, reason: "Backupmonitorleeftijd moet 1–8760 hele uren zijn." };
  }
  if (required && !enabled) {
    return { status: "invalid", required, reason: "Verplichte Facturatie-backupmonitor is niet ingeschakeld." };
  }
  if (!enabled) return { status: "disabled", required: false };
  return { status: "ready", required, maximumAgeHours };
}

function backupAgeBucket(lastSuccessMs: number | null, nowMs: number): OperationsAlertAgeBucket {
  if (lastSuccessMs === null || lastSuccessMs > nowMs + 60_000) return "unknown";
  const ageMs = Math.max(0, nowMs - lastSuccessMs);
  if (ageMs < 2 * 60_000) return "under_2m";
  if (ageMs < 15 * 60_000) return "2m_15m";
  if (ageMs < 60 * 60_000) return "15m_1h";
  if (ageMs < 24 * 60 * 60_000) return "1h_24h";
  if (ageMs < 36 * 60 * 60_000) return "24h_36h";
  return "36h_plus";
}

export function resolveFacturatieBackupObservation(
  input: FacturatieBackupStatusInput | null,
  maximumAgeHours: number,
  nowMs = Date.now(),
): FacturatieBackupObservation {
  if (!input || !Number.isSafeInteger(maximumAgeHours) || maximumAgeHours < 1 || maximumAgeHours > 8_760) {
    return { state: "unknown", ageBucket: "unknown" };
  }
  const attemptMs = Date.parse(input.lastAttemptAt);
  const successMs = input.lastSuccessAt === null ? null : Date.parse(input.lastSuccessAt);
  if (
    Number.isNaN(attemptMs) ||
    attemptMs > nowMs + 60_000 ||
    (successMs !== null && (Number.isNaN(successMs) || successMs > attemptMs + 30_000)) ||
    (input.lastResult === "healthy" && successMs === null)
  ) {
    return { state: "unknown", ageBucket: "unknown" };
  }
  const ageBucket = backupAgeBucket(successMs, nowMs);
  if (input.lastResult === "failed") return { state: "failed", ageBucket };
  if (successMs === null || nowMs - successMs > maximumAgeHours * 60 * 60_000) {
    return { state: "stale", ageBucket };
  }
  return { state: "healthy", ageBucket };
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
    !OPERATIONS_ALERT_SOURCES.includes(item.source as OperationsAlertSource) ||
    (item.eventType !== "incident" && item.eventType !== "recovery") ||
    !OPERATIONS_ALERT_STATES.includes(item.state as OperationsAlertState) ||
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
  const tgcPair =
    item.source === "tgc_worker" &&
    TGC_WORKER_ALERT_STATES.includes(item.state as (typeof TGC_WORKER_ALERT_STATES)[number]) &&
    (item.previousState === null ||
      TGC_WORKER_ALERT_STATES.includes(item.previousState as (typeof TGC_WORKER_ALERT_STATES)[number])) &&
    ((item.eventType === "incident" && (item.state === "offline" || item.state === "unknown")) ||
      (item.eventType === "recovery" &&
        item.state === "available" &&
        (item.previousState === "offline" || item.previousState === "unknown")));
  const backupPair =
    item.source === "facturatie_backup" &&
    FACTURATIE_BACKUP_ALERT_STATES.includes(item.state as (typeof FACTURATIE_BACKUP_ALERT_STATES)[number]) &&
    (item.previousState === null ||
      FACTURATIE_BACKUP_ALERT_STATES.includes(item.previousState as (typeof FACTURATIE_BACKUP_ALERT_STATES)[number])) &&
    ((item.eventType === "incident" &&
      (item.state === "failed" || item.state === "stale" || item.state === "unknown")) ||
      (item.eventType === "recovery" &&
        item.state === "healthy" &&
        (item.previousState === "failed" || item.previousState === "stale" || item.previousState === "unknown")));
  if (!tgcPair && !backupPair) {
    return null;
  }
  return {
    id: item.id,
    source: item.source as OperationsAlertSource,
    eventType: item.eventType,
    state: item.state as OperationsAlertState,
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
  "1h_24h": "1–24 uur",
  "24h_36h": "24–36 uur",
  "36h_plus": "meer dan 36 uur",
  unknown: "onbekend",
};

export function operationsAlertPayload(alert: OperationsAlert): { text: string } {
  const incident = alert.eventType === "incident";
  const worker = alert.source === "tgc_worker";
  let title: string;
  let status: string;
  if (worker) {
    title = incident ? "TGC-importworker niet bereikbaar" : "TGC-importworker hersteld";
    status = incident
      ? `Status: ${alert.state}. Heartbeatleeftijd: ${AGE_LABELS[alert.ageBucket]}.`
      : `Status: beschikbaar; vorige status: ${alert.previousState}.`;
  } else {
    title = incident ? "Facturatie off-site backup niet gezond" : "Facturatie off-site backup hersteld";
    status = incident
      ? `Status: ${alert.state}. Leeftijd laatste geslaagde backup: ${AGE_LABELS[alert.ageBucket]}.`
      : `Status: gezond; vorige status: ${alert.previousState}.`;
  }
  const destination = worker
    ? "Controleer Databron: https://www.careonpulse.com/dashboard/databron"
    : "Controleer Facturatie: https://www.careonpulse.com/facturatie";
  return {
    text: `Careon Pulse productiealarm — ${title}. ${status} Waargenomen: ${alert.observedAt}. Incident: ${alert.id}. ${destination}`,
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
