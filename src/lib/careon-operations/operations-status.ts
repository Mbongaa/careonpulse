export type OperationsWorkerStatus = {
  state: "available" | "offline" | "unknown" | "not_configured" | "unavailable";
  lastSeenAt: string | null;
};

export type OperationsBackupStatus = {
  state: "healthy" | "failed" | "stale" | "unknown" | "disabled" | "misconfigured" | "not_configured" | "unavailable";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
};

export interface CareonOperationsStatus {
  worker: OperationsWorkerStatus;
  backup: OperationsBackupStatus;
}
