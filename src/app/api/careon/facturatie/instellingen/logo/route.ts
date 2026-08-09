import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import {
  downloadUitBucket,
  logoPadVoor,
  storageBeschikbaar,
  uploadNaarBucket,
} from "@/lib/careon-facturatie/facturatie.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

import { createHash } from "node:crypto";

export const runtime = "nodejs";

// Organisatielogo voor op de factuur (handoff 15 §3.3): alleen PNG — de
// pdf-renderer ondersteunt geen svg. Zelfde private bucket als de pdf's;
// same-origin route als bron voor preview én renderToBuffer (connect-src
// 'self' verbiedt rechtstreekse Storage-fetches).

const MAX_LOGO_BYTES = 2_000_000;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

export async function GET() {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  if (!storageBeschikbaar()) {
    return NextResponse.json({ error: "Authenticatie is niet geconfigureerd." }, { status: 503 });
  }
  const bytes = await downloadUitBucket(logoPadVoor(auth.session.orgId as string));
  if (!bytes) {
    return NextResponse.json({ error: "Er is nog geen logo geüpload." }, { status: 404 });
  }
  return new NextResponse(bytes, {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;
  if (!storageBeschikbaar()) {
    return NextResponse.json({ error: "Authenticatie is niet geconfigureerd." }, { status: 503 });
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES) {
    return NextResponse.json({ error: "Het logo moet een PNG van maximaal 2 MB zijn." }, { status: 400 });
  }
  if (!PNG_MAGIC.every((byte, index) => bytes[index] === byte)) {
    return NextResponse.json({ error: "Het logo moet een PNG van maximaal 2 MB zijn." }, { status: 400 });
  }

  const pad = logoPadVoor(session.orgId as string);
  // Het logo is — anders dan factuur-pdf's — vervangbaar: x-upsert true.
  const geupload = await uploadNaarBucket(pad, bytes, "image/png", true);
  if (!geupload) {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
  const hash = createHash("sha256").update(bytes).digest("hex");

  scheduleAuditEvent({
    action: "facturatie.logo.upload",
    resource: "careon_facturatie_instellingen",
    orgId: session.orgId,
    userId: session.userId,
    detail: { bytes: bytes.byteLength },
  });
  return NextResponse.json({ configured: true, pad, hash });
}
