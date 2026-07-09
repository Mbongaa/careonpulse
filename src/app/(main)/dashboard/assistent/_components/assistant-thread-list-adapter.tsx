"use client";

import { type ReactNode, useMemo } from "react";

import {
  type ExportedMessageRepository,
  type ExportedMessageRepositoryItem,
  RuntimeAdapterProvider,
  useAuiState,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";

const THREADS_KEY = "careon:assistent:threads:v1";
const MESSAGES_PREFIX = "careon:assistent:messages:v1:";
const FALLBACK_TITLE = "Nieuwe chat";

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

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    const probe = "__careon_assistent_probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
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

// LocalStorage-backed thread list (falls back to memory when storage is
// unavailable). Mirrors the audited assistant: auto-titles from the first
// user message, archive/delete, per-thread message history.
export class CareonAssistantThreadListAdapter {
  storage = safeStorage();
  memoryThreads: StoredThread[] = [];
  memoryMessages = new Map<string, StoredRepository>();

  unstable_Provider = ({ children }: { children?: ReactNode }) => {
    const threadId = useAuiState((s) => s.threadListItem.remoteId ?? s.threadListItem.id);
    const adapters = useMemo(() => ({ history: new CareonAssistantHistoryAdapter(this, threadId) }), [threadId]);
    return <RuntimeAdapterProvider adapters={adapters}>{children}</RuntimeAdapterProvider>;
  };

  readThreads(): StoredThread[] {
    if (!this.storage) return this.memoryThreads;
    try {
      const parsed = JSON.parse(this.storage.getItem(THREADS_KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed : [];
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
    const sorted = [...threads].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    if (this.storage) {
      try {
        this.storage.setItem(THREADS_KEY, JSON.stringify(sorted));
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
      return;
    }
    this.writeThreads([{ remoteId, status: "regular", title, createdAt: now, updatedAt: now }, ...threads]);
  }

  async list() {
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
    return { remoteId: threadId, externalId: undefined };
  }

  async rename(remoteId: string, newTitle: string) {
    const threads = this.readThreads();
    const thread = threads.find((item) => item.remoteId === remoteId);
    if (!thread) return;
    thread.title = cleanTitle(newTitle);
    thread.updatedAt = Date.now();
    this.writeThreads(threads);
  }

  async archive(remoteId: string) {
    const threads = this.readThreads();
    const thread = threads.find((item) => item.remoteId === remoteId);
    if (!thread) return;
    thread.status = "archived";
    thread.updatedAt = Date.now();
    this.writeThreads(threads);
  }

  async unarchive(remoteId: string) {
    const threads = this.readThreads();
    const thread = threads.find((item) => item.remoteId === remoteId);
    if (!thread) return;
    thread.status = "regular";
    thread.updatedAt = Date.now();
    this.writeThreads(threads);
  }

  async delete(remoteId: string) {
    this.writeThreads(this.readThreads().filter((thread) => thread.remoteId !== remoteId));
    if (this.storage) {
      try {
        this.storage.removeItem(`${MESSAGES_PREFIX}${remoteId}`);
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
    return `${MESSAGES_PREFIX}${this.threadId}`;
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

  async load(): Promise<ExportedMessageRepository> {
    // Persisted JSON round-trips exactly what `append` received, so the
    // structural cast back to the library repository type is safe.
    return this.readRepository() as unknown as ExportedMessageRepository;
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
  }
}
