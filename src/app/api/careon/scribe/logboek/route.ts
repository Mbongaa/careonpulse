import { NextResponse } from "next/server";

import {
  isScribeHandelingFilter,
  type LogboekRegel,
  SCRIBE_LOGBOEK_PAGINA_GROOTTE,
} from "@/lib/careon-scribe/api-contract";
import {
  eisScribeMachtiging,
  scribeFoutAntwoord,
  scribeServiceBeschikbaar,
  scribeServiceHeaders,
} from "@/lib/careon-scribe/scribe.server";
import { isIsoDatum } from "@/lib/careon-scribe/types";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

// Eigen scribe-logboek voor de verwerkingsverantwoordelijke (N20, §5.3).
//
// `audit_events` is bewust alleen leesbaar voor de service-role en tot nu toe
// alleen zichtbaar via /admin achter requireSuperadmin — dat is de
// Careon-superadmin, niet de FG van de klant. Die kan een cliënt die vraagt
// "wie heeft mijn gesprek gelezen" dus niets tonen, terwijl NEN 7513 en art. 15
// AVG precies dat verlangen. Deze route geeft een org_admin dezelfde regels
// voor de EIGEN organisatie.
//
// Drie harde grenzen:
//   * het filter `org_id = <eigen org>` staat naast `action like scribe.%`, dus
//     een beheerder ziet nooit een andere organisatie en nooit een niet-scribe
//     handeling;
//   * het antwoord is metadata: tijdstip, handeling, actor, sessie-id en de
//     scalaire velden uit `detail`. Nooit transcripttekst, nooit verslaginhoud,
//     nooit een dossierreferentie — die staan per ontwerp al niet in
//     audit_events, en deze route zeeft ze bovendien uit;
//   * de actornaam komt uit organization_members/profiles van de eigen
//     organisatie. Staat het lidmaatschap er niet meer, dan blijft de naam
//     leeg — nooit een naam uit consultinhoud.

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
/** Hoeveel recente regels het handelingenfilter mag samenstellen. */
const HANDELINGEN_VENSTER = 500;

interface AuditRij {
  created_at: string;
  action: string;
  user_id: string | null;
  resource: string | null;
  resource_id: string | null;
  detail: unknown;
}

async function serviceLees<T>(pad: string): Promise<T | null> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${pad}`, {
      headers: scribeServiceHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Alleen scalaire waarden; een geneste structuur zou inhoud kunnen dragen. */
function scalaireDetails(waarde: unknown): Record<string, string | number | boolean | null> {
  if (!waarde || typeof waarde !== "object" || Array.isArray(waarde)) return {};
  const uitkomst: Record<string, string | number | boolean | null> = {};
  for (const [sleutel, item] of Object.entries(waarde as Record<string, unknown>)) {
    if (item === null || typeof item === "number" || typeof item === "boolean") {
      uitkomst[sleutel] = item;
    } else if (typeof item === "string") {
      uitkomst[sleutel] = item.slice(0, 120);
    }
  }
  return uitkomst;
}

function sessieVan(rij: AuditRij, detail: Record<string, string | number | boolean | null>): string | null {
  if (rij.resource === "careon_scribe_sessies" && rij.resource_id) return rij.resource_id;
  const uitDetail = detail.sessie;
  return typeof uitDetail === "string" ? uitDetail : null;
}

export async function GET(request: Request) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;
  const orgId = session.orgId ?? "";

  if (!scribeServiceBeschikbaar()) {
    return NextResponse.json({ error: "Het logboek is niet beschikbaar op deze omgeving." }, { status: 503 });
  }

  const zoekparameters = new URL(request.url).searchParams;
  const handeling = zoekparameters.get("handeling");
  if (handeling !== null && handeling !== "alle" && !isScribeHandelingFilter(handeling)) {
    return NextResponse.json({ error: "Onbekende handeling." }, { status: 400 });
  }
  const van = isIsoDatum(zoekparameters.get("van")) ? (zoekparameters.get("van") as string) : null;
  const tot = isIsoDatum(zoekparameters.get("tot")) ? (zoekparameters.get("tot") as string) : null;
  const paginaRuw = Number(zoekparameters.get("pagina") ?? "1");
  const pagina = Number.isInteger(paginaRuw) && paginaRuw >= 1 ? Math.min(paginaRuw, 400) : 1;

  try {
    const params = new URLSearchParams({
      select: "created_at,action,user_id,resource,resource_id,detail",
      org_id: `eq.${orgId}`,
      order: "created_at.desc",
      limit: String(SCRIBE_LOGBOEK_PAGINA_GROOTTE + 1),
      offset: String((pagina - 1) * SCRIBE_LOGBOEK_PAGINA_GROOTTE),
    });
    // Het scribe-filter staat er ALTIJD, ook wanneer er een specifieke
    // handeling is gekozen: zo kan geen enkele parameter het logboek naar een
    // andere module openbreken.
    params.set("action", handeling && handeling !== "alle" ? `eq.${handeling}` : "like.scribe.*");
    if (van) params.set("created_at", `gte.${van}`);
    if (tot) params.append("and", `(created_at.lte.${tot}T23:59:59.999Z)`);

    const rijen = await serviceLees<AuditRij[]>(`audit_events?${params}`);
    if (!rijen) {
      return NextResponse.json({ error: "Het logboek kon niet worden opgehaald." }, { status: 502 });
    }
    const meer = rijen.length > SCRIBE_LOGBOEK_PAGINA_GROOTTE;
    const zichtbaar = rijen.slice(0, SCRIBE_LOGBOEK_PAGINA_GROOTTE);

    // Namen: alleen van huidige leden van DEZE organisatie.
    const actorIds = [...new Set(zichtbaar.map((rij) => rij.user_id).filter((id): id is string => Boolean(id)))];
    const naamPerId = new Map<string, string>();
    if (actorIds.length > 0) {
      const filter = `in.(${actorIds.join(",")})`;
      const [leden, profielen] = await Promise.all([
        serviceLees<{ user_id: string }[]>(`organization_members?select=user_id&org_id=eq.${orgId}&user_id=${filter}`),
        serviceLees<{ id: string; full_name: string | null }[]>(`profiles?select=id,full_name&id=${filter}`),
      ]);
      const ledenIds = new Set((leden ?? []).map((lid) => lid.user_id));
      for (const profiel of profielen ?? []) {
        if (!ledenIds.has(profiel.id)) continue;
        const naam = (profiel.full_name ?? "").trim();
        if (naam.length > 0) naamPerId.set(profiel.id, naam);
      }
    }

    const regels: LogboekRegel[] = zichtbaar.map((rij) => {
      const detail = scalaireDetails(rij.detail);
      return {
        tijdstip: rij.created_at,
        handeling: rij.action,
        actorNaam: rij.user_id ? (naamPerId.get(rij.user_id) ?? null) : null,
        sessieId: sessieVan(rij, detail),
        detail,
      };
    });

    // Welke handelingen komen in deze organisatie voor? Voedt het filter; een
    // begrensd venster volstaat en houdt de lezing licht.
    const venster = new URLSearchParams({
      select: "action",
      org_id: `eq.${orgId}`,
      action: "like.scribe.*",
      order: "created_at.desc",
      limit: String(HANDELINGEN_VENSTER),
    });
    const voorkomend = await serviceLees<{ action: string }[]>(`audit_events?${venster}`);
    const handelingen = [...new Set((voorkomend ?? []).map((rij) => rij.action))].sort();

    return NextResponse.json(
      { configured: true, regels, pagina, meer, handelingen },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error, "Het logboek kon niet worden opgehaald.");
  }
}
