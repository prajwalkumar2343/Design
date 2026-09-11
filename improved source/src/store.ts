/**
 * Local-first event storage.
 *
 * Everything the tracker records stays on the user's machine. Three backends
 * share one interface:
 *  - MemoryEventStore      — tests and ephemeral use.
 *  - JsonlFileStore        — Node/desktop: one JSONL file per session (append-only).
 *  - WebStorageEventStore  — browser: localStorage-backed with bounded retention.
 *
 * The JSONL layout (one session header line, then one event per line) matches
 * how production pipelines keep raw facts cheap to append and replay.
 */

import {
  type SessionHeader,
  type StoredSession,
  type TrackedEvent,
  assertTrackedEvent,
} from "./events.ts";

export interface EventStore {
  /** Creates a session and returns its id. */
  createSession(header: SessionHeader): Promise<string>;
  /** Appends one event; `seq` must be strictly increasing within a session. */
  append(sessionId: string, event: TrackedEvent): Promise<void>;
  readSession(sessionId: string): Promise<StoredSession | null>;
  listSessions(): Promise<SessionHeader[]>;
}

export class MemoryEventStore implements EventStore {
  private readonly sessions = new Map<string, { header: SessionHeader; events: TrackedEvent[] }>();

  async createSession(header: SessionHeader): Promise<string> {
    if (this.sessions.has(header.sessionId)) {
      throw new Error(`session already exists: ${header.sessionId}`);
    }
    this.sessions.set(header.sessionId, { header, events: [] });
    return header.sessionId;
  }

  async append(sessionId: string, event: TrackedEvent): Promise<void> {
    assertTrackedEvent(event);
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`unknown session: ${sessionId}`);
    const last = session.events.at(-1);
    if (last && event.seq <= last.seq) {
      throw new Error(`event seq must increase: ${event.seq} <= ${last.seq}`);
    }
    session.events.push(event);
  }

  async readSession(sessionId: string): Promise<StoredSession | null> {
    const session = this.sessions.get(sessionId);
    return session ? { header: session.header, events: [...session.events] } : null;
  }

  async listSessions(): Promise<SessionHeader[]> {
    return [...this.sessions.values()].map((s) => s.header);
  }
}
