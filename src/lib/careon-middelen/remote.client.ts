"use client";

import { isMiddelenState, type MiddelenChangeAudit, type MiddelenState } from "./types";

const ENDPOINT = "/api/careon/middelen";

// Auth loopt via de sessie-cookie (zelfde origin, gaat automatisch mee);
// het oude sync-token is vervangen door echte accounts (handoff 13).
function syncHeaders(extra?: HeadersInit): HeadersInit {
  return { ...extra };
}

export interface RemoteMiddelenResult {
  status: "ok" | "unconfigured" | "failed";
  state: MiddelenState | null;
  revision: number;
}

export async function fetchRemoteMiddelenState(): Promise<RemoteMiddelenResult> {
  try {
    const response = await fetch(ENDPOINT, { cache: "no-store", headers: syncHeaders() });
    if (response.status === 501) return { status: "unconfigured", state: null, revision: 0 };
    if (!response.ok) return { status: "failed", state: null, revision: 0 };

    const payload = (await response.json()) as { configured?: boolean; state?: unknown; revision?: unknown };
    return {
      status: payload.configured === true ? "ok" : "unconfigured",
      state: isMiddelenState(payload.state) ? payload.state : null,
      revision:
        Number.isInteger(payload.revision) && (payload.revision as number) >= 0 ? (payload.revision as number) : 0,
    };
  } catch {
    return { status: "failed", state: null, revision: 0 };
  }
}

export interface PushMiddelenOptions {
  baseRevision: number;
  operationId: string;
  audit: MiddelenChangeAudit;
}

export type PushMiddelenResult =
  | { status: "ok"; revision: number }
  | { status: "conflict"; revision: number; state: MiddelenState | null }
  | { status: "unconfigured" | "failed" };

export async function pushRemoteMiddelenState(
  state: MiddelenState,
  options: PushMiddelenOptions,
): Promise<PushMiddelenResult> {
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: syncHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ state, ...options }),
    });
    if (response.status === 501) return { status: "unconfigured" };

    const payload = (await response.json().catch(() => null)) as { revision?: unknown; state?: unknown } | null;
    if (response.status === 409) {
      return {
        status: "conflict",
        revision: Number.isInteger(payload?.revision) ? (payload?.revision as number) : options.baseRevision,
        state: isMiddelenState(payload?.state) ? payload.state : null,
      };
    }
    if (!response.ok || !Number.isInteger(payload?.revision)) return { status: "failed" };
    return { status: "ok", revision: payload?.revision as number };
  } catch {
    return { status: "failed" };
  }
}
