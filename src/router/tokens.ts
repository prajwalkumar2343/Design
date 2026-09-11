/**
 * Typed token capability contracts for the Codex router plugin.
 *
 * - `tokens.set`: reversible canvas write. Mutations carry the expected token
 *   revision (in) and report the new revision (out); stale writes are rejected
 *   rather than overwriting newer work. Requests are idempotent by `requestId`,
 *   cancellable via `AbortSignal`, and bounded by op count and timeout.
 * - `tokens.query`: read-only token semantics for agents (names, types,
 *   descriptions, resolved values), with a clamped result limit.
 *
 * Canvas makes no LLM calls here or anywhere else; it owns state, validation,
 * history, and permissions while Codex owns generation and reasoning.
 */
import {
  removeTokenCommand,
  removeTokenSetCommand,
  removeTokenThemeCommand,
  switchTokenThemeCommand,
  upsertTokenCommand,
  upsertTokenSetCommand,
  upsertTokenThemeCommand,
} from "../editor/commands";
import type { EditorStore } from "../editor/store";
import {
  TokenValidationError,
  validateToken,
  validateTokenId,
  validateTokenSet,
  validateTokenTheme,
  type DesignToken,
  type TokenSet,
  type TokenTheme,
  type TokenType,
} from "../tokens";

export const TOKENS_SET_CAPABILITY = "tokens.set" as const;
export const TOKENS_QUERY_CAPABILITY = "tokens.query" as const;
/** Permission class for token mutations: undoable canvas writes. */
export const TOKENS_CAPABILITY_PERMISSION = "reversible-canvas-write" as const;
export const TOKENS_ROUTER_TIMEOUT_MS = 5_000;
export const TOKENS_ROUTER_MAX_TIMEOUT_MS = 30_000;
export const MAX_TOKEN_MUTATION_OPS = 100;
export const MAX_TOKEN_QUERY_LIMIT = 200;
const MAX_COMPLETED_REQUESTS = 100;

export type TokenRouterErrorCode =
  | "invalid-input"
  | "invalid-revision"
  | "stale-revision"
  | "unknown-set"
  | "unknown-token"
  | "unknown-theme"
  | "token-invalid"
  | "too-many-operations"
  | "request-cancelled"
  | "request-timeout"
  | "reducer-failure";

export class TokenRouterError extends Error {
  readonly code: TokenRouterErrorCode;

  constructor(code: TokenRouterErrorCode, message: string) {
    super(message);
    this.name = "TokenRouterError";
    this.code = code;
  }
}

export type TokenMutationOperation =
  | { op: "upsert-set"; set: TokenSet }
  | { op: "remove-set"; setId: string }
  | { op: "upsert-token"; setId: string; token: DesignToken }
  | { op: "remove-token"; setId: string; tokenId: string }
  | { op: "upsert-theme"; theme: TokenTheme }
  | { op: "remove-theme"; themeId: string }
  | { op: "switch-theme"; themeId: string | null };

export interface TokenSetRequest {
  /** Caller-owned idempotency key; redelivery returns the stored result. */
  requestId: string;
  expectedRevision: number;
  operations: TokenMutationOperation[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface TokenMutationResult {
  capability: typeof TOKENS_SET_CAPABILITY;
  permission: typeof TOKENS_CAPABILITY_PERMISSION;
  requestId: string;
  previousRevision: number;
  revision: number;
  changed: boolean;
  appliedOperations: number;
}

export interface TokenQueryRequest {
  /** Case-insensitive name prefix filter, e.g. `color.accent`. */
  prefix?: string;
  type?: TokenType;
  setId?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface TokenQueryEntry {
  id: string;
  name: string;
  type: TokenType;
  value: DesignToken["value"];
  description?: string;
  setId: string;
}

export interface TokenQueryResult {
  capability: typeof TOKENS_QUERY_CAPABILITY;
  revision: number;
  activeThemeId: string | null;
  total: number;
  entries: TokenQueryEntry[];
}

export interface TokenStoreSnapshot {
  revision: number;
  activeThemeId: string | null;
  setCount: number;
  themeCount: number;
  tokenCount: number;
}

function fail(code: TokenRouterErrorCode, message: string): never {
  throw new TokenRouterError(code, message);
}

function checkCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) fail("request-cancelled", "Token request was cancelled");
}

export class TokensService {
  private readonly completedRequests = new Map<string, TokenMutationResult>();

