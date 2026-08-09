import { NextResponse } from "next/server";

import { ADMIN_HERSTELBAAR, herstelRevisie } from "@/lib/careon-admin/admin.server";
import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { InvalidJsonBodyError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireSuperadmin } from "@/lib/supabase/session.server";

// Beheer: een eerdere revisie van een handmatige registratie terugzetten.
// Nodig omdat een gebruiker de HR- of middelenregistratie van zijn organisatie
// kan leegmaken of overschrijven; de vorige stand stond er nog (append-only)
// maar was alleen met SQL terug te halen. Het herstel schrijft de oude
// momentopname als nieuwe revisie — er wordt niets overschreven of verwijderd.

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const auth = await requireSuperadmin();
  if ("denied" in auth) return auth.denied;

  let body: { table?: unknown; orgId?: unknown; revisieId?: unknown };
  try {
    body = await readJsonBodyLimited<{ table?: unknown; orgId?: unknown; revisieId?: unknown }>(request, 10_000);
  } catch (error) {
    if (!(error instanceof InvalidJsonBodyError)) {
      console.error("Admin registratie body read failed", error);
    }
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const tabel = typeof body.table === "string" ? body.table : "";
  const orgId = typeof body.orgId === "string" ? body.orgId : "";
  const revisieId = typeof body.revisieId === "string" ? body.revisieId : "";
  // Alleen de registraties mét revisiekolom zijn herstelbaar; de tabelnaam komt
  // uit die vaste lijst en nooit rechtstreeks uit de aanvraag.
  const bron = ADMIN_HERSTELBAAR.find((registratie) => registratie.table === tabel);
  if (!bron || !UUID_PATTERN.test(orgId) || !UUID_PATTERN.test(revisieId)) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const uitkomst = await herstelRevisie(bron, orgId, revisieId, auth.session.userId);
  if (!uitkomst.ok) {
    if (uitkomst.status === 404) {
      return NextResponse.json({ error: "Deze revisie bestaat niet (meer) voor deze organisatie." }, { status: 404 });
    }
    if (uitkomst.status === 422) {
      return NextResponse.json(
        { error: "Deze revisie voldoet niet meer aan het huidige gegevensschema en kan niet worden teruggezet." },
        { status: 422 },
      );
    }
    if (uitkomst.status === 409) {
      // Unieke index op (org_id, revision): iemand binnen de organisatie sloeg
      // op tussen het lezen van de hoogste revisie en deze insert.
      return NextResponse.json(
        { error: "Er is intussen opgeslagen door een gebruiker — ververs de pagina en probeer opnieuw." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Herstellen mislukt." }, { status: 502 });
  }

  scheduleAuditEvent({
    action: "admin.registratie.restore",
    resource: bron.table,
    resourceId: revisieId,
    orgId,
    userId: auth.session.userId,
    detail: { registratie: bron.label, nieuweRevisie: String(uitkomst.data) },
  });
  return NextResponse.json({ ok: true, revision: uitkomst.data });
}
