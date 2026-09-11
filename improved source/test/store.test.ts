import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryEventStore } from "../src/store.ts";
import { JsonlFileStore } from "../src/store-file.ts";
import { WebStorageEventStore } from "../src/store-web.ts";
import { makeClick, makeHeader, makePointer } from "./helpers.ts";

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

describe("MemoryEventStore", () => {
  it("round-trips sessions and enforces increasing seq", async () => {
    const store = new MemoryEventStore();
    const header = makeHeader("s1");
    await store.createSession(header);
    await store.append("s1", makePointer(10, 1, 1));
    await store.append("s1", makePointer(20, 2, 2));

    const session = await store.readSession("s1");
    assert.ok(session);
    assert.equal(session.header.sessionId, "s1");
    assert.equal(session.events.length, 2);

    await assert.rejects(() =>
      store.append("s1", {
        ...makePointer(30, 3, 3),
        seq: 0,
      }),
    );
    await assert.rejects(() => store.append("missing", makePointer(40, 4, 4)));
    await assert.rejects(() => store.createSession(header));
  });
});

describe("JsonlFileStore", () => {
  it("persists header + events across instances", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sis-store-"));
    after(() => rm(dir, { recursive: true, force: true }));

    const store = new JsonlFileStore({ rootDir: dir });
    await store.createSession(makeHeader("abc-1"));
    await store.append("abc-1", makePointer(5, 10, 20));
    await store.append("abc-1", makeClick(15, 10, 20));

    const reopened = new JsonlFileStore({ rootDir: dir });
    const session = await reopened.readSession("abc-1");
    assert.ok(session);
    assert.equal(session.events.length, 2);
    assert.equal(session.events[0]?.category, "pointer");
    assert.equal(session.events[1]?.category, "click");

    const headers = await reopened.listSessions();
    assert.equal(headers.length, 1);
    assert.equal(headers[0]?.sessionId, "abc-1");

    const raw = await readFile(join(dir, "sessions", "abc-1.jsonl"), "utf8");
    assert.equal(raw.trim().split("\n").length, 3);

    await assert.rejects(() => reopened.createSession(makeHeader("abc-1")));
    await assert.rejects(() => reopened.readSession("../evil"));
  });

  it("returns [] / null gracefully for missing data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sis-empty-"));
    after(() => rm(dir, { recursive: true, force: true }));
    const store = new JsonlFileStore({ rootDir: join(dir, "nope") });
    assert.deepEqual(await store.listSessions(), []);
    assert.equal(await store.readSession("ghost"), null);
  });
});

describe("WebStorageEventStore", () => {
  it("stores sessions in a Storage implementation with retention", async () => {
    const storage = new FakeStorage();
    const store = new WebStorageEventStore({ storage, maxSessions: 2 });
    await store.createSession(makeHeader("a"));
    await store.createSession(makeHeader("b"));
    await store.createSession(makeHeader("c"));

    const headers = await store.listSessions();
    assert.deepEqual(
      headers.map((h) => h.sessionId),
      ["b", "c"],
      "oldest session should be evicted",
    );
    assert.equal(await storage.getItem("sis:session:a"), null);

    await store.append("b", makePointer(1, 0, 0));
    const session = await store.readSession("b");
    assert.equal(session?.events.length, 1);
  });

  it("falls back to an in-memory store when storage is unavailable", async () => {
    const memoryBacked = new WebStorageEventStore({ storage: null });
    await memoryBacked.createSession(makeHeader("mem"));
    await memoryBacked.append("mem", makePointer(1, 0, 0));
    const session = await memoryBacked.readSession("mem");
    assert.equal(session?.events.length, 1);
    assert.equal((await memoryBacked.listSessions()).length, 1);
  });
});