  constructor(private readonly store: EditorStore) {}

  getSnapshot(): TokenStoreSnapshot {
    const tokens = this.store.getState().tokens;
    return {
      revision: tokens.revision,
      activeThemeId: tokens.activeThemeId,
      setCount: Object.keys(tokens.sets).length,
      themeCount: Object.keys(tokens.themes).length,
      tokenCount: Object.values(tokens.sets).reduce(
        (count, set) => count + Object.keys(set.tokens).length,
        0,
      ),
    };
  }

  queryTokens(input: TokenQueryRequest = {}): TokenQueryResult {
    checkCancelled(input.signal);
    const tokens = this.store.getState().tokens;
    const limit = input.limit === undefined
      ? MAX_TOKEN_QUERY_LIMIT
      : Math.max(1, Math.min(MAX_TOKEN_QUERY_LIMIT, Math.floor(input.limit)));
    const prefix = input.prefix?.trim().toLowerCase() ?? "";
    const entries: TokenQueryEntry[] = [];
    const setIds = input.setId !== undefined
      ? [input.setId]
      : Object.keys(tokens.sets).sort();
    for (const setId of setIds) {
      checkCancelled(input.signal);
      const set = tokens.sets[setId];
      if (!set) continue;
      for (const token of Object.values(set.tokens)) {
        if (input.type !== undefined && token.type !== input.type) continue;
        if (prefix && !token.name.toLowerCase().startsWith(prefix)) continue;
        const entry: TokenQueryEntry = {
          id: token.id,
          name: token.name,
          type: token.type,
          value: token.value,
          setId,
        };
        if (token.description !== undefined) entry.description = token.description;
        entries.push(entry);
      }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name) || a.setId.localeCompare(b.setId));
    const total = entries.length;
    return {
      capability: TOKENS_QUERY_CAPABILITY,
      revision: tokens.revision,
      activeThemeId: tokens.activeThemeId,
      total,
      entries: entries.slice(0, limit),
    };
  }

  setTokens(input: TokenSetRequest): TokenMutationResult {
    checkCancelled(input.signal);
    if (typeof input.requestId !== "string" || input.requestId.trim().length === 0) {
      fail("invalid-input", "requestId must be a non-empty idempotency key");
    }
    const stored = this.completedRequests.get(input.requestId);
    if (stored) return stored;
    if (!Array.isArray(input.operations) || input.operations.length === 0) {
      fail("invalid-input", "operations must be a non-empty array");
    }
    if (input.operations.length > MAX_TOKEN_MUTATION_OPS) {
      fail("too-many-operations", `at most ${MAX_TOKEN_MUTATION_OPS} operations per request`);
    }
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      fail("invalid-revision", "expectedRevision must be a safe integer >= 0");
    }
    const timeoutMs = input.timeoutMs === undefined
      ? TOKENS_ROUTER_TIMEOUT_MS
      : Math.max(1, Math.min(TOKENS_ROUTER_MAX_TIMEOUT_MS, Math.floor(input.timeoutMs)));
    const deadline = Date.now() + timeoutMs;

    const before = this.store.getState().tokens;
    if (before.revision !== input.expectedRevision) {
      fail("stale-revision", `Token store is at revision ${before.revision}, not ${input.expectedRevision}`);
    }
    // Fail-closed pre-validation: every op is schema-checked before anything
    // mutates, so a late rejection never leaves a half-applied batch.
    this.validateOperations(input.operations);

