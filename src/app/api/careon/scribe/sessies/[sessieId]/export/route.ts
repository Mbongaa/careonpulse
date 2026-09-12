import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import {
  SCRIBE_BODY_LIMIETEN,
  SCRIBE_EXPORT_FORMATEN,
  type ScribeExportBevestigingBody,
  type ScribeExportFormaat,
} from "@/lib/careon-scribe/api-contract";
import { bouwExportTekst, exportBestandsnaam, exportTaken } from "@/lib/careon-scribe/export-tekst";
import {
  eisScribeMachtiging,
  haalLaatsteNotitieRij,
  haalSessieRij,
  haalTaakRijen,
  haalVrijgegevenSessieIds,
  leesRolVoor,
  notitieVanRij,
  SCRIBE_SESSIES_TABEL,
  scribeFoutAntwoord,
  sessieVanRij,
  taakVanRij,
} from "@/lib/careon-scribe/scribe.server";
import { RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireCareonSession } from "@/lib/supabase/session.server";

// Het goedgekeurde verslag als tekstbestand (handoff 20 §5.3/S2).
//
// Het EPD blijft het juridische dossier: dit bestand is de overdrachtsvorm.
// Daarom staan er GEEN behandelaarsgegevens in (geen naam, geen e-mailadres)
// en staat de dossierreferentie wél in de KOP maar nooit in de BESTANDSNAAM —
// een downloadmap is geen dossier.
//
// Drie queryparameters sturen de vorm en de audit (N17/N20):
//   * `formaat=txt|md` — txt is de EPD-vorm, md de werkkopie.
//   * `bronnen=1|0` — de "(bronnen: §3, §7)"-regels wijzen naar een transcript
//     dat bij de overname juist wordt gewist; in het EPD is dat blijvende ruis,
//     dus zonder parameter volgt de default van bouwExportTekst (uit voor txt,
//     aan voor md).
//   * `legeSecties=1` — toont ook de secties zonder vastgestelde tekst; zonder
//     parameter blijven die weg.
//   * `kanaal=klembord|bestand` — welke weg de kopie nam. Bestandsexports zijn
//     de enige kopieën die Careon niet meer kan opruimen, dus die moeten in het
//     logboek apart telbaar zijn.

export const runtime = "nodejs";

const EXPORT_KANALEN = ["klembord", "bestand"] as const;
type ExportKanaal = (typeof EXPORT_KANALEN)[number];

/** `1`/`0` (of `true`/`false`); alles anders laat de default staan. */
function vlag(waarde: string | null): boolean | undefined {
  if (waarde === "1" || waarde === "true") return true;
  if (waarde === "0" || waarde === "false") return false;
  return undefined;
}

