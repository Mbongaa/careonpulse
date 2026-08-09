import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import {
  FACTUUR_SELECT,
  type FactuurRij,
  factuurVanRij,
  haalInstellingen,
} from "@/lib/careon-facturatie/facturatie.server";
import { FACTUUR_STATUSSEN } from "@/lib/careon-facturatie/types";
import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

export const runtime = "nodejs";

const LIJST_LIMIET = 50;

/** Facturenlijst: jaarfilter (default lopend jaar), statusfilter, zoeken op
    nummer/afnemernaam, serverzijdige paginering (handoff 15 §4.2). */
export async function GET(request: Request) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;

  const url = new URL(request.url);
  const jaarParam = url.searchParams.get("jaar");
  const statusParam = url.searchParams.get("status");
  const zoekParam = url.searchParams.get("zoek")?.trim() ?? "";
  const paginaParam = url.searchParams.get("pagina");
  const pagina = Math.max(0, Number.parseInt(paginaParam ?? "0", 10) || 0);

  const params = new URLSearchParams({
    select: FACTUUR_SELECT,
    org_id: `eq.${session.orgId}`,
    // Concepten (zonder factuurdatum) bovenaan, daarna nieuwste eerst.
    order: "factuurdatum.desc.nullsfirst,created_at.desc",
    limit: String(LIJST_LIMIET + 1),
    offset: String(pagina * LIJST_LIMIET),
  });
  if (jaarParam && /^\d{4}$/.test(jaarParam)) params.set("jaar", `eq.${jaarParam}`);
  if (statusParam && (FACTUUR_STATUSSEN as readonly string[]).includes(statusParam)) {
    params.set("status", `eq.${statusParam}`);
  }
  if (zoekParam.length > 0 && zoekParam.length <= 80) {
    // PostgREST-reserved tekens strippen; ilike met wildcard rond de term.
    const veilig = zoekParam.replaceAll(/[(),.*\\]/g, " ").trim();
    if (veilig.length > 0) {
      params.set("or", `(nummer.ilike.*${veilig}*,afnemer->>naam.ilike.*${veilig}*)`);
    }
  }

  try {
    const response = await fetch(`${POSTGREST_URL}/careon_facturatie_facturen?${params}`, {
      headers: userRestHeaders(session),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("storage-unavailable");
    const rows = (await response.json()) as FactuurRij[];
    return NextResponse.json({
      configured: true,
      facturen: rows.slice(0, LIJST_LIMIET).map(factuurVanRij),
      heeftMeer: rows.length > LIJST_LIMIET,
    });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}

/** Nieuw concept — bewust een POST-actie, nooit een render-neveneffect
    (handoff 15 §4.1): defaults komen uit de instellingen. Met
    `?dupliceerVan=<id>` worden afnemer + regels van een bestaande factuur
    overgenomen (zonder nummer, datums en pdf-metadata). */
export async function POST(request: Request) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;
  const dupliceerVan = new URL(request.url).searchParams.get("dupliceerVan");

  try {
    const { instellingen } = await haalInstellingen(session);
    const nu = new Date();
    let basis: Record<string, unknown> = {};
    if (dupliceerVan) {
      const bronParams = new URLSearchParams({
        select:
          "contact_id,afnemer,uw_kenmerk,order_referentie,regels,vrijstelling_tekst,betaaltermijn_dagen,opmerking",
        org_id: `eq.${session.orgId}`,
        id: `eq.${dupliceerVan}`,
        limit: "1",
      });
      const bronResponse = await fetch(`${POSTGREST_URL}/careon_facturatie_facturen?${bronParams}`, {
        headers: userRestHeaders(session),
        cache: "no-store",
      });
      if (!bronResponse.ok) throw new Error("storage-unavailable");
      const bronnen = (await bronResponse.json()) as Record<string, unknown>[];
      if (bronnen.length === 0) {
        return NextResponse.json({ error: "Deze factuur bestaat niet (meer) voor deze organisatie." }, { status: 404 });
      }
      basis = bronnen[0];
    }

    const response = await fetch(`${POSTGREST_URL}/careon_facturatie_facturen?select=${FACTUUR_SELECT}`, {
      method: "POST",
      headers: userRestHeaders(session, { Prefer: "return=representation" }),
      body: JSON.stringify({
        org_id: session.orgId,
        status: "concept",
        soort: "factuur",
        reeks: instellingen.nummering.reeksFactuur,
        jaar: nu.getUTCFullYear(),
        betaaltermijn_dagen: instellingen.betaling.standaardTermijnDagen,
        vrijstelling_tekst:
          instellingen.btw.standaardTarief === "vrijgesteld" ? instellingen.btw.vrijstellingTekst : null,
        created_by: session.userId,
        ...basis,
      }),
    });
    if (!response.ok) throw new Error("storage-unavailable");
    const rows = (await response.json()) as FactuurRij[];
    if (rows.length === 0) throw new Error("storage-unavailable");

    scheduleAuditEvent({
      action: dupliceerVan ? "facturatie.factuur.dupliceer" : "facturatie.factuur.concept",
      resource: "careon_facturatie_facturen",
      resourceId: rows[0].id,
      orgId: session.orgId,
      userId: session.userId,
    });
    return NextResponse.json({ configured: true, factuur: factuurVanRij(rows[0]) });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}
