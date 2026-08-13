import { NextResponse } from "next/server";

import { authenticatedActorHash } from "@/lib/careon-assistant/runtime.server";
import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { haalInstellingen } from "@/lib/careon-facturatie/facturatie.server";
import { type FacturatieInstellingen, isFacturatieInstellingen } from "@/lib/careon-facturatie/types";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface SaveBody {
  state: FacturatieInstellingen;
  baseRevision: number;
  operationId: string;
}

function isSaveBody(value: unknown): value is SaveBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    isFacturatieInstellingen(body.state) &&
    Number.isInteger(body.baseRevision) &&
    (body.baseRevision as number) >= 0 &&
    typeof body.operationId === "string" &&
    UUID_PATTERN.test(body.operationId)
  );
}

/** Metadata-only samenvatting: sjabloonaantallen, nooit de inhoud. */
function changeSummary(vorige: FacturatieInstellingen | null, volgende: FacturatieInstellingen) {
  const vorigeIds = new Set((vorige?.templates ?? []).map((template) => template.id));
  const volgendeIds = new Set(volgende.templates.map((template) => template.id));
  const gewijzigd = volgende.templates.filter((template) => {
    const oud = vorige?.templates.find((rij) => rij.id === template.id);
    return oud !== undefined && JSON.stringify(oud) !== JSON.stringify(template);
  }).length;
  return {
    templates: volgende.templates.length,
    templatesToegevoegd: [...volgendeIds].filter((id) => !vorigeIds.has(id)).length,
    templatesVerwijderd: [...vorigeIds].filter((id) => !volgendeIds.has(id)).length,
    templatesGewijzigd: gewijzigd,
    standaardGewijzigd: (vorige?.standaardTemplateId ?? null) !== volgende.standaardTemplateId,
  };
}

export async function GET() {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  try {
    const { instellingen, revision } = await haalInstellingen(auth.session);
    return NextResponse.json({ configured: true, instellingen, revision });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}

/** Append-only snapshot (hr/middelen-patroon) met idempotente operation_id en
    conflictdetectie op baseRevision. De nummerreeks is bevroren zodra er in
    die reeks/dat jaar een uitgereikte factuur bestaat (handoff 15 §3.1). */
export async function POST(request: Request) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;

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
    return NextResponse.json({ error: "Ongeldige of onvolledige instellingen." }, { status: 400 });
  }

  try {
    // Idempotentie: dezelfde operatie nogmaals → bestaande revisie terug.
    const opParams = new URLSearchParams({
      select: "revision",
      org_id: `eq.${session.orgId}`,
      operation_id: `eq.${body.operationId}`,
      limit: "1",
    });
    const opResponse = await fetch(`${POSTGREST_URL}/careon_facturatie_instellingen?${opParams}`, {
      headers: userRestHeaders(session),
      cache: "no-store",
    });
    if (!opResponse.ok) throw new Error("storage-unavailable");
    const bestaande = (await opResponse.json()) as { revision: number }[];
    if (bestaande.length > 0) {
      return NextResponse.json({ configured: true, revision: bestaande[0].revision, idempotent: true });
    }

    const { instellingen: huidig, revision: huidigeRevisie } = await haalInstellingen(session);
    if (body.baseRevision !== huidigeRevisie) {
      return NextResponse.json(
        { error: "De centrale registratie is intussen gewijzigd.", revision: huidigeRevisie, instellingen: huidig },
        { status: 409 },
      );
    }

    // Nummerreeks-bevriezing per sjabloon: gewijzigde nummering + al een
    // uitgereikte factuur in die reeks/dit jaar ⇒ weigeren. Gepeild op de
    // óúde reekswaarden (factuur én credit): uitgereikte facturen dragen de
    // oude letters, dus een peiling op de nieuwe waarde zou een hernoemde of
    // alleen-credit-reeks stil laten passeren.
    if (huidigeRevisie > 0) {
      const jaar = new Date().getUTCFullYear();
      for (const template of body.state.templates) {
        const oud = huidig.templates.find((rij) => rij.id === template.id);
        if (!oud || JSON.stringify(oud.nummering) === JSON.stringify(template.nummering)) continue;
        const reeksen = [...new Set([oud.nummering.reeksFactuur, oud.nummering.reeksCredit])];
        const factuurParams = new URLSearchParams({
          select: "id",
          org_id: `eq.${session.orgId}`,
          status: "neq.concept",
          reeks: `in.(${reeksen.join(",")})`,
          jaar: `eq.${jaar}`,
          limit: "1",
        });
        const factuurResponse = await fetch(`${POSTGREST_URL}/careon_facturatie_facturen?${factuurParams}`, {
          headers: userRestHeaders(session),
          cache: "no-store",
        });
        if (!factuurResponse.ok) throw new Error("storage-unavailable");
        if (((await factuurResponse.json()) as unknown[]).length > 0) {
          return NextResponse.json(
            {
              error: `De nummerreeks van sjabloon "${template.naam}" kan niet meer worden gewijzigd: er bestaan al uitgereikte facturen in deze reeks.`,
            },
            { status: 409 },
          );
        }
      }
    }

    const revision = huidigeRevisie + 1;
    const response = await fetch(`${POSTGREST_URL}/careon_facturatie_instellingen`, {
      method: "POST",
      headers: userRestHeaders(session, { Prefer: "return=representation" }),
      body: JSON.stringify({
        org_id: session.orgId,
        state: body.state,
        revision,
        base_revision: body.baseRevision,
        operation_id: body.operationId,
        change_source: "manual",
        change_summary: changeSummary(huidigeRevisie > 0 ? huidig : null, body.state),
        actor_hash: authenticatedActorHash(session.userId),
      }),
    });
    if (!response.ok) {
      const nogmaals = await fetch(`${POSTGREST_URL}/careon_facturatie_instellingen?${opParams}`, {
        headers: userRestHeaders(session),
        cache: "no-store",
      });
      if (nogmaals.ok) {
        const rows = (await nogmaals.json()) as { revision: number }[];
        if (rows.length > 0) {
          return NextResponse.json({ configured: true, revision: rows[0].revision, idempotent: true });
        }
      }
      return NextResponse.json({ error: "Instellingen konden niet worden opgeslagen." }, { status: 502 });
    }

    scheduleAuditEvent({
      action: "state.append",
      resource: "careon_facturatie_instellingen",
      orgId: session.orgId,
      userId: session.userId,
      detail: { revision, source: "manual" },
    });
    return NextResponse.json({ configured: true, revision });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}