    let changed = false;
    try {
      changed = this.store.transact(`${TOKENS_SET_CAPABILITY} (${input.operations.length} ops)`, () => {
        input.operations.forEach((operation) => {
          if (Date.now() > deadline) fail("request-timeout", "Token request exceeded its timeout");
          checkCancelled(input.signal);
          switch (operation.op) {
            case "upsert-set":
              this.store.execute(upsertTokenSetCommand(operation.set), { history: "skip" });
              break;
            case "remove-set":
              this.store.execute(removeTokenSetCommand(operation.setId), { history: "skip" });
              break;
            case "upsert-token":
              this.store.execute(upsertTokenCommand(operation.setId, operation.token), { history: "skip" });
              break;
            case "remove-token":
              this.store.execute(removeTokenCommand(operation.setId, operation.tokenId), { history: "skip" });
              break;
            case "upsert-theme":
              this.store.execute(upsertTokenThemeCommand(operation.theme), { history: "skip" });
              break;
            case "remove-theme":
              this.store.execute(removeTokenThemeCommand(operation.themeId), { history: "skip" });
              break;
            case "switch-theme":
              this.store.execute(switchTokenThemeCommand(operation.themeId), { history: "skip" });
              break;
          }
        });
      });
    } catch (error) {
      if (error instanceof TokenRouterError) throw error;
      fail("reducer-failure", error instanceof Error ? error.message : "Token mutation failed");
    }

    const after = this.store.getState().tokens;
    const result: TokenMutationResult = {
      capability: TOKENS_SET_CAPABILITY,
      permission: TOKENS_CAPABILITY_PERMISSION,
      requestId: input.requestId,
      previousRevision: before.revision,
      revision: after.revision,
      changed,
      appliedOperations: changed ? input.operations.length : 0,
    };
    this.completedRequests.set(input.requestId, result);
    while (this.completedRequests.size > MAX_COMPLETED_REQUESTS) {
      const oldest = this.completedRequests.keys().next().value;
      if (oldest === undefined) break;
      this.completedRequests.delete(oldest);
    }
    return result;
  }

  private validateOperations(operations: TokenMutationOperation[]): void {
    const tokens = this.store.getState().tokens;
    const knownSetIds = new Set(Object.keys(tokens.sets));
    try {
      for (const operation of operations) {
        switch (operation.op) {
          case "upsert-set":
            validateTokenSet(operation.set, "operations.set");
            break;
          case "remove-set": {
            const setId = validateTokenId(operation.setId, "operations.setId");
            if (!tokens.sets[setId]) fail("unknown-set", `Unknown token set: ${setId}`);
            break;
          }
          case "upsert-token": {
            const setId = validateTokenId(operation.setId, "operations.setId");
            if (!tokens.sets[setId]) fail("unknown-set", `Unknown token set: ${setId}`);
            validateToken(operation.token, "operations.token");
            break;
          }
          case "remove-token": {
            const setId = validateTokenId(operation.setId, "operations.setId");
            const tokenId = validateTokenId(operation.tokenId, "operations.tokenId");
            if (!tokens.sets[setId]) fail("unknown-set", `Unknown token set: ${setId}`);
            if (!tokens.sets[setId]?.tokens[tokenId]) fail("unknown-token", `Unknown token: ${tokenId}`);
            break;
          }
          case "upsert-theme":
            validateTokenTheme(operation.theme, "operations.theme", knownSetIds);
            break;
          case "remove-theme": {
            const themeId = validateTokenId(operation.themeId, "operations.themeId");
            if (!tokens.themes[themeId]) fail("unknown-theme", `Unknown theme: ${themeId}`);
            break;
          }
          case "switch-theme": {
            if (operation.themeId === null) break;
            const themeId = validateTokenId(operation.themeId, "operations.themeId");
            if (!tokens.themes[themeId]) fail("unknown-theme", `Unknown theme: ${themeId}`);
            break;
          }
          default:
            fail("invalid-input", "Unknown token operation");
        }
      }
    } catch (error) {
      if (error instanceof TokenRouterError) throw error;
      if (error instanceof TokenValidationError) {
        fail("token-invalid", error.message);
      }
      throw error;
    }
  }
}
