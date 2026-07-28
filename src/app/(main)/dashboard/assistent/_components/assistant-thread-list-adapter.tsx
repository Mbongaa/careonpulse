"use client";

import { type ReactNode, useMemo } from "react";

import {
  type ExportedMessageRepository,
  type ExportedMessageRepositoryItem,
  RuntimeAdapterProvider,
  useAuiState,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";

import { redigeerFinancieelThreadPayload } from "@/lib/careon-assistant/financieel-gate";
import {
  deleteRemoteThread,
  fetchRemoteRepository,
  listRemoteThreads,
  patchRemoteThread,
  putRemoteMessage,
  touchRemoteThread,
} from "@/lib/careon-assistant/remote-history.client";
import {
  ASSISTANT_HISTORY_RETENTION_MS,
  ASSISTANT_MESSAGES_PREFIX,
  ASSISTANT_THREADS_KEY,
  careonAssistantStorage,
} from "@/lib/careon-assistant/storage.client";
import { isSupabaseAuthMode } from "@/lib/careon-auth";

const FALLBACK_TITLE = "Nieuwe chat";
const MAX_THREADS = 50;

interface StoredThread {
  remoteId: string;
  externalId?: string;
  status?: "regular" | "archived";
  title?: string;
  createdAt?: number;
  updatedAt?: number;
}

interface StoredMessageEntry {
  message?: { id?: string; role?: string; content?: unknown };
  [key: string]: unknown;
}

interface StoredRepository {
  messages: StoredMessageEntry[];
  headId?: string;
  [key: string]: unknown;
}

function messageText(message: StoredMessageEntry["message"]): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("");
}

function cleanTitle(text: string): string {
  const compact = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (!compact) return FALLBACK_TITLE;
  const sentence = compact.split(/[.!?]\s+/)[0] || compact;
  return sentence.length > 44 ? `${sentence.slice(0, 41).trim()}...` : sentence;
}

function titleFromMessages(messages: StoredMessageEntry["message"][]): string {
  const firstUser = messages.find((m) => m?.role === "user");
  return cleanTitle(messageText(firstUser));
}

function normalizeRepository(repository: unknown): StoredRepository {
  const base = repository && typeof repository === "object" ? (repository as StoredRepository) : { messages: [] };
  return {
    ...base,
    messages: Array.isArray(base.messages)
      ? base.messages.filter((entry): entry is StoredMessageEntry => Boolean(entry) && typeof entry === "object")
      : [],
  };
}

// Twee standen (handoff 13):
//  - Supabase-modus: de centrale opslag per gebruiker is de bron van waarheid
//    (/api/assistant/threads); browseropslag blijft de snelle cache en het
//    offline-vangnet. Historie overleeft zo uitloggen en apparaatwissel.
//  - Demo-modus: het oorspronkelijke gedrag — sessionStorage, optioneel korte
//    localStorage-retentie of volledig uit; geheugen als laatste vangnet.
// Inhoud wordt nooit naar de servertelemetrie geschreven.
export class CareonAssistantThreadListAdapter {
  storage = careonAssistantStorage();
  memoryThreads: StoredThread[] = [];
  memoryMessages = new Map<string, StoredRepository>();
  /** Centrale opslag actief; valt bij 501 permanent terug op lokaal. */
  remote = isSupabaseAuthMode();

  /** financieelZichtbaar (rolregel): false = leden — teruggelezen beurten
      worden geredigeerd, ook de lokale cache van een eerdere admin-sessie op
      deze werkplek. */
  constructor(public financieelZichtbaar = true) {}

  unstable_Provider = ({ children }: { children?: ReactNode }) => {
    const threadId = useAuiState((s) => s.threadListItem.remoteId ?? s.threadListItem.id);
    const adapters = useMemo(() => ({ history: new CareonAssistantHistoryAdapter(this, threadId) }), [threadId]);
    return <RuntimeAdapterProvider adapters={adapters}>{children}</RuntimeAdapterProvider>;
  };

  readThreads(): StoredThread[] {
    if (!this.storage) return this.memoryThreads;
    try {
      const parsed: unknown = JSON.parse(this.storage.getItem(ASSISTANT_THREADS_KEY) ?? "[]");
      if (!Array.isArray(parsed)) return [];
      const cutoff = Date.now() - ASSISTANT_HISTORY_RETENTION_MS;
      const valid = parsed.filter(
        (thread): thread is StoredThread =>
          Boolean(thread) &&
          typeof thread === "object" &&
          typeof (thread as StoredThread).remoteId === "string" &&
          ((thread as StoredThread).updatedAt === undefined ||
            ((thread as StoredThread).updatedAt as number) >= cutoff),
      );
      for (const thread of parsed) {
        if (
          thread &&
          typeof thread === "object" &&
          typeof (thread as StoredThread).remoteId === "string" &&
          !valid.includes(thread as StoredThread)
        ) {
          this.storage.removeItem(`${ASSISTANT_MESSAGES_PREFIX}${(thread as StoredThread).remoteId}`);
        }
      }
      if (valid.length !== parsed.length) {
        this.storage.setItem(ASSISTANT_THREADS_KEY, JSON.stringify(valid));
      }
      return valid;
    } catch {
      return [];
    }
  }

