import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { reconcileEntraLifecycle } from "@/lib/careon-entra/lifecycle.server";

import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization");
  if (!secret || !supplied) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const result = await reconcileEntraLifecycle();
  if (result.status === "disabled") {
    return Response.json({ status: "disabled" }, { headers: { "Cache-Control": "no-store" } });
  }
  if (result.status !== "completed") {
    scheduleAuditEvent({
      action: "org.entra_reconciliation_failed",
      resource: "careon_entra_lifecycle",
      detail: { status: result.status },
    });
    return Response.json(result, { status: result.status === "guarded" ? 409 : 503 });
  }
  const failed = result.actions.filter((action) => !action.success).length;
  scheduleAuditEvent({
    action: failed > 0 ? "org.entra_reconciliation_partial" : "org.entra_reconciliation",
    resource: "careon_entra_lifecycle",
    detail: {
      observed: String(result.observed),
      actions: String(result.actions.length),
      failed: String(failed),
    },
  });
  return Response.json(
    { ...result, status: failed > 0 ? "partial" : "completed", timestamp: new Date().toISOString() },
    { status: failed > 0 ? 502 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
