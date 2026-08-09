import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import {
  conceptRijVanFactuur,
  FACTUUR_SELECT,
  type FactuurRij,
  factuurVanRij,
  haalFactuurRij,
} from "@/lib/careon-facturatie/facturatie.server";
import { berekenTotalen } from "@/lib/careon-facturatie/totalen";
import { type Factuur, isFactuur } from "@/lib/careon-facturatie/types";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 400_000;

interface SaveBody {
  factuur: Factuur;
  baseUpdatedAt: string;
}

function isSaveBody(value: unknown): value is SaveBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return isFactuur(body.factuur) && typeof body.baseUpdatedAt === "string" && body.baseUpdatedAt.length > 0;
}

export async function GET(_request: Request, context: { params: Promise<{ factuurId: string }> }) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const { factuurId } = await context.params;

  try {
    const rij = await haalFactuurRij(auth.session, factuurId);
    if (!rij) {
      return NextResponse.json({ error: "Deze factuur bestaat niet (meer) voor deze organisatie." }, { status: 404 });
    }
    return NextResponse.json({ configured: true, factuur: factuurVanRij(rij) });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}

/** Autosave van een concept, met updated_at-conflictdetectie (handoff 15 §4.3).
    Totalen worden hier server-side herrekend — client-getallen tellen nooit. */
export async function PATCH(request: Request, context: { params: Promise<{ factuurId: string }> }) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;
  const { factuurId } = await context.params;

  let body: unknown;
  try {
    body = await readJsonBodyLimited<unknown>(request, MAX_BODY_BYTES);
  } catch (error) {
    const status = error instanceof RequestPayloadTooLargeError ? 413 : 400;
    if (!(error instanceof RequestPayloadTooLargeError) && !(error instanceof InvalidJsonBodyError)) {
      console.error("Facturatie body read failed", error);
    }
    return NextResponse.json({ error: status === 413 ? "Payload te groot." : "Ongeldige JSON." }, { status });
  }
  if (!isSaveBody(body)) {
    return NextResponse.json({ error: "Ongeldige of onvolledige factuur." }, { status: 400 });
  }

  try {
    const huidig = await haalFactuurRij(session, factuurId);
    if (!huidig) {
      return NextResponse.json({ error: "Deze factuur bestaat niet (meer) voor deze organisatie." }, { status: 404 });
    }
    if (huidig.status !== "concept") {
      return NextResponse.json(
        { error: "Een uitgereikte factuur kan niet meer worden gewijzigd; maak een creditfactuur." },
        { status: 409 },
      );
    }
    if (huidig.updated_at !== body.baseUpdatedAt) {
      return NextResponse.json(
        { error: "Deze factuur is intussen door iemand anders gewijzigd.", factuur: factuurVanRij(huidig) },
        { status: 409 },
      );
    }

    const totalen = berekenTotalen(body.factuur.regels);
    const patch = conceptRijVanFactuur({
      ...body.factuur,
      subtotaalCent: totalen.subtotaalCent,
      btwCent: totalen.btwCent,
      totaalCent: totalen.totaalCent,
      btwTotalen: totalen.btwTotalen,
    });

    const params = new URLSearchParams({
      org_id: `eq.${session.orgId}`,
      id: `eq.${factuurId}`,
      status: "eq.concept",
      updated_at: `eq.${huidig.updated_at}`,
      select: FACTUUR_SELECT,
    });
    const response = await fetch(`${POSTGREST_URL}/careon_facturatie_facturen?${params}`, {
      method: "PATCH",
      headers: userRestHeaders(session, { Prefer: "return=representation" }),
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error("storage-unavailable");
    const rows = (await response.json()) as FactuurRij[];
    if (rows.length === 0) {
      // Race: tussen de leescheck en de update is de rij gewijzigd.
      const opnieuw = await haalFactuurRij(session, factuurId);
      return NextResponse.json(
        {
          error: "Deze factuur is intussen door iemand anders gewijzigd.",
          factuur: opnieuw ? factuurVanRij(opnieuw) : null,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ configured: true, factuur: factuurVanRij(rows[0]) });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}

/** Concept verwijderen — uitgereikte facturen weigert de DB-trigger. */
export async function DELETE(_request: Request, context: { params: Promise<{ factuurId: string }> }) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;
  const { factuurId } = await context.params;

  try {
    const huidig = await haalFactuurRij(session, factuurId);
    if (!huidig) {
      return NextResponse.json({ error: "Deze factuur bestaat niet (meer) voor deze organisatie." }, { status: 404 });
    }
    if (huidig.status !== "concept") {
      return NextResponse.json({ error: "Een uitgereikte factuur kan niet worden verwijderd." }, { status: 409 });
    }
    const params = new URLSearchParams({
      org_id: `eq.${session.orgId}`,
      id: `eq.${factuurId}`,
      status: "eq.concept",
    });
    const response = await fetch(`${POSTGREST_URL}/careon_facturatie_facturen?${params}`, {
      method: "DELETE",
      headers: userRestHeaders(session),
    });
    if (!response.ok) throw new Error("storage-unavailable");

    scheduleAuditEvent({
      action: "facturatie.factuur.verwijder_concept",
      resource: "careon_facturatie_facturen",
      resourceId: factuurId,
      orgId: session.orgId,
      userId: session.userId,
    });
    return NextResponse.json({ configured: true });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}
