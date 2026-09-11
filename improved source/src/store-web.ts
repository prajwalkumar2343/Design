/**
 * Browser storage backend (localStorage).
 *
 * Keeps the newest `maxSessions` sessions and the newest events within each
 * session, so long-running use never grows without bound. Falls back to an
 * in-memory map when storage is unavailable (private mode, quota errors).
 */

import {
  type SessionHeader,
  type StoredSession,
  type TrackedEvent,
} from "./events.ts";
import { MemoryEventStore, type EventStore } from "./store.ts";

const INDEX_KEY = "sis:index";
const SESSION_PREFIX = "sis:session:";
const EVENT_PREFIX = "sis:events:";

export interface WebStorageEventStoreOptions {
  /** Explicit null forces the in-memory fallback (tests, private mode). */
  readonly storage?: Storage | null;
  readonly maxSessions?: number;
  readonly maxEventsPerSession?: number;
}

export class WebStorageEventStore implements EventStore {
  private readonly fallback = new MemoryEventStore();
  private readonly storage: Storage | null;
  private readonly maxSessions: number;
  private readonly maxEventsPerSession: number;

  constructor(options: WebStorageEventStoreOptions = {}) {
    this.storage =
      options.storage === undefined ? safeLocalStorage() : options.storage;
    this.maxSessions = options.maxSessions ?? 30;
    this.maxEventsPerSession = options.maxEventsPerSession ?? 20_000;
  }

  async createSession(header: SessionHeader): Promise<string> {
    if (!this.storage) return this.fallback.createSession(header);
    if (this.readIndex().includes(header.sessionId)) {
      throw new Error(`session already exists: ${header.sessionId}`);
    }
    const index = [...this.readIndex(), header.sessionId];
    while (index.length > this.maxSessions) {
      const evicted = index.shift();
      if (evicted) this.removeSession(evicted);
    }
    this.storage.setItem(INDEX_KEY, JSON.stringify(index));
    this.storage.setItem(SESSION_PREFIX + header.sessionId, JSON.stringify(header));
    this.storage.setItem(EVENT_PREFIX + header.sessionId, JSON.stringify([]));
    return header.sessionId;
  }

  async append(sessionId: string, event: TrackedEvent): Promise<void> {
    if (!this.storage) return this.fallback.append(sessionId, event);
    const raw = this.storage.getItem(EVENT_PREFIX + sessionId);
    if (raw === null) throw new Error(`unknown session: ${sessionId}`);
    const events = JSON.parse(raw) as TrackedEvent[];
    events.push(event);
    const trimmed = events.slice(-this.maxEventsPerSession);
    this.storage.setItem(EVENT_PREFIX + sessionId, JSON.stringify(trimmed));
  }

  async readSession(sessionId: string): Promise<StoredSession | null> {
    if (!this.storage) return this.fallback.readSession(sessionId);
    const headerRaw = this.storage.getItem(SESSION_PREFIX + sessionId);
    if (!headerRaw) return this.fallback.readSession(sessionId);
    const eventsRaw = this.storage.getItem(EVENT_PREFIX + sessionId) ?? "[]";
    return {
      header: JSON.parse(headerRaw) as SessionHeader,
      events: JSON.parse(eventsRaw) as TrackedEvent[],
    };
  }

  async listSessions(): Promise<SessionHeader[]> {
    if (!this.storage) return this.fallback.listSessions();
    const headers: SessionHeader[] = [];
    for (const id of this.readIndex()) {
      const raw = this.storage.getItem(SESSION_PREFIX + id);
      if (raw) headers.push(JSON.parse(raw) as SessionHeader);
    }
    return headers;
  }

  private readIndex(): string[] {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(INDEX_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  }

  private removeSession(sessionId: string): void {
    if (!this.storage) return;
    this.storage.removeItem(SESSION_PREFIX + sessionId);
    this.storage.removeItem(EVENT_PREFIX + sessionId);
  }
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}
