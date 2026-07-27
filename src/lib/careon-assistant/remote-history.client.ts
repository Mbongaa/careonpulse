"use client";

// Centrale gesprekshistorie (handoff 13, fase 3): dunne client op de
// /api/assistant/threads-routes. Auth loopt via de sessie-cookie. Elke functie
// antwoordt "unconfigured" bij 501 (demo-modus) en "failed" bij netwerkfouten,
// zodat de adapter geruisloos op browseropslag kan terugvallen.

const THREADS_ENDPOINT = "/api/assistant/threads";

export interface RemoteThread {
  remoteId: string;
  title?: string;
  status: "regular" | "archived";
  updatedAt: number;
}

export interface RemoteRepository {
  messages: unknown[];
  headId?: string;
}

type RemoteStatus = "ok" | "unconfigured" | "failed";

export async function listRemoteThreads(): Promise<{ status: RemoteStatus; threads: RemoteThread[] }> {
  try {
    const response = await fetch(THREADS_ENDPOINT, { cache: "no-store" });
    if (response.status === 501) return { status: "unconfigured", threads: [] };
    if (!response.ok) return { status: "failed", threads: [] };
    const payload = (await response.json()) as { threads?: RemoteThread[] };
    return { status: "ok", threads: Array.isArray(payload.threads) ? payload.threads : [] };
  } catch {
    return { status: "failed", threads: [] };
  }
}

export async function touchRemoteThread(threadId: string): Promise<RemoteStatus> {
  try {
    const response = await fetch(THREADS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId }),
    });
    if (response.status === 501) return "unconfigured";
    return response.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

export async function patchRemoteThread(
  threadId: string,
  changes: { title?: string; status?: "regular" | "archived" },
): Promise<RemoteStatus> {
  try {
    const response = await fetch(THREADS_ENDPOINT, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, ...changes }),
    });
    if (response.status === 501) return "unconfigured";
    return response.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

export async function deleteRemoteThread(threadId: string): Promise<RemoteStatus> {
  try {
    const response = await fetch(`${THREADS_ENDPOINT}?id=${encodeURIComponent(threadId)}`, { method: "DELETE" });
    if (response.status === 501) return "unconfigured";
    return response.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

export async function fetchRemoteRepository(
  threadId: string,
): Promise<{ status: RemoteStatus; repository: RemoteRepository | null }> {
  try {
    const response = await fetch(`${THREADS_ENDPOINT}/${encodeURIComponent(threadId)}/messages`, {
      cache: "no-store",
    });
    if (response.status === 501) return { status: "unconfigured", repository: null };
    if (!response.ok) return { status: "failed", repository: null };
    const payload = (await response.json()) as { repository?: RemoteRepository };
    return {
      status: "ok",
      repository:
        payload.repository && Array.isArray(payload.repository.messages) ? payload.repository : { messages: [] },
    };
  } catch {
    return { status: "failed", repository: null };
  }
}

export async function putRemoteMessage(threadId: string, item: unknown, headId?: string): Promise<RemoteStatus> {
  try {
    const response = await fetch(`${THREADS_ENDPOINT}/${encodeURIComponent(threadId)}/messages`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item, ...(headId ? { headId } : {}) }),
    });
    if (response.status === 501) return "unconfigured";
    return response.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}
