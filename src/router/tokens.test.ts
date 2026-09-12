import { describe, expect, it } from "vitest";
import { createEditorStore, createEmptyEditorState } from "../editor";
import {
  MAX_TOKEN_QUERY_LIMIT,
  TOKENS_CAPABILITY_PERMISSION,
  TOKENS_QUERY_CAPABILITY,
  TOKENS_SET_CAPABILITY,
  TokenRouterError,
  TokensService,
} from "./tokens";

function createService() {
  return new TokensService(createEditorStore(createEmptyEditorState()));
}

describe("TokensService snapshot and query", () => {
  it("reports a bounded snapshot", () => {
    const snapshot = createService().getSnapshot();
    expect(snapshot.revision).toBe(0);
    expect(snapshot.activeThemeId).toBe("light");
    expect(snapshot.setCount).toBe(4);
    expect(snapshot.themeCount).toBe(3);
    expect(snapshot.tokenCount).toBeGreaterThan(0);
  });

  it("queries token semantics with filters", () => {
    const service = createService();
    const all = service.queryTokens();
    expect(all.capability).toBe(TOKENS_QUERY_CAPABILITY);
    expect(all.total).toBe(all.entries.length);
    const accents = service.queryTokens({ prefix: "color.accent" });
    expect(accents.total).toBeGreaterThan(0);
    expect(accents.entries.every((entry) => entry.name.startsWith("color.accent"))).toBe(true);
    const colors = service.queryTokens({ type: "color" });
    expect(colors.entries.every((entry) => entry.type === "color")).toBe(true);
    expect(colors.entries.some((entry) => entry.description !== undefined)).toBe(true);
  });

  it("clamps query limits for output bounds", () => {
    const service = createService();
    const total = service.queryTokens().total;
    const limited = service.queryTokens({ limit: 2 });
    expect(limited.entries).toHaveLength(Math.min(2, total));
    expect(limited.total).toBe(total);
    const clamped = service.queryTokens({ limit: MAX_TOKEN_QUERY_LIMIT + 500 });
    expect(clamped.entries.length).toBeLessThanOrEqual(MAX_TOKEN_QUERY_LIMIT);
  });

  it("honours cancellation", () => {
    const service = createService();
    const controller = new AbortController();
    controller.abort();
    expect(() => service.queryTokens({ signal: controller.signal })).toThrowError(
      expect.objectContaining({ code: "request-cancelled" }),
    );
    expect(() => service.setTokens({
      requestId: "cancelled",
      expectedRevision: 0,
      operations: [{ op: "switch-theme", themeId: "dark" }],
      signal: controller.signal,
    })).toThrowError(expect.objectContaining({ code: "request-cancelled" }));
  });
});

