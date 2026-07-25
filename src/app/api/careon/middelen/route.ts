import { NextResponse } from "next/server";

import {
  assistantActorHash,
  createAssistantRequestId,
  writeAssistantEvent,
} from "@/lib/careon-assistant/runtime.server";
import { isMiddelenState, type MiddelenChangeAudit, type MiddelenState } from "@/lib/careon-middelen/types";
import { InvalidJsonBodyError, RequestPayloadTooLargeError, readJsonBodyLimited } from "@/lib/http/read-json.server";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SYNC_TOKEN = process.env.NEXT_PUBLIC_CAREON_SYNC_TOKEN;
const MAX_BODY_BYTES = 600_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOOL_PATTERN = /^[a-z0-9_]{1,80}$/;

interface StateRow {
  state: unknown;
  revision: number;
  operation_id?: string | null;
}

interface SaveBody {
  state: MiddelenState;
  baseRevision: number;
  operationId: string;
  audit: MiddelenChangeAudit;
}

function restHeaders(extra?: HeadersInit): HeadersInit {
  return {
    apikey: SERVICE_KEY as string,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function guard(request: Request): NextResponse | null {
  if (!SUPABASE_URL || !SERVICE_KEY || !SYNC_TOKEN) {
    return NextResponse.json({ configured: false }, { status: 501 });
  }
  if (request.headers.get("x-careon-sync") !== SYNC_TOKEN) {
    return NextResponse.json({ error: "Niet geautoriseerd." }, { status: 401 });
  }
  return null;
}

function isAudit(value: unknown): value is MiddelenChangeAudit {
  if (!value || typeof value !== "object") return false;
  const audit = value as Record<string, unknown>;
  return (
    (audit.source === "assistant" || audit.source === "manual") &&
    (audit.toolNames === undefined ||
      (Array.isArray(audit.toolNames) &&
        audit.toolNames.length <= 32 &&
        audit.toolNames.every((name) => typeof name === "string" && TOOL_PATTERN.test(name)))) &&
    (audit.requestIds === undefined ||
      (Array.isArray(audit.requestIds) &&
        audit.requestIds.length <= 12 &&
        audit.requestIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id))))
  );
}

function isSaveBody(value: unknown): value is SaveBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    isMiddelenState(body.state) &&
    Number.isInteger(body.baseRevision) &&
    (body.baseRevision as number) >= 0 &&
    typeof body.operationId === "string" &&
    UUID_PATTERN.test(body.operationId) &&
    isAudit(body.audit)
  );
}

async function latestRow(): Promise<StateRow | null> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/careon_middelen_state?select=state,revision,operation_id&order=revision.desc&limit=1`,
    { headers: restHeaders(), cache: "no-store" },
  );
  if (!response.ok) throw new Error("storage-unavailable");
  const rows = (await response.json()) as StateRow[];
  return rows[0] ?? null;
}

async function operationRow(operationId: string): Promise<StateRow | null> {
  const params = new URLSearchParams({
    select: "state,revision,operation_id",
    operation_id: `eq.${operationId}`,
    limit: "1",
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/careon_middelen_state?${params}`, {
    headers: restHeaders(),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("storage-unavailable");
  const rows = (await response.json()) as StateRow[];
  return rows[0] ?? null;
}

function changedCount<T>(before: T[], after: T[], key: (item: T) => string): number {
  const previous = new Map(before.map((item) => [key(item), JSON.stringify(item)]));
  return after.reduce((total, item) => total + (previous.get(key(item)) === JSON.stringify(item) ? 0 : 1), 0);
}

