/**
 * Engine-state persistence (JSON on disk / localStorage / memory).
 *
 * The engine state is tiny (dozens of records) so a single JSON document per
 * backend is the right shape — no schema gymnastics.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { emptyEngineState, type EngineState, type EngineStateStore } from "./engine.ts";

function isEngineState(value: unknown): value is EngineState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.records) &&
    typeof candidate.active === "object" &&
    candidate.active !== null &&
    Array.isArray(candidate.verdicts)
  );
}

export class JsonFileStateStore implements EngineStateStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<EngineState> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed: unknown = JSON.parse(raw);
      return isEngineState(parsed) ? parsed : emptyEngineState();
    } catch {
      return emptyEngineState();
    }
  }

  async save(state: EngineState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(state, null, 2), "utf8");
  }
}

const STATE_KEY = "sis:engine-state";

export class WebStorageStateStore implements EngineStateStore {
  private readonly storage: Storage | null;

  constructor(storage?: Storage) {
    try {
      this.storage = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
    } catch {
      this.storage = null;
    }
  }

  async load(): Promise<EngineState> {
    if (!this.storage) return emptyEngineState();
    try {
      const raw = this.storage.getItem(STATE_KEY);
      if (!raw) return emptyEngineState();
      const parsed: unknown = JSON.parse(raw);
      return isEngineState(parsed) ? parsed : emptyEngineState();
    } catch {
      return emptyEngineState();
    }
  }

  async save(state: EngineState): Promise<void> {
    if (!this.storage) return;
    try {
      this.storage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      // Quota errors are non-fatal; the loop keeps running in memory.
    }
  }
}
