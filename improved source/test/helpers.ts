import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionHeader, TrackedEvent } from "../src/events.ts";
import { EVENT_SCHEMA_VERSION } from "../src/events.ts";
import { MemoryEventStore } from "../src/store.ts";
import { JsonlFileStore } from "../src/store-file.ts";
import { WebStorageEventStore } from "../src/store-web.ts";

export function makeHeader(sessionId: string): SessionHeader {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    sessionId,
    startedAtMs: 1_000_000,
    userAgent: "test-agent",
    viewport: { width: 1440, height: 900 },
    appVersion: "test",
  };
}

let seqCounter = 0;
export function makePointer(tMs: number, x: number, y: number): TrackedEvent {
  return {
    category: "pointer",
    kind: "pointer-move",
    seq: seqCounter++,
    atMs: 1_000_000 + tMs,
    tMs,
    x,
    y,
    buttons: 0,
  };
}

export function makeClick(
  tMs: number,
  x: number,
  y: number,
  overrides: Partial<Extract<TrackedEvent, { category: "click" }>> = {},
): TrackedEvent {
  return {
    category: "click",
    kind: "click",
    seq: seqCounter++,
    atMs: 1_000_000 + tMs,
    tMs,
    x,
    y,
    target: "button#dead",
    label: "Dead",
    lookedInteractive: true,
    ...overrides,
  };
}

/** Fake Storage good enough for the web-store backend. */
class FakeStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

export function makeScroll(
  tMs: number,
  delta: number,
  surface = "window",
): TrackedEvent {
  return {
    category: "scroll",
    kind: "scroll",
    seq: 500 + tMs,
    atMs: 1_000_000 + tMs,
    tMs,
    x: 0,
    y: delta,
    delta,
    surface,
  };
}

export function makeUiState(tMs: number, feature: string, to: string): TrackedEvent {
  return {
    category: "ui-state",
    kind: "ui-state-change",
    seq: 10_000 + tMs,
    atMs: 1_000_000 + tMs,
    tMs,
    feature,
    property: "open",
    from: "false",
    to,
  };
}