function changeSummary(previous: MiddelenState | null, next: MiddelenState) {
  const beforeEmployees = previous?.medewerkers ?? [];
  const beforeInventory = previous?.inventaris ?? [];
  const beforeTeams = previous?.teams ?? [];
  const nextTeams = next.teams ?? [];
  const beforeAssigned = beforeEmployees.reduce((sum, employee) => sum + employee.middelen.length, 0);
  const nextAssigned = next.medewerkers.reduce((sum, employee) => sum + employee.middelen.length, 0);

  return {
    employeesAdded: Math.max(0, next.medewerkers.length - beforeEmployees.length),
    employeesRemoved: Math.max(0, beforeEmployees.length - next.medewerkers.length),
    employeesChanged: changedCount(beforeEmployees, next.medewerkers, (employee) => employee.naam),
    inventoryLocationsAdded: Math.max(0, next.inventaris.length - beforeInventory.length),
    inventoryLocationsRemoved: Math.max(0, beforeInventory.length - next.inventaris.length),
    inventoryLocationsChanged: changedCount(beforeInventory, next.inventaris, (location) => location.locatie),
    teamsAdded: Math.max(0, nextTeams.length - beforeTeams.length),
    teamsRemoved: Math.max(0, beforeTeams.length - nextTeams.length),
    assignedAssetsDelta: nextAssigned - beforeAssigned,
    destructive:
      next.medewerkers.length < beforeEmployees.length ||
      next.inventaris.length < beforeInventory.length ||
      nextTeams.length < beforeTeams.length ||
      nextAssigned < beforeAssigned,
  };
}

function validState(row: StateRow | null): MiddelenState | null {
  return row && isMiddelenState(row.state) ? row.state : null;
}

function conflictResponse(row: StateRow | null) {
  return NextResponse.json(
    {
      error: "De centrale registratie is intussen gewijzigd.",
      revision: row ? row.revision : 0,
      state: validState(row),
    },
    { status: 409 },
  );
}

export async function GET(request: Request) {
  const denied = guard(request);
  if (denied) return denied;

  try {
    const row = await latestRow();
    return NextResponse.json({
      configured: true,
      state: validState(row),
      revision: row?.revision ?? 0,
    });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const denied = guard(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await readJsonBodyLimited<unknown>(request, MAX_BODY_BYTES);
  } catch (error) {
    const status = error instanceof RequestPayloadTooLargeError ? 413 : 400;
    if (!(error instanceof RequestPayloadTooLargeError) && !(error instanceof InvalidJsonBodyError)) {
      console.error("Middelen body read failed", error);
    }
    return NextResponse.json({ error: status === 413 ? "Payload te groot." : "Ongeldige JSON." }, { status });
  }
  if (!isSaveBody(body)) {
    return NextResponse.json({ error: "Ongeldige of onvolledige middelen-write." }, { status: 400 });
  }

  const actorHash = assistantActorHash(request);
  const auditRequestId = body.audit.requestIds?.[0] ?? createAssistantRequestId();

  try {
    const existingOperation = await operationRow(body.operationId);
    if (existingOperation) {
      return NextResponse.json({
        configured: true,
        revision: existingOperation.revision,
        idempotent: true,
      });
    }

    const current = await latestRow();
    const currentRevision = current?.revision ?? 0;
    if (body.baseRevision !== currentRevision) {
      void writeAssistantEvent({
        requestId: auditRequestId,
        actorHash,
        eventType: "sync_conflict",
        statusCode: 409,
        toolNames: body.audit.toolNames,
        metadata: { source: body.audit.source, baseRevision: body.baseRevision, currentRevision },
      });
      return conflictResponse(current);
    }

    const revision = currentRevision + 1;
    const summary = changeSummary(validState(current), body.state);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/careon_middelen_state`, {
      method: "POST",
      headers: restHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        state: body.state,
        revision,
        base_revision: body.baseRevision,
        operation_id: body.operationId,
        change_source: body.audit.source,
        change_summary: summary,
        actor_hash: actorHash,
      }),
    });

    if (!response.ok) {
      const repeatedOperation = await operationRow(body.operationId);
      if (repeatedOperation) {
        return NextResponse.json({
          configured: true,
          revision: repeatedOperation.revision,
          idempotent: true,
        });
      }
      const latest = await latestRow();
      if ((latest?.revision ?? 0) !== body.baseRevision) {
        return conflictResponse(latest);
      }
      return NextResponse.json({ error: "Middelen-state kon niet worden opgeslagen." }, { status: 502 });
    }

    void writeAssistantEvent({
      requestId: auditRequestId,
      actorHash,
      eventType: "sync_write",
      statusCode: 200,
      toolNames: body.audit.toolNames,
      metadata: {
        source: body.audit.source,
        revision,
        destructive: summary.destructive,
        employeesChanged: summary.employeesChanged,
        inventoryLocationsChanged: summary.inventoryLocationsChanged,
      },
    });
    return NextResponse.json({ configured: true, revision });
  } catch {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
}