  fallbackToMemory() {
    if (!this.storage) return;
    this.memoryThreads = this.readThreads();
    this.storage = null;
  }

  writeThreads(threads: StoredThread[]) {
    const sorted = [...threads].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, MAX_THREADS);
    if (this.storage) {
      try {
        const kept = new Set(sorted.map((thread) => thread.remoteId));
        for (const thread of threads) {
          if (!kept.has(thread.remoteId)) this.storage.removeItem(`${ASSISTANT_MESSAGES_PREFIX}${thread.remoteId}`);
        }
        this.storage.setItem(ASSISTANT_THREADS_KEY, JSON.stringify(sorted));
        return;
      } catch {
        this.fallbackToMemory();
      }
    }
    this.memoryThreads = sorted;
  }

  touchThread(remoteId: string) {
    if (!remoteId) return;
    const now = Date.now();
    const threads = this.readThreads();
    const thread = threads.find((item) => item.remoteId === remoteId);
    if (thread) {
      thread.status = thread.status ?? "regular";
      thread.updatedAt = now;
      this.writeThreads(threads);
      return;
    }
    this.writeThreads([{ remoteId, status: "regular", createdAt: now, updatedAt: now }, ...threads]);
  }

  ensureThreadTitle(remoteId: string, messages: StoredMessageEntry["message"][]) {
    if (!remoteId) return;
    const firstUser = messages.find((m) => m?.role === "user");
    if (!firstUser) return;
    const now = Date.now();
    const title = titleFromMessages(messages);
    const threads = this.readThreads();
    const thread = threads.find((item) => item.remoteId === remoteId);
    if (thread) {
      if (thread.title && thread.title !== FALLBACK_TITLE) return;
      thread.title = title;
      thread.updatedAt = now;
      this.writeThreads(threads);
    } else {
      this.writeThreads([{ remoteId, status: "regular", title, createdAt: now, updatedAt: now }, ...threads]);
    }
    if (this.remote) void patchRemoteThread(remoteId, { title }).then((status) => this.handleRemoteStatus(status));
  }

  /** 501 van de server = demo-modus: schakel definitief terug naar lokaal. */
  handleRemoteStatus(status: "ok" | "unconfigured" | "failed"): boolean {
    if (status === "unconfigured") this.remote = false;
    return status === "ok";
  }

  async list() {
    if (this.remote) {
      const result = await listRemoteThreads();
      if (this.handleRemoteStatus(result.status)) {
        // Centrale lijst is de waarheid; spiegel hem naar de lokale cache.
        this.writeThreads(
          result.threads.map((thread) => ({
            remoteId: thread.remoteId,
            status: thread.status,
            title: thread.title,
            updatedAt: thread.updatedAt,
          })),
        );
        return {
          threads: result.threads.map((thread) => ({
            remoteId: thread.remoteId,
            externalId: undefined,
            status: thread.status,
            title: thread.title,
          })),
        };
      }
    }
    return {
      threads: this.readThreads().map((thread) => ({
        remoteId: thread.remoteId,
        externalId: thread.externalId,
        status: thread.status ?? "regular",
        title: thread.title,
      })),
    };
  }

  async initialize(threadId: string) {
    const now = Date.now();
    const threads = this.readThreads();
    const existing = threads.find((thread) => thread.remoteId === threadId);
    if (existing) {
      existing.status = "regular";
      existing.updatedAt = now;
      this.writeThreads(threads);
    } else {
      this.writeThreads([{ remoteId: threadId, status: "regular", createdAt: now, updatedAt: now }, ...threads]);
    }
    if (this.remote) void touchRemoteThread(threadId).then((status) => this.handleRemoteStatus(status));
    return { remoteId: threadId, externalId: undefined };
  }

  async rename(remoteId: string, newTitle: string) {
    const title = cleanTitle(newTitle);
    const threads = this.readThreads();
    const thread = threads.find((item) => item.remoteId === remoteId);
    if (thread) {
      thread.title = title;
      thread.updatedAt = Date.now();
      this.writeThreads(threads);
    }
    if (this.remote) void patchRemoteThread(remoteId, { title }).then((status) => this.handleRemoteStatus(status));
  }

  async archive(remoteId: string) {
    const threads = this.readThreads();
    const thread = threads.find((item) => item.remoteId === remoteId);
    if (thread) {
      thread.status = "archived";
      thread.updatedAt = Date.now();
      this.writeThreads(threads);
    }
    if (this.remote) {
      void patchRemoteThread(remoteId, { status: "archived" }).then((status) => this.handleRemoteStatus(status));
    }
  }

  async unarchive(remoteId: string) {
    const threads = this.readThreads();
    const thread = threads.find((item) => item.remoteId === remoteId);
    if (thread) {
      thread.status = "regular";
      thread.updatedAt = Date.now();
      this.writeThreads(threads);
    }
    if (this.remote) {
      void patchRemoteThread(remoteId, { status: "regular" }).then((status) => this.handleRemoteStatus(status));
    }
  }

  async delete(remoteId: string) {
    this.writeThreads(this.readThreads().filter((thread) => thread.remoteId !== remoteId));
    if (this.remote) void deleteRemoteThread(remoteId).then((status) => this.handleRemoteStatus(status));
    if (this.storage) {
      try {
        this.storage.removeItem(`${ASSISTANT_MESSAGES_PREFIX}${remoteId}`);
        return;
      } catch {
        this.fallbackToMemory();
      }
    }
    this.memoryMessages.delete(remoteId);
  }

  async fetch(threadId: string) {
    const thread = this.readThreads().find((item) => item.remoteId === threadId);
    if (!thread) throw new Error("Chat niet gevonden");
    return {
      remoteId: thread.remoteId,
      externalId: thread.externalId,
      status: thread.status ?? "regular",
      title: thread.title,
    };
  }

  async generateTitle(remoteId: string, messages: readonly { role?: string; content?: unknown }[]) {
    const title = titleFromMessages(messages as StoredMessageEntry["message"][]);
    await this.rename(remoteId, title);
    return createAssistantStream((controller) => {
      controller.appendText(title);
    });
  }
}