export async function GET(request: Request, context: { params: Promise<{ sessieId: string }> }) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;
  const { sessieId } = await context.params;

  const zoekparameters = new URL(request.url).searchParams;
  const gevraagd = zoekparameters.get("formaat");
  const formaat: ScribeExportFormaat = (SCRIBE_EXPORT_FORMATEN as readonly string[]).includes(gevraagd ?? "")
    ? (gevraagd as ScribeExportFormaat)
    : "txt";
  const bronverwijzingen = vlag(zoekparameters.get("bronnen"));
  const legeSecties = vlag(zoekparameters.get("legeSecties"));
  const gevraagdKanaal = zoekparameters.get("kanaal");
  const kanaal: ExportKanaal | null = (EXPORT_KANALEN as readonly string[]).includes(gevraagdKanaal ?? "")
    ? (gevraagdKanaal as ExportKanaal)
    : null;

  try {
    const rij = await haalSessieRij(session, sessieId);
    if (!rij) return NextResponse.json({ error: "Dit consult bestaat niet (meer)." }, { status: 404 });
    const vrijgegeven = await haalVrijgegevenSessieIds(session);
    const rol = leesRolVoor(session, rij, vrijgegeven);
    if (!rol || rol === "beheerder") {
      return NextResponse.json({ error: "Geen toegang tot dit verslag." }, { status: 403 });
    }

    const notitieRij = await haalLaatsteNotitieRij(session, sessieId, true);
    if (!notitieRij) {
      return NextResponse.json({ error: "Er is nog geen goedgekeurd verslag voor dit consult." }, { status: 409 });
    }
    const notitie = notitieVanRij(notitieRij);
    const taken = rol === "eigenaar" ? (await haalTaakRijen(session, sessieId)).map(taakVanRij) : [];

    const body = bouwExportTekst({
      sessie: sessieVanRij(rij, rol === "eigenaar", rol !== "eigenaar"),
      notitie,
      taken,
      formaat,
      bronverwijzingen,
      // Alleen een expliciete `legeSecties=1` zet het weglaten uit.
      legeSectiesWeglaten: legeSecties === undefined ? undefined : !legeSecties,
    });
    const goedgekeurdeTaken = exportTaken(taken);

    // Dezelfde helper als de client en het demo-pad (C28), zodat de naam in de
    // Content-Disposition en de naam waaronder het bestand landt gelijk zijn.
    const volledig = exportBestandsnaam(sessieId, formaat, rij.gestart_op ?? rij.created_at);

    if (zoekparameters.get("preview") !== "1")
      scheduleAuditEvent({
        action: "scribe.export",
        resource: SCRIBE_SESSIES_TABEL,
        resourceId: sessieId,
        orgId: session.orgId,
        userId: session.userId,
        detail: {
          rol,
          formaat,
          secties: notitie.secties.length,
          taken: goedgekeurdeTaken.length,
          // N20 — bestandsexports zijn de enige kopieën buiten Careons bereik.
          kanaal,
          bronverwijzingen: bronverwijzingen ?? formaat === "md",
        },
      });

    return new NextResponse(body, {
      headers: {
        "Content-Type": formaat === "md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${volledig}"; filename*=UTF-8''${encodeURIComponent(volledig)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return scribeFoutAntwoord(error, "Verslag kon niet worden geëxporteerd.");
  }
}

/** Record an actual completed browser copy/download, not a speculative prefetch. */
export async function POST(request: Request, context: { params: Promise<{ sessieId: string }> }) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const { sessieId } = await context.params;
  let body: ScribeExportBevestigingBody;
  try {
    body = await readJsonBodyLimited<ScribeExportBevestigingBody>(request, SCRIBE_BODY_LIMIETEN.standaard);
  } catch (error) {
    return NextResponse.json(
      { error: "Ongeldige exportbevestiging." },
      { status: error instanceof RequestPayloadTooLargeError ? 413 : 400 },
    );
  }
  if (
    !body ||
    !["klembord", "bestand"].includes(body.kanaal) ||
    typeof body.notitieId !== "string" ||
    !Number.isInteger(body.bewerkRevisie) ||
    body.bewerkRevisie < 1
  ) {
    return NextResponse.json({ error: "Ongeldige exportbevestiging." }, { status: 400 });
  }
  try {
    const session = auth.session;
    const sessie = await haalSessieRij(session, sessieId);
    if (!sessie) return NextResponse.json({ error: "Dit consult bestaat niet (meer)." }, { status: 404 });
    const rol = leesRolVoor(session, sessie, await haalVrijgegevenSessieIds(session));
    if (!rol || rol === "beheerder")
      return NextResponse.json({ error: "Geen toegang tot dit verslag." }, { status: 403 });
    const notitie = await haalLaatsteNotitieRij(session, sessieId, true);
    if (!notitie || notitie.id !== body.notitieId || notitie.bewerk_revisie !== body.bewerkRevisie) {
      return NextResponse.json({ error: "De verslagversie is intussen gewijzigd." }, { status: 409 });
    }
    const dto = notitieVanRij(notitie);
    if (
      body.sectieId !== undefined &&
      !dto.secties.some((sectie) => sectie.id === body.sectieId && sectie.status === "goedgekeurd")
    ) {
      return NextResponse.json({ error: "Onbekende goedgekeurde sectie." }, { status: 400 });
    }
    scheduleAuditEvent({
      action: "scribe.export",
      resource: SCRIBE_SESSIES_TABEL,
      resourceId: sessieId,
      orgId: session.orgId,
      userId: session.userId,
      detail: {
        rol,
        kanaal: body.kanaal,
        notitie: notitie.id,
        bewerkRevisie: notitie.bewerk_revisie,
        sectie: body.sectieId ?? null,
      },
    });
    return NextResponse.json({ configured: true, bevestigd: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return scribeFoutAntwoord(error, "Exportbevestiging kon niet worden opgeslagen.");
  }
}
