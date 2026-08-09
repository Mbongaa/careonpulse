import { NextResponse } from "next/server";

import { redigeerFinancieelThreadPayload } from "@/lib/careon-assistant/financieel-gate";
import { magFinancieelZien } from "@/lib/careon-financieel-rol";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";
import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import { requireCareonSession } from "@/lib/supabase/session.server";

// Berichten van één gesprek (handoff 13, fase 3). Elke rij is één
// repository-item van @assistant-ui (payload verbatim, incl. tool-calls);
// GET reconstrueert de repository ({messages, headId}) exact — behalve voor
// leden: beurten van vóór de financiële rolregel (of van een teruggezette
// beheerder) worden bij het teruglezen geredigeerd (klantbesluit 28-07-2026).

export const runtime = "nodejs";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
// Eén bericht kan een canvas-artefact bevatten; ruim maar begrensd.
const MAX_BODY_BYTES = 400_000;
const MAX_MESSAGES = 500;

interface MessageRow {
  payload: unknown;
}

type RepositoryItem = { message?: { id?: unknown }; parentId?: unknown } | null;

/**
 * De cap houdt de NIEUWSTE berichten aan (daar wijst `head_id` naar). Het
 * oudste bewaarde bericht verwijst dan naar een afgekapte ouder; die keten
 * wordt hier hersteld door zulke items opnieuw te wortelen — @assistant-ui
 * weigert anders de hele import ("Parent message not found") en het gesprek
 * zou helemaal niet meer openen.
 */
function herwortelAfgekapteKeten(items: RepositoryItem[]): { messages: unknown[]; ids: Set<string> } {
  const ids = new Set<string>();
  for (const item of items) {
    const id = item?.message?.id;
    if (typeof id === "string") ids.add(id);
  }
  const messages = items.map((item) => {
    const parentId = item?.parentId;
    if (typeof parentId !== "string" || ids.has(parentId)) return item;
    return { ...item, parentId: null };
  });
  return { messages, ids };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;

  const { id: threadId } = await context.params;
  if (!ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  // Aflopend ophalen en daarna omdraaien: bij een gesprek boven de cap moeten
  // de RECENTE beurten bewaard blijven (het model en de gebruiker lezen die),
  // niet de oudste.
  const messageParams = new URLSearchParams({
    select: "payload",
    user_id: `eq.${session.userId}`,
    thread_id: `eq.${threadId}`,
    order: "id.desc",
    limit: String(MAX_MESSAGES),
  });
  const threadParams = new URLSearchParams({
    select: "head_id",
    user_id: `eq.${session.userId}`,
    id: `eq.${threadId}`,
    limit: "1",
  });
  const [messagesResponse, threadResponse] = await Promise.all([
    fetch(`${POSTGREST_URL}/assistant_messages?${messageParams}`, {
      headers: userRestHeaders(session),
      cache: "no-store",
    }).catch(() => null),
    fetch(`${POSTGREST_URL}/assistant_threads?${threadParams}`, {
      headers: userRestHeaders(session),
      cache: "no-store",
    }).catch(() => null),
  ]);
  if (!messagesResponse?.ok || !threadResponse?.ok) {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
  const rows = (await messagesResponse.json()) as MessageRow[];
  const [thread] = (await threadResponse.json()) as { head_id: string | null }[];
  const financieelZichtbaar = magFinancieelZien(session);
  const { messages, ids } = herwortelAfgekapteKeten(
    rows
      .reverse()
      .map((row) =>
        financieelZichtbaar
          ? (row.payload as RepositoryItem)
          : (redigeerFinancieelThreadPayload(row.payload) as RepositoryItem),
      ),
  );
  // Een head buiten de bewaarde reeks laat @assistant-ui struikelen; dan valt
  // de repository terug op het laatste bericht.
  const headId = thread?.head_id && ids.has(thread.head_id) ? thread.head_id : null;
  return NextResponse.json({
    configured: true,
    repository: {
      messages,
      ...(headId ? { headId } : {}),
    },
  });
}

/** Eén repository-item toevoegen of bijwerken (idempotent op message-id). */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireCareonSession();
  if ("denied" in auth) return auth.denied;
  const session = auth.session;

  const { id: threadId } = await context.params;
  if (!ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  let body: { item?: unknown; headId?: unknown };
  try {
    body = await readJsonBodyLimited<{ item?: unknown; headId?: unknown }>(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestPayloadTooLargeError) {
      return NextResponse.json({ error: "Bericht te groot voor centrale opslag." }, { status: 413 });
    }
    if (!(error instanceof InvalidJsonBodyError)) {
      console.error("Assistant message body read failed", error);
    }
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const item = body.item as { message?: { id?: unknown } } | undefined;
  const messageId = item?.message?.id;
  const headId = body.headId;
  if (
    !item ||
    typeof item !== "object" ||
    typeof messageId !== "string" ||
    !ID_PATTERN.test(messageId) ||
    (headId !== undefined && (typeof headId !== "string" || !ID_PATTERN.test(headId)))
  ) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const upsertResponse = await fetch(`${POSTGREST_URL}/assistant_messages?on_conflict=user_id,thread_id,message_id`, {
    method: "POST",
    headers: userRestHeaders(session, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({
      user_id: session.userId,
      org_id: session.orgId,
      thread_id: threadId,
      message_id: messageId,
      payload: item,
    }),
  }).catch(() => null);
  if (!upsertResponse?.ok) {
    return NextResponse.json({ error: "Bericht kon niet worden opgeslagen." }, { status: 502 });
  }

  // Thread-UPSERT (geen kale PATCH): het aanmaken van de thread loopt async
  // naast het eerste bericht — verliest die race, dan zou een PATCH 0 rijen
  // raken en bleven de berichten wees (de retentie-opruiming loopt via de
  // thread). De upsert raakt titel/status niet aan (alleen meegegeven kolommen).
  await fetch(`${POSTGREST_URL}/assistant_threads?on_conflict=user_id,id`, {
    method: "POST",
    headers: userRestHeaders(session, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({
      user_id: session.userId,
      id: threadId,
      org_id: session.orgId,
      updated_at: new Date().toISOString(),
      ...(headId !== undefined ? { head_id: headId } : {}),
    }),
  }).catch(() => null);

  return NextResponse.json({ configured: true });
}
