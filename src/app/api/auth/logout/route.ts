import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { isCareonDemoMode, isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { supabaseServer } from "@/lib/supabase/server";

// Server-side uitloggen: wist de sessie-cookies. Idempotent — ook zonder
// actieve sessie antwoordt de route 200, zodat de client altijd kan opruimen.
export async function POST() {
  if (isCareonDemoMode()) {
    return NextResponse.json({ configured: false, demo: true }, { status: 501 });
  }
  if (!isSupabaseAuthConfigured()) {
    return NextResponse.json({ error: "Authenticatie is niet geconfigureerd." }, { status: 503 });
  }
  const supabase = await supabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Uitloggen is tijdelijk niet beschikbaar." }, { status: 503 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }
  // Organisatie ophalen vóór het uitloggen — daarna is het access token weg en
  // ziet RLS niets meer. Zonder org_id valt elke uitlogrij buiten het
  // organisatiefilter van /admin/activiteit; dezelfde volgorde als
  // getCareonSession(), zodat in- en uitloggen dezelfde organisatie dragen.
  // Bewust niet via getCareonSession(): die weigert geblokkeerde accounts, en
  // ook een geblokkeerde gebruiker moet zijn cookies kunnen laten wissen.
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("org_id")
    .order("created_at")
    .limit(1);
  const orgId = (memberships?.[0] as { org_id?: string } | undefined)?.org_id ?? null;
  // De demo-identiteit kan gelijktijdig op meerdere locaties worden gebruikt.
  // Supabase gebruikt standaard global scope; local voorkomt dat één logout
  // alle andere browsers en apparaten van hetzelfde account afmeldt.
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    scheduleAuditEvent({
      action: "auth.logout_failed",
      resource: "auth",
      orgId,
      userId: user.id,
      detail: { reason: error.code ?? "sign_out_failed" },
    });
    return NextResponse.json({ error: "Uitloggen is niet voltooid." }, { status: 502 });
  }
  scheduleAuditEvent({ action: "auth.logout", resource: "auth", orgId, userId: user.id });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
