import { NextResponse } from "next/server";

import { wisQuota } from "@/lib/careon-admin/admin.server";
import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { InvalidJsonBodyError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireSuperadmin } from "@/lib/supabase/session.server";

// Beheer: een rate-limit-emmer leegmaken. De dagemmer per gehasht bezoekers-IP
// loopt tot middernacht UTC door, dus een praktijk achter één NAT die het
// dagplafond raakte kon tot dan niet meer inloggen én geen wachtwoordlink
// verzilveren — herstel vroeg SQL of een hogere limiet plus een deploy.
// Service-role uitsluitend ná de superadmin-check; elke wis wordt geauditeerd.

export const runtime = "nodejs";

// Dezelfde waarden als de check-constraint (0008/0013/0016).
const SCOPES = ["assistant", "audit", "login", "login_account"];
const ACTOR_PATTERN = /^[0-9a-f]{32}$/;

export async function DELETE(request: Request) {
  const auth = await requireSuperadmin();
  if ("denied" in auth) return auth.denied;

  let body: { scope?: unknown; actorHash?: unknown };
  try {
    body = await readJsonBodyLimited<{ scope?: unknown; actorHash?: unknown }>(request, 10_000);
  } catch (error) {
    if (!(error instanceof InvalidJsonBodyError)) {
      console.error("Admin rate-limit body read failed", error);
    }
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const scope = typeof body.scope === "string" ? body.scope : "";
  const actorHash = typeof body.actorHash === "string" ? body.actorHash.toLowerCase() : "";
  if (!SCOPES.includes(scope) || !ACTOR_PATTERN.test(actorHash)) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const uitkomst = await wisQuota(scope, actorHash);
  if (!uitkomst.ok) {
    return NextResponse.json({ error: "Limiet kon niet worden gewist." }, { status: 502 });
  }
  if (!uitkomst.data) {
    // Al verlopen of net weggeprund: geen fout, wel eerlijk melden.
    return NextResponse.json({ ok: true, gewist: false });
  }

  scheduleAuditEvent({
    action: "admin.rate_limit.clear",
    resource: "careon_assistant_rate_limits",
    // De actorhash is gezouten en niet herleidbaar tot een persoon of IP; hij
    // staat hier zodat de wis aan de juiste emmer te koppelen is.
    resourceId: actorHash,
    userId: auth.session.userId,
    detail: { scope },
  });
  return NextResponse.json({ ok: true, gewist: true });
}
