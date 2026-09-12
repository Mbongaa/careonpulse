import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { type GemachtigdenBody, SCRIBE_BODY_LIMIETEN } from "@/lib/careon-scribe/api-contract";
import {
  eisScribeMachtiging,
  haalGemachtigden,
  SCRIBE_GEMACHTIGDEN_TABEL,
  scribeDelete,
  scribeFoutAntwoord,
  scribePost,
} from "@/lib/careon-scribe/scribe.server";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

// Gemachtigde behandelaren (handoff 20 §5.3/§7.5, S12).
//
// De lijst is de unie van de organisatieleden (dezelfde bron als
// /api/org/members: lidmaatschappen en profielen via de service-role, het
// e-mailadres uit GoTrue) met het machtigingenregister. org_admins zijn per
// definitie gemachtigd (magScribeBeheren) en worden nooit als rij in
// careon_scribe_gemachtigden vastgelegd — de UI toont ze vast aangevinkt.
//
// Schrijven gebeurt onder het CALLER-JWT: de RLS-policy op
// careon_scribe_gemachtigden eist app.mag_scribe_beheren(org_id), zodat de
// database de grens bewaakt en niet alleen deze route.

export const runtime = "nodejs";

const UUID_PATROON = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;

  const gemachtigden = await haalGemachtigden(auth.session.orgId as string);
  if (!gemachtigden) {
    return NextResponse.json({ error: "De ledenlijst kon niet worden opgehaald." }, { status: 502 });
  }
  return NextResponse.json({ configured: true, gemachtigden }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const weigering = await eisScribeMachtiging(auth.session);
  if (weigering) return weigering;
  const session = auth.session;
  const orgId = session.orgId as string;

  let body: unknown;
  try {
    body = await readJsonBodyLimited<unknown>(request, SCRIBE_BODY_LIMIETEN.standaard);
  } catch (error) {
    const status = error instanceof RequestPayloadTooLargeError ? 413 : 400;
    if (!(error instanceof RequestPayloadTooLargeError) && !(error instanceof InvalidJsonBodyError)) {
      console.error("Scribe body read failed", { route: "gemachtigden" });
    }
    return NextResponse.json({ error: status === 413 ? "Payload te groot." : "Ongeldige JSON." }, { status });
  }
  const invoer = (body ?? {}) as GemachtigdenBody;
  if (!Array.isArray(invoer.userIds) || invoer.userIds.some((id) => typeof id !== "string" || !UUID_PATROON.test(id))) {
    return NextResponse.json({ error: "Ongeldige lijst met behandelaren." }, { status: 400 });
  }
  const gevraagd = new Set(invoer.userIds.slice(0, 500));

  try {
    const huidig = await haalGemachtigden(orgId);
    if (!huidig) {
      return NextResponse.json({ error: "De ledenlijst kon niet worden opgehaald." }, { status: 502 });
    }
    const leden = new Map(huidig.map((lid) => [lid.userId, lid]));
    // Alleen leden van de eigen organisatie; beheerders staan al buiten het
    // register (zij zijn gemachtigd via hun rol).
    const doel = new Set(
      [...gevraagd].filter((userId) => leden.has(userId) && leden.get(userId)?.orgRole !== "org_admin"),
    );
    const bestaand = new Set(
      huidig.filter((lid) => lid.gemachtigd && lid.orgRole !== "org_admin").map((lid) => lid.userId),
    );

    const toevoegen = [...doel].filter((userId) => !bestaand.has(userId));
    const verwijderen = [...bestaand].filter((userId) => !doel.has(userId));

    if (toevoegen.length > 0) {
      await scribePost(
        session,
        SCRIBE_GEMACHTIGDEN_TABEL,
        toevoegen.map((userId) => ({
          org_id: orgId,
          user_id: userId,
          toegekend_door: session.userId,
        })),
        "return=minimal,resolution=merge-duplicates",
      );
    }
    if (verwijderen.length > 0) {
      const params = new URLSearchParams({
        org_id: `eq.${orgId}`,
        user_id: `in.(${verwijderen.join(",")})`,
      });
      await scribeDelete(session, SCRIBE_GEMACHTIGDEN_TABEL, params);
    }

    scheduleAuditEvent({
      action: "scribe.gemachtigden.gewijzigd",
      resource: SCRIBE_GEMACHTIGDEN_TABEL,
      orgId,
      userId: session.userId,
      // Metadata-only: aantallen, nooit namen of e-mailadressen.
      detail: { toegevoegd: toevoegen.length, verwijderd: verwijderen.length, totaal: doel.size },
    });

    const vernieuwd = await haalGemachtigden(orgId);
    return NextResponse.json(
      {
        configured: true,
        gemachtigden: vernieuwd ?? huidig,
        toegevoegd: toevoegen.length,
        verwijderd: verwijderen.length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return scribeFoutAntwoord(error, "Machtigingen konden niet worden opgeslagen.");
  }
}
