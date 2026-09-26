import { applyEditorCommand, type EditorCommand } from "./commands";
import type { EditorState } from "./model";

export interface EditorHistoryEntry {
  label: string;
  before: EditorState;
  after: EditorState;
  effect?: EditorHistoryEffect;
}

export interface EditorHistoryEffect {
  undo: () => void;
  redo: () => void;
}

export interface EditorHistorySnapshot {
  past: readonly EditorHistoryEntry[];
  future: readonly EditorHistoryEntry[];
}

export interface ExecuteCommandOptions {
  history?: "record" | "skip";
  label?: string;
}

export interface ReplaceStateOptions {
  label?: string;
  equals?: (current: EditorState, next: EditorState) => boolean;
}

interface ActiveTransaction {
  label: string;
  before: EditorState;
  effect?: EditorHistoryEffect;
  token: symbol;
}

export type EditorStoreListener = () => void;

export class EditorStore {
  private state: EditorState;
  private past: EditorHistoryEntry[] = [];
  private future: EditorHistoryEntry[] = [];
  private transaction: ActiveTransaction | null = null;
  private deferredNotify = 0;
  private pendingNotify = false;
  private readonly listeners = new Set<EditorStoreListener>();

  constructor(initialState: EditorState) {
    this.state = initialState;
  }

  getState = (): EditorState => this.state;

  subscribe = (listener: EditorStoreListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getHistory = (): EditorHistorySnapshot => ({
    past: [...this.past],
    future: [...this.future],
  });

  canUndo = (): boolean => this.past.length > 0;

  canRedo = (): boolean => this.future.length > 0;

  hasActiveTransaction = (): boolean => this.transaction !== null;

  execute(
    command: EditorCommand,
    options: ExecuteCommandOptions = {},
  ): boolean {
    const previousState = this.state;
    const nextState = applyEditorCommand(previousState, command);
    if (nextState === previousState) {
      return false;
    }

    const historyMode = options.history ?? "record";
    const label = options.label ?? command.type;
    this.state = nextState;

    if (this.transaction) {
      this.notify();
      return true;
    }

    if (historyMode === "record") {
      this.past = [
        ...this.past,
        { label, before: previousState, after: nextState },
      ];
      this.future = [];
    }
    this.notify();
    return true;
  }

  replaceState(nextState: EditorState, options: ReplaceStateOptions = {}): boolean {
    if (this.transaction) {
      throw new Error("Cannot replace state while an editor transaction is active");
    }

    const previousState = this.state;
    if (previousState === nextState || options.equals?.(previousState, nextState)) {
      return false;
    }

    this.state = nextState;
    this.past = [
      ...this.past,
      {
        label: options.label ?? "Replace editor state",
        before: previousState,
        after: nextState,
      },
    ];
    this.future = [];
    this.notify();
    return true;
  }

  /**
   * Returns an ownership token for the opened transaction. Long-lived owners
   * (pointer gestures, async bridge edits) pass it back to commit/rollback so
   * a transaction sealed by another path mid-flight can't be finalized twice
   * or merged into a foreign history entry.
   */
  beginTransaction(label: string, effect?: EditorHistoryEffect): symbol {
    if (this.transaction) {
      throw new Error("An editor transaction is already active");
    }
    const token = Symbol(label);
    this.transaction = { label, before: this.state, effect, token };
    return token;
  }

  /**
   * With `token`, acts only when the caller still owns the active transaction
   * — a mismatched token means another path already sealed the owner's
   * transaction, so this no-ops instead of committing someone else's work.
   */
  commitTransaction(effect?: EditorHistoryEffect, token?: symbol): boolean {
    const transaction = this.transaction;
    if (!transaction) {
      throw new Error("No editor transaction is active");
    }
    if (token !== undefined && transaction.token !== token) {
      return false;
    }
    this.transaction = null;
    const historyEffect = effect ?? transaction.effect;
    if (transaction.before === this.state && !historyEffect) {
      return false;
    }
    this.past = [
      ...this.past,
      {
        label: transaction.label,
        before: transaction.before,
        after: this.state,
        effect: historyEffect,
      },
    ];
    this.future = [];
    this.notify();
    return true;
  }

  rollbackTransaction(token?: symbol): boolean {
    const transaction = this.transaction;
    if (!transaction) {
      throw new Error("No editor transaction is active");
    }
    if (token !== undefined && transaction.token !== token) {
      return false;
    }
    this.transaction = null;
    if (transaction.before === this.state) {
      return false;
    }
    this.state = transaction.before;
    this.notify();
    return true;
  }

  transact(label: string, callback: () => void): boolean {
    this.beginTransaction(label);
    try {
      callback();
      return this.commitTransaction();
    } catch (error) {
      this.rollbackTransaction();
      throw error;
    }
  }

  /**
   * Runs `callback` with listener notifications suspended, flushing a single
   * notify at the end if anything changed. Used by bulk apply paths (agent
   * bridge ops, snapshot ingestion) where each individual execute would
   * otherwise schedule its own React render — N ops went through N renders.
   * Transactions inside the callback keep their own history entries; only the
   * intermediate notifies are coalesced.
   */
  batchNotifications(callback: () => void): void {
    this.suspendNotifications();
    try {
      callback();
    } finally {
      this.resumeNotifications();
    }
  }

  suspendNotifications(): void {
    this.deferredNotify += 1;
  }

  resumeNotifications(): void {
    if (this.deferredNotify === 0) return;
    this.deferredNotify -= 1;
    if (this.deferredNotify === 0 && this.pendingNotify) {
      this.pendingNotify = false;
      this.notify();
    }
  }

  undo(): boolean {
    if (this.transaction) {
      throw new Error("Cannot undo while an editor transaction is active");
    }
    const entry = this.past.at(-1);
    if (!entry) {
      return false;
    }
    this.past = this.past.slice(0, -1);
    this.future = [entry, ...this.future];
    this.state = entry.before;
    entry.effect?.undo();
    this.notify();
    return true;
  }

  redo(): boolean {
    if (this.transaction) {
      throw new Error("Cannot redo while an editor transaction is active");
    }
    const entry = this.future[0];
    if (!entry) {
      return false;
    }
    this.future = this.future.slice(1);
    this.past = [...this.past, entry];
    this.state = entry.after;
    entry.effect?.redo();
    this.notify();
    return true;
  }

  private notify(): void {
    if (this.deferredNotify > 0) {
      this.pendingNotify = true;
      return;
    }
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function createEditorStore(initialState: EditorState): EditorStore {
  return new EditorStore(initialState);
}
