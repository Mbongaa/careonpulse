import { monitorFacturatieBackup } from "@/lib/careon-operations/facturatie-backup-monitor.server";
import { dispatchOperationsAlert } from "@/lib/careon-operations/operations-alerts.server";
import { monitorTgcWorker } from "@/lib/careon-production/tgc-worker-monitor.server";

import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 30;

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization");
  if (!secret || !supplied) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: RESPONSE_HEADERS });
}

export async function GET(request: Request) {
  if (!authorized(request)) return json({ status: "unauthorized" }, 401);

  const result = await monitorTgcWorker();
  if (result.status !== "completed") {
    console.error("TGC worker monitor unavailable", { status: result.status });
    return json(result, result.status === "not_configured" ? 503 : 502);
  }

  const backup = await monitorFacturatieBackup();
  if (backup.status !== "completed" && backup.status !== "disabled") {
    console.error("Facturatie backup monitor unavailable", { status: backup.status });
    return json({ ...result, backup: backup.status, timestamp: new Date().toISOString() }, 502);
  }

  const alert = await dispatchOperationsAlert();
  if (alert.status === "misconfigured" || alert.status === "unavailable" || alert.status === "pending") {
    console.error("Operations alert delivery is not healthy", { status: alert.status });
    return json({ ...result, backup, alert: alert.status, timestamp: new Date().toISOString() }, 502);
  }

  const backupUnhealthy = backup.status === "completed" && backup.state !== "healthy";
  if (result.state !== "available" || backupUnhealthy) {
    console.error("Careon operational dependency is not available", {
      workerState: result.state,
      backupState: backup.status === "completed" ? backup.state : backup.status,
    });
    return json({ ...result, backup, alert: alert.status, timestamp: new Date().toISOString() }, 503);
  }

  return json({ ...result, backup, alert: alert.status, timestamp: new Date().toISOString() }, 200);
}
