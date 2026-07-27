import { NextResponse } from "next/server";

import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { InvalidJsonBodyError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import { requireCareonSession } from "@/lib/supabase/session.server";

// Gesprekkenlijst van de ingelogde gebruiker (handoff 13, fase 3). Alle
// toegang loopt met het JWT van de aanvrager zelf: RLS beperkt tot eigen
// rijen. Zonder Supabase-omgeving 501 → de client blijft op browseropslag.

export const runtime = "nodejs";

const MAX_BODY_BYTES = 12_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_TITLE_CHARS = 200;
const MAX_THREADS = 50;

interface ThreadRow {
  id: string;
  title: string;
  status: "regular" | "archived";
  updated_at: string;
}

export async function GET() {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;

  const params = new URLSearchParams({
    select: "id,title,status,updated_at",
    user_id: `eq.${session.userId}`,
    order: "updated_at.desc",
    limit: String(MAX_THREADS),
  });
  const response = await fetch(`${POSTGREST_URL}/assistant_threads?${params}`, {
    headers: userRestHeaders(session),
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
  const rows = (await response.json()) as ThreadRow[];
  return NextResponse.json({
    configured: true,
    threads: rows.map((row) => ({
      remoteId: row.id,
      title: row.title,
      status: row.status,
      updatedAt: Date.parse(row.updated_at) || Date.now(),
    })),
  });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return await readJsonBodyLimited<Record<string, unknown>>(request, MAX_BODY_BYTES);
  } catch (error) {
    if (!(error instanceof InvalidJsonBodyError)) {
      console.error("Assistant threads body read failed", error);
    }
    return null;
  }
}

/** Aanmaken/aanraken van een gesprek (upsert op (user_id, id)). */
export async function POST(request: Request) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;

  const body = await readBody(request);
  const threadId = body?.threadId;
  if (typeof threadId !== "string" || !ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const response = await fetch(`${POSTGREST_URL}/assistant_threads?on_conflict=user_id,id`, {
    method: "POST",
    headers: userRestHeaders(session, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({
      user_id: session.userId,
      id: threadId,
      org_id: session.orgId,
      status: "regular",
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => null);
  if (!response?.ok) {
    return NextResponse.json({ error: "Gesprek kon niet worden opgeslagen." }, { status: 502 });
  }
  return NextResponse.json({ configured: true });
}

/** Titel of status (archiveren/herstellen) bijwerken. */
export async function PATCH(request: Request) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;

  const body = await readBody(request);
  const threadId = body?.threadId;
  const title = body?.title;
  const status = body?.status;
  const validTitle = title === undefined || (typeof title === "string" && title.length <= MAX_TITLE_CHARS);
  const validStatus = status === undefined || status === "regular" || status === "archived";
  if (
    typeof threadId !== "string" ||
    !ID_PATTERN.test(threadId) ||
    !validTitle ||
    !validStatus ||
    (title === undefined && status === undefined)
  ) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const params = new URLSearchParams({ user_id: `eq.${session.userId}`, id: `eq.${threadId}` });
  const response = await fetch(`${POSTGREST_URL}/assistant_threads?${params}`, {
    method: "PATCH",
    headers: userRestHeaders(session, { Prefer: "return=minimal" }),
    body: JSON.stringify({
      ...(title !== undefined ? { title } : {}),
      ...(status !== undefined ? { status } : {}),
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => null);
  if (!response?.ok) {
    return NextResponse.json({ error: "Gesprek kon niet worden bijgewerkt." }, { status: 502 });
  }
  return NextResponse.json({ configured: true });
}

/** Gesprek + berichten definitief verwijderen (privacy: eigen gesprekken). */
export async function DELETE(request: Request) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;

  const threadId = new URL(request.url).searchParams.get("id") ?? "";
  if (!ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const messageParams = new URLSearchParams({ user_id: `eq.${session.userId}`, thread_id: `eq.${threadId}` });
  const messagesResponse = await fetch(`${POSTGREST_URL}/assistant_messages?${messageParams}`, {
    method: "DELETE",
    headers: userRestHeaders(session, { Prefer: "return=minimal" }),
  }).catch(() => null);
  const threadParams = new URLSearchParams({ user_id: `eq.${session.userId}`, id: `eq.${threadId}` });
  const threadResponse = await fetch(`${POSTGREST_URL}/assistant_threads?${threadParams}`, {
    method: "DELETE",
    headers: userRestHeaders(session, { Prefer: "return=minimal" }),
  }).catch(() => null);
  if (!messagesResponse?.ok || !threadResponse?.ok) {
    return NextResponse.json({ error: "Gesprek kon niet worden verwijderd." }, { status: 502 });
  }
  // Privacy-relevant: verwijdering van een gesprek is zelf auditwaardig
  // (metadata-only, nooit inhoud).
  scheduleAuditEvent({
    action: "assistant.thread.delete",
    resource: "assistant_threads",
    resourceId: threadId,
    orgId: session.orgId,
    userId: session.userId,
  });
  return NextResponse.json({ configured: true });
}
