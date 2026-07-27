import { NextResponse } from "next/server";

import { getCareonSession } from "@/lib/supabase/session.server";

// Sessie-informatie voor de UI (accountweergave, admin-toegang). Lekt niets:
// alleen de eigen identiteit, org en rollen van de aanvrager zelf.
export async function GET() {
  const result = await getCareonSession();
  if (result.status === "demo") {
    return NextResponse.json(
      { configured: false, demo: true },
      { status: 501, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (result.status === "misconfigured") {
    return NextResponse.json(
      { error: "Authenticatie is niet geconfigureerd." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (result.status === "no-org") {
    return NextResponse.json(
      { authed: false, error: "Geen organisatie gekoppeld aan dit account." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (result.status !== "ok") {
    return NextResponse.json({ authed: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { session } = result;
  return NextResponse.json(
    {
      authed: true,
      email: session.email,
      orgId: session.orgId,
      orgRole: session.orgRole,
      isSuperadmin: session.isSuperadmin,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
