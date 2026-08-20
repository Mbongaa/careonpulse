import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { createTgcSyncJob, getTgcSyncJob } from "@/lib/careon-production/tgc-sync-jobs.server";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireCareonSession } from "@/lib/supabase/session.server";

export const runtime = "nodejs";

function serviceError(status: "not_configured" | "unavailable") {
  return status === "not_configured"
    ? NextResponse.json({ error: "De TGC-koppeling is niet voor deze organisatie geconfigureerd." }, { status: 404 })
    : NextResponse.json({ error: "De importwachtrij is tijdelijk niet beschikbaar." }, { status: 502 });
}

export async function GET(request: Request) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const jobId = new URL(request.url).searchParams.get("jobId")?.trim() || undefined;
  if (jobId && !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: "Ongeldig import-ID." }, { status: 400 });
  }
  const result = await getTgcSyncJob(auth.session, jobId);
  if (result.status !== "ok") return serviceError(result.status);
  return NextResponse.json({ job: result.value }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  // Zelfde rolgrens als de bestaande handmatige productie-import: ieder lid
  // van de eigen organisatie mag een nieuwe volledige snapshot aanvragen.
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;

  let body: { requestedVia?: unknown };
  try {
    body = await readJsonBodyLimited<{ requestedVia?: unknown }>(request, 2_000);
  } catch (error) {
    if (error instanceof RequestPayloadTooLargeError) {
      return NextResponse.json({ error: "Aanvraag te groot." }, { status: 413 });
    }
    if (!(error instanceof InvalidJsonBodyError)) console.error("TGC sync request body failed", error);
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const requestedVia = body.requestedVia === "assistant" ? "assistant" : "databron";
  const result = await createTgcSyncJob(auth.session, requestedVia);
  if (result.status !== "ok") return serviceError(result.status);

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
  return NextResponse.json(result.value, {
    status: result.value.reused ? 200 : 202,
    headers: { "Cache-Control": "no-store" },
  });
}
