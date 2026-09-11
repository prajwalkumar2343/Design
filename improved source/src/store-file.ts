/**
 * JSONL file store (Node / desktop shell).
 *
 * Layout on disk under `rootDir`:
 *   <rootDir>/sessions/<sessionId>.jsonl
 * Line 1: SessionHeader JSON
 * Lines 2..n: TrackedEvent JSON, append-only.
 *
 * Appends are batched through a per-session write queue and flushed with
 * `fs/promises`, so a crash can lose at most the unflushed tail — never
 * corrupt earlier lines.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type EventCategory,
  type SessionHeader,
  type StoredSession,
  type TrackedEvent,
  assertTrackedEvent,
} from "./events.ts";
import type { EventStore } from "./store.ts";

const KNOWN_CATEGORIES: ReadonlySet<string> = new Set<EventCategory>([
  "pointer",
  "click",
  "scroll",
  "input",
  "prompt",
  "artifact",
  "ui-state",
  "error",
  "custom",
]);

function isTrackedEvent(value: unknown): value is TrackedEvent {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.seq === "number" &&
    typeof candidate.atMs === "number" &&
    typeof candidate.tMs === "number" &&
    typeof candidate.category === "string" &&
    KNOWN_CATEGORIES.has(candidate.category) &&
    typeof candidate.kind === "string"
  );
}

export interface JsonlFileStoreOptions {
  readonly rootDir: string;
}

export class JsonlFileStore implements EventStore {
  private readonly sessionsDir: string;
  private readonly buffers = new Map<string, string[]>();
  private readonly flushing = new Map<string, Promise<void>>();

  constructor(options: JsonlFileStoreOptions) {
    this.sessionsDir = join(options.rootDir, "sessions");
  }

  private sessionPath(sessionId: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) {
      throw new Error(`invalid session id: ${sessionId}`);
    }
    return join(this.sessionsDir, `${sessionId}.jsonl`);
  }

  async createSession(header: SessionHeader): Promise<string> {
    await mkdir(this.sessionsDir, { recursive: true });
    const path = this.sessionPath(header.sessionId);
    let exists = true;
    try {
      await readFile(path, "utf8");
    } catch {
      exists = false;
    }
    if (exists) throw new Error(`session already exists: ${header.sessionId}`);
    await writeFile(path, `${JSON.stringify(header)}\n`, "utf8");
    return header.sessionId;
  }

  async append(sessionId: string, event: TrackedEvent): Promise<void> {
    assertTrackedEvent(event);
    const buffer = this.buffers.get(sessionId) ?? [];
    buffer.push(JSON.stringify(event));
    this.buffers.set(sessionId, buffer);
    await this.flush(sessionId);
  }

  /** Writes buffered lines for a session to disk. */
  async flush(sessionId: string): Promise<void> {
    const pending = this.flushing.get(sessionId);
    if (pending) await pending;
    const buffer = this.buffers.get(sessionId);
    if (!buffer || buffer.length === 0) return;
    this.buffers.set(sessionId, []);
    const payload = buffer.join("\n") + "\n";
    const write = writeFile(this.sessionPath(sessionId), payload, { flag: "a", encoding: "utf8" });
    this.flushing.set(
      sessionId,
      write.then(() => undefined),
    );
    await write;
    this.flushing.delete(sessionId);
  }

  async flushAll(): Promise<void> {
    for (const sessionId of [...this.buffers.keys()]) {
      await this.flush(sessionId);
    }
  }

  async readSession(sessionId: string): Promise<StoredSession | null> {
    const path = this.sessionPath(sessionId); // validates the id before any I/O
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return null;
    }
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    const headerLine = lines[0];
    if (!headerLine) return null;
    const header = JSON.parse(headerLine) as SessionHeader;
    const events: TrackedEvent[] = [];
    for (const line of lines.slice(1)) {
      const parsed: unknown = JSON.parse(line);
      if (isTrackedEvent(parsed)) events.push(parsed);
    }
    return { header, events };
  }

  async listSessions(): Promise<SessionHeader[]> {
    let names: string[];
    try {
      names = await readdir(this.sessionsDir);
    } catch {
      return [];
    }
    const headers: SessionHeader[] = [];
    for (const name of names.filter((n) => n.endsWith(".jsonl")).sort()) {
      try {
        const raw = await readFile(join(this.sessionsDir, name), "utf8");
        const firstLine = raw.split("\n", 1)[0];
        if (firstLine) headers.push(JSON.parse(firstLine) as SessionHeader);
      } catch {
        // Skip unreadable sessions rather than failing every report.
      }
    }
    return headers;
  }
}
