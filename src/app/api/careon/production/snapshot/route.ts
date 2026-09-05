import { NextResponse } from "next/server";

import { readEpdSnapshot } from "@/lib/careon-production/epd-snapshot.server";
import { requireCareonSession } from "@/lib/supabase/session.server";

export async function GET() {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  try {
    const snapshot = await readEpdSnapshot(auth.session);
    return NextResponse.json({ configured: true, snapshot }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "EPD-generatie kon niet worden gelezen." }, { status: 502 });
  }
}
