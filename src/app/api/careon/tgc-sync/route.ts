import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import type { TgcSyncWorkerAvailability } from "@/lib/careon-production/tgc-sync-jobs";
import {
  createTgcSyncJob,
  getTgcSyncJob,
  getTgcSyncWorkerAvailability,
} from "@/lib/careon-production/tgc-sync-jobs.server";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireCareonSession } from "@/lib/supabase/session.server";

export const runtime = "nodejs";

const UNKNOWN_WORKER: TgcSyncWorkerAvailability = { state: "unknown", lastSeenAt: null };
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

function privateResponse<T extends Response>(response: T): T {
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(name, value);
  return response;
}

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...PRIVATE_HEADERS, ...Object.fromEntries(new Headers(init?.headers).entries()) },
  });
}

function serviceError(status: "not_configured" | "unavailable") {
  return status === "not_configured"
    ? privateJson({ error: "De TGC-koppeling is niet voor deze organisatie geconfigureerd." }, { status: 404 })
    : privateJson({ error: "De importwachtrij is tijdelijk niet beschikbaar." }, { status: 502 });
}

export async function GET(request: Request) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return privateResponse(auth.denied);
  const jobId = new URL(request.url).searchParams.get("jobId")?.trim() || undefined;
  if (jobId && !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return privateJson({ error: "Ongeldig import-ID." }, { status: 400 });
  }
  const [result, workerResult] = await Promise.all([
    getTgcSyncJob(auth.session, jobId),
    getTgcSyncWorkerAvailability(auth.session),
  ]);
  if (result.status !== "ok") return serviceError(result.status);
  return privateJson({ job: result.value, worker: workerResult.status === "ok" ? workerResult.value : UNKNOWN_WORKER });
}

export async function POST(request: Request) {
  // Zelfde rolgrens als de bestaande handmatige productie-import: ieder lid
  // van de eigen organisatie mag een nieuwe volledige snapshot aanvragen.
  const auth = await requireCareonSession();
  if ("denied" in auth) return privateResponse(auth.denied);

  let body: { requestedVia?: unknown };
  try {
    body = await readJsonBodyLimited<{ requestedVia?: unknown }>(request, 2_000);
  } catch (error) {
    if (error instanceof RequestPayloadTooLargeError) {
      return privateJson({ error: "Aanvraag te groot." }, { status: 413 });
    }
    if (!(error instanceof InvalidJsonBodyError)) console.error("TGC sync request body failed", error);
    return privateJson({ error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const requestedVia = body.requestedVia === "assistant" ? "assistant" : "databron";
  const result = await createTgcSyncJob(auth.session, requestedVia);
  if (result.status !== "ok") return serviceError(result.status);
  const workerResult = await getTgcSyncWorkerAvailability(auth.session);

  if (!result.value.reused) {
    scheduleAuditEvent({
      action: "tgc_sync.requested",
      resource: "careon_tgc_sync_jobs",
      resourceId: result.value.job.id,
      orgId: auth.session.orgId,
      userId: auth.session.userId,
      detail: { requestedVia },
    });
  }
  return privateJson(
    { ...result.value, worker: workerResult.status === "ok" ? workerResult.value : UNKNOWN_WORKER },
    { status: result.value.reused ? 200 : 202 },
  );
}
