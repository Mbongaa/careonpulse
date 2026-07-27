"use client";

import { type HrChangeAudit, type HrState, isHrState } from "./types";

const ENDPOINT = "/api/careon/hr";
// Auth loopt via de sessie-cookie (zelfde origin, gaat automatisch mee);
// het oude sync-token is vervangen door echte accounts (handoff 13).
function syncHeaders(extra?: HeadersInit): HeadersInit {
  return { ...extra };
}

export interface RemoteHrResult {
  status: "ok" | "unconfigured" | "failed";
  state: HrState | null;
  revision: number;
}

export async function fetchRemoteHrState(): Promise<RemoteHrResult> {
  try {
    const response = await fetch(ENDPOINT, { cache: "no-store", headers: syncHeaders() });
    if (response.status === 501) return { status: "unconfigured", state: null, revision: 0 };
    if (!response.ok) return { status: "failed", state: null, revision: 0 };

    const payload = (await response.json()) as { configured?: boolean; state?: unknown; revision?: unknown };
    return {
      status: payload.configured === true ? "ok" : "unconfigured",
      state: isHrState(payload.state) ? payload.state : null,
      revision:
        Number.isInteger(payload.revision) && (payload.revision as number) >= 0 ? (payload.revision as number) : 0,
    };
  } catch {
    return { status: "failed", state: null, revision: 0 };
  }
}

export interface PushHrOptions {
  baseRevision: number;
  operationId: string;
  audit: HrChangeAudit;
}

export type PushHrResult =
  | { status: "ok"; revision: number }
  | { status: "conflict"; revision: number; state: HrState | null }
  | { status: "unconfigured" | "failed" };

export async function pushRemoteHrState(state: HrState, options: PushHrOptions): Promise<PushHrResult> {
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
        state: isHrState(payload?.state) ? payload.state : null,
      };
    }
    if (!response.ok || !Number.isInteger(payload?.revision)) return { status: "failed" };
    return { status: "ok", revision: payload?.revision as number };
  } catch {
    return { status: "failed" };
  }
}
