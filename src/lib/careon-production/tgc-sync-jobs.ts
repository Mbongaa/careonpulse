export const TGC_SYNC_JOB_STATUSES = ["queued", "running", "succeeded", "failed"] as const;

export type TgcSyncJobStatus = (typeof TGC_SYNC_JOB_STATUSES)[number];
export type TgcSyncRequestedVia = "databron" | "assistant" | "scheduled";

export interface TgcSyncEvent {
  at: string;
  stage: string;
  message: string;
  progress: number;
}

export interface TgcSyncResult {
  importedAt?: string;
  clients?: number;
  agendaRows?: number;
  referrerRows?: number;
  surchargeRows?: number;
  declarationRows?: number;
  lastFullMonth?: string;
}

export interface TgcSyncJob {
  id: string;
  orgId: string;
  requestedVia: TgcSyncRequestedVia;
  status: TgcSyncJobStatus;
  stage: string;
  message: string;
  progress: number;
  events: TgcSyncEvent[];
  result: TgcSyncResult;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export type TgcSyncWorkerState = "available" | "offline" | "unknown";

export const TGC_WORKER_MONITOR_ACTIONS = ["tgc_worker.available", "tgc_worker.offline", "tgc_worker.unknown"] as const;

export type TgcWorkerMonitorAction = (typeof TGC_WORKER_MONITOR_ACTIONS)[number];
export type TgcWorkerAgeBucket = "under_2m" | "2m_15m" | "15m_1h" | "1h_plus" | "unknown";

export interface TgcSyncWorkerAvailability {
  state: TgcSyncWorkerState;
  lastSeenAt: string | null;
}

export const TGC_WORKER_ONLINE_WINDOW_MS = 90_000;

export function resolveTgcWorkerAvailability(
  lastSeenAt: string | null | undefined,
  nowMs = Date.now(),
): TgcSyncWorkerAvailability {
  if (!lastSeenAt) return { state: "unknown", lastSeenAt: null };
  const seenMs = Date.parse(lastSeenAt);
  if (!Number.isFinite(seenMs) || seenMs > nowMs + 30_000) {
    return { state: "unknown", lastSeenAt: null };
  }
  return {
    state: nowMs - seenMs <= TGC_WORKER_ONLINE_WINDOW_MS ? "available" : "offline",
    lastSeenAt,
  };
}

export function tgcWorkerMonitorAction(state: TgcSyncWorkerState): TgcWorkerMonitorAction {
  return `tgc_worker.${state}`;
}

export function tgcWorkerStateFromMonitorAction(action: string | null | undefined): TgcSyncWorkerState | null {
  if (!action || !TGC_WORKER_MONITOR_ACTIONS.includes(action as TgcWorkerMonitorAction)) return null;
  return action.slice("tgc_worker.".length) as TgcSyncWorkerState;
}

export function resolveTgcWorkerAgeBucket(
  lastSeenAt: string | null | undefined,
  nowMs = Date.now(),
): TgcWorkerAgeBucket {
  if (!lastSeenAt) return "unknown";
  const seenMs = Date.parse(lastSeenAt);
  if (!Number.isFinite(seenMs) || seenMs > nowMs + 30_000) return "unknown";
  const ageMs = Math.max(0, nowMs - seenMs);
  if (ageMs < 2 * 60_000) return "under_2m";
  if (ageMs < 15 * 60_000) return "2m_15m";
  if (ageMs < 60 * 60_000) return "15m_1h";
  return "1h_plus";
}

export function tgcWorkerStateChanged(previousAction: string | null | undefined, state: TgcSyncWorkerState): boolean {
  return tgcWorkerStateFromMonitorAction(previousAction) !== state;
}

const UPDATE_ACTION =
  /\b(update|updaten|bijwerk(?:en|t)?|werk\b.{0,60}\bbij|ververs(?:en|t)?|actualiseer|refresh|synchroniseer|sync)\b/i;
const IMPORT_SOURCE =
  /\b(tgc|epd|exports?|imports?|databron|dashboard[- ]?data|dashboardgegevens|productiegegevens|productiedata)\b/i;

/**
 * Deterministic assistant routing: an explicit refresh request must enqueue
 * immediately and may not depend on a model deciding whether to call a tool.
 */
export function isTgcImportUpdateRequest(text: string): boolean {
  return UPDATE_ACTION.test(text) && IMPORT_SOURCE.test(text);
}

export function clampTgcSyncProgress(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}
