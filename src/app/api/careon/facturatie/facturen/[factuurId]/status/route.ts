import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import {
  factuurVanRij,
  haalFactuurRij,
  serviceFactuurUpdate,
  storageBeschikbaar,
} from "@/lib/careon-facturatie/facturatie.server";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

export const runtime = "nodejs";

const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

// Handmatige statusvoortgang (handoff 15 §4.3): de beheerder moet dag 1 zien
// welke facturen openstaan. Uitsluitend administratieve overgangen; de
// factuurinhoud is bevroren (DB-trigger). Deze update loopt via de
// service-role — de concept-only RLS-policy blokkeert caller-JWT-writes op
// uitgereikte facturen bewust (handoff 15 §2.4).
const OVERGANGEN: Record<string, string[]> = {
  verzonden: ["definitief"],
  betaald: ["definitief", "verzonden"],
};

interface StatusBody {
  status: "verzonden" | "betaald";
  betaaldOp?: string;
}

function isStatusBody(value: unknown): value is StatusBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    (body.status === "verzonden" || body.status === "betaald") &&
    (body.betaaldOp === undefined || (typeof body.betaaldOp === "string" && ISO_DATUM.test(body.betaaldOp)))
  );
}

export async function POST(request: Request, context: { params: Promise<{ factuurId: string }> }) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;
  const { factuurId } = await context.params;

  let body: unknown;
  try {
    body = await readJsonBodyLimited<unknown>(request, 5_000);
  } catch (error) {
    const status = error instanceof RequestPayloadTooLargeError ? 413 : 400;
    if (!(error instanceof RequestPayloadTooLargeError) && !(error instanceof InvalidJsonBodyError)) {
      console.error("Facturatie body read failed", error);
    }
    return NextResponse.json({ error: status === 413 ? "Payload te groot." : "Ongeldige JSON." }, { status });
  }
  if (!isStatusBody(body)) {
    return NextResponse.json({ error: "Ongeldige statuswijziging." }, { status: 400 });
  }
  if (!storageBeschikbaar()) {
    return NextResponse.json({ error: "Authenticatie is niet geconfigureerd." }, { status: 503 });
  }

  try {
    const rij = await haalFactuurRij(session, factuurId);
    if (!rij) {
      return NextResponse.json({ error: "Deze factuur bestaat niet (meer) voor deze organisatie." }, { status: 404 });
    }
    if (!OVERGANGEN[body.status].includes(rij.status)) {
      return NextResponse.json(
        { error: `Deze factuur kan vanuit status "${rij.status}" niet naar "${body.status}".` },
        { status: 409 },
      );
    }

    const patch: Record<string, unknown> = { status: body.status };
    if (body.status === "betaald") {
      patch.betaald_op = body.betaaldOp ?? new Date().toISOString().slice(0, 10);
    }
    const bijgewerkt = await serviceFactuurUpdate(session.orgId as string, factuurId, patch);
    if (!bijgewerkt) throw new Error("storage-unavailable");

    scheduleAuditEvent({
      action: `facturatie.factuur.${body.status}`,
      resource: "careon_facturatie_facturen",
      resourceId: factuurId,
      orgId: session.orgId,
      userId: session.userId,
      detail: { nummer: bijgewerkt.nummer },
    });
    return NextResponse.json({ configured: true, factuur: factuurVanRij(bijgewerkt) });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}
