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
  // De demo-identiteit kan gelijktijdig op meerdere locaties worden gebruikt.
  // Supabase gebruikt standaard global scope; local voorkomt dat één logout
  // alle andere browsers en apparaten van hetzelfde account afmeldt.
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    scheduleAuditEvent({
      action: "auth.logout_failed",
      resource: "auth",
      userId: user.id,
      detail: { reason: error.code ?? "sign_out_failed" },
    });
    return NextResponse.json({ error: "Uitloggen is niet voltooid." }, { status: 502 });
  }
  scheduleAuditEvent({ action: "auth.logout", resource: "auth", userId: user.id });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
