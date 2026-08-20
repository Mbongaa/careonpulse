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