class CareonAssistantHistoryAdapter {
  constructor(
    private owner: CareonAssistantThreadListAdapter,
    private threadId: string | undefined,
  ) {}

  key() {
    return `${ASSISTANT_MESSAGES_PREFIX}${this.threadId}`;
  }

  readRepository(): StoredRepository {
    if (!this.threadId) return { messages: [] };
    if (!this.owner.storage) {
      return normalizeRepository(this.owner.memoryMessages.get(this.threadId) ?? { messages: [] });
    }
    try {
      const raw = this.owner.storage.getItem(this.key());
      return normalizeRepository(raw ? JSON.parse(raw) : { messages: [] });
    } catch {
      this.owner.fallbackToMemory();
      return normalizeRepository(this.owner.memoryMessages.get(this.threadId) ?? { messages: [] });
    }
  }

  writeRepository(repository: StoredRepository) {
    if (!this.threadId) return;
    const normalized = normalizeRepository(repository);
    if (this.owner.storage) {
      try {
        this.owner.storage.setItem(this.key(), JSON.stringify(normalized));
        return;
      } catch {
        this.owner.fallbackToMemory();
      }
    }
    this.owner.memoryMessages.set(this.threadId, normalized);
  }

  /** Financiële rolregel: leden lezen elke beurt door de redactie — de
      server redigeert zelf al, maar de lokale cache kan van een eerdere
      admin-sessie op dezelfde werkplek stammen. */
  private redigeer(repository: StoredRepository): StoredRepository {
    if (this.owner.financieelZichtbaar) return repository;
    return {
      ...repository,
      messages: repository.messages.map((entry) => redigeerFinancieelThreadPayload(entry) as StoredMessageEntry),
    };
  }

  async load(): Promise<ExportedMessageRepository> {
    if (this.threadId && this.owner.remote) {
      const result = await fetchRemoteRepository(this.threadId);
      if (this.owner.handleRemoteStatus(result.status) && result.repository) {
        const repository = this.redigeer(normalizeRepository(result.repository));
        // Centrale stand ook lokaal cachen (sneller + offline-vangnet).
        this.writeRepository(repository);
        return repository as unknown as ExportedMessageRepository;
      }
    }
    // Persisted JSON round-trips exactly what `append` received, so the
    // structural cast back to the library repository type is safe.
    return this.redigeer(this.readRepository()) as unknown as ExportedMessageRepository;
  }

  async append(item: ExportedMessageRepositoryItem) {
    if (!this.threadId) return;
    const repository = this.readRepository();
    const messageId = item.message?.id;
    const nextMessages = [...repository.messages];
    const existingIndex = messageId ? nextMessages.findIndex((entry) => entry.message?.id === messageId) : -1;
    if (existingIndex >= 0) nextMessages[existingIndex] = item;
    else nextMessages.push(item);
    this.writeRepository({ ...repository, messages: nextMessages, headId: messageId ?? repository.headId });
    this.owner.touchThread(this.threadId);
    this.owner.ensureThreadTitle(this.threadId, nextMessages.map((entry) => entry.message).filter(Boolean));
    if (this.owner.remote) {
      void putRemoteMessage(this.threadId, item, messageId).then((status) => this.owner.handleRemoteStatus(status));
    }
  }
}