describe("TokensService tokens.set", () => {
  it("applies a batch as one undoable revision step", () => {
    const store = createEditorStore(createEmptyEditorState());
    const service = new TokensService(store);
    const historyEntries = store.getHistory().past.length;
    const result = service.setTokens({
      requestId: "req-1",
      expectedRevision: 0,
      operations: [
        {
          op: "upsert-token",
          setId: "light",
          token: { id: "light-new", name: "color.test.new", type: "color", value: "#101010" },
        },
        { op: "switch-theme", themeId: "dark" },
      ],
    });
    expect(result).toMatchObject({
      capability: TOKENS_SET_CAPABILITY,
      permission: TOKENS_CAPABILITY_PERMISSION,
      requestId: "req-1",
      previousRevision: 0,
      revision: 2,
      changed: true,
      appliedOperations: 2,
    });
    expect(store.getHistory().past.length).toBe(historyEntries + 1);
    expect(store.getState().tokens.activeThemeId).toBe("dark");
    expect(store.undo()).toBe(true);
    expect(store.getState().tokens.activeThemeId).toBe("light");
    expect(store.getState().tokens.sets.light?.tokens["light-new"]).toBeUndefined();
  });

  it("rejects stale revisions without mutating", () => {
    const store = createEditorStore(createEmptyEditorState());
    const service = new TokensService(store);
    expect(() => service.setTokens({
      requestId: "stale",
      expectedRevision: 9,
      operations: [{ op: "switch-theme", themeId: "dark" }],
    })).toThrowError(expect.objectContaining({ code: "stale-revision" }));
    expect(store.getState().tokens.revision).toBe(0);
    expect(store.getState().tokens.activeThemeId).toBe("light");
  });

  it("returns the stored result for redelivered request ids", () => {
    const service = createService();
    const first = service.setTokens({
      requestId: "idem-1",
      expectedRevision: 0,
      operations: [{ op: "switch-theme", themeId: "dark" }],
    });
    // Redelivery with a now-stale revision still returns the original result.
    const second = service.setTokens({
      requestId: "idem-1",
      expectedRevision: 0,
      operations: [{ op: "switch-theme", themeId: "brand" }],
    });
    expect(second).toEqual(first);
    expect(service.getSnapshot().activeThemeId).toBe("dark");
  });

  it("validates fail-closed with typed codes", () => {
    const service = createService();
    expect(() => service.setTokens({ requestId: "", expectedRevision: 0, operations: [] }))
      .toThrowError(expect.objectContaining({ code: "invalid-input" }));
    expect(() => service.setTokens({
      requestId: "bad-ops",
      expectedRevision: 0,
      operations: [],
    })).toThrowError(expect.objectContaining({ code: "invalid-input" }));
    expect(() => service.setTokens({
      requestId: "bad-set",
      expectedRevision: 0,
      operations: [{ op: "remove-set", setId: "missing" }],
    })).toThrowError(expect.objectContaining({ code: "unknown-set" }));
    expect(() => service.setTokens({
      requestId: "bad-token",
      expectedRevision: 0,
      operations: [{ op: "remove-token", setId: "light", tokenId: "missing" }],
    })).toThrowError(expect.objectContaining({ code: "unknown-token" }));
    expect(() => service.setTokens({
      requestId: "bad-theme",
      expectedRevision: 0,
      operations: [{ op: "switch-theme", themeId: "missing" }],
    })).toThrowError(expect.objectContaining({ code: "unknown-theme" }));
    expect(() => service.setTokens({
      requestId: "bad-value",
      expectedRevision: 0,
      operations: [{
        op: "upsert-token",
        setId: "light",
        token: { id: "x", name: "color.bad", type: "color", value: "nope!!" },
      }],
    })).toThrowError(expect.objectContaining({ code: "token-invalid" }));
    expect(service.getSnapshot().revision).toBe(0);
  });

  it("bounds operations per request", () => {
    const service = createService();
    expect(() => service.setTokens({
      requestId: "too-many",
      expectedRevision: 0,
      operations: Array.from({ length: 101 }, () => ({ op: "switch-theme", themeId: "dark" as const })),
    })).toThrowError(expect.objectContaining({ code: "too-many-operations" }));
  });

  it("renames tokens through the router with reference integrity", () => {
    const store = createEditorStore(createEmptyEditorState());
    const service = new TokensService(store);
    const result = service.setTokens({
      requestId: "rename-1",
      expectedRevision: 0,
      operations: [{ op: "rename-token", setId: "light", tokenId: "light-accent-primary", name: "color.accent.main" }],
    });
    expect(result.changed).toBe(true);
    expect(store.getState().tokens.sets.light?.tokens["light-accent-primary"]?.name).toBe("color.accent.main");
    expect(() => service.setTokens({
      requestId: "rename-bad",
      expectedRevision: 1,
      operations: [{ op: "rename-token", setId: "light", tokenId: "light-accent-primary", name: "Bad Name!" }],
    })).toThrowError(expect.objectContaining({ code: "token-invalid" }));
  });

  it("reports resolved values and alias targets in queries", () => {
    const service = createService();
    const entries = service.queryTokens({ prefix: "color.text" });
    const alias = entries.entries.find((entry) => entry.name === "color.text.primary");
    expect(alias?.value).toBe("{color.ink.primary}");
    expect(alias?.aliasOf).toBe("color.ink.primary");
    expect(alias?.resolvedValue).toBe("#1c1917");
    expect(alias?.aliasStatus).toBeUndefined();
  });

  it("rolls back the whole batch when a late op is unusable", () => {
    const store = createEditorStore(createEmptyEditorState());
    const service = new TokensService(store);
    expect(() => service.setTokens({
      requestId: "rollback",
      expectedRevision: 0,
      operations: [
        {
          op: "upsert-token",
          setId: "light",
          token: { id: "light-temp", name: "color.test.temp", type: "color", value: "#202020" },
        },
        // Passes pre-validation (set exists) but the reducer rejects removal
        // because themes still reference the set; transact must roll back.
        { op: "remove-set", setId: "light" },
      ],
    })).toThrowError(TokenRouterError);
    expect(store.getState().tokens.sets.light?.tokens["light-temp"]).toBeUndefined();
    expect(store.getState().tokens.revision).toBe(0);
  });
});
