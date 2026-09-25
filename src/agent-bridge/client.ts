import type { EditorStore } from "../editor/store";
import { applyAgentOp } from "./apply";
import { AGENT_BRIDGE_BASE, type AgentOpResult } from "./protocol";

export interface AgentBridgeClientOptions {
  /** Server root; defaults to same-origin (the Vite dev/preview server). */
  baseUrl?: string;
  /** Poll cadence while the bridge endpoint is healthy. */
  intervalMs?: number;
  /** Backoff after a failed poll (bridge plugin absent or server down). */
  retryMs?: number;
  fetchImpl?: typeof fetch;
  onApplied?: (seq: number, result: AgentOpResult) => void;
}

interface InboxResponse {
  ops: Array<{ seq: number; op: unknown }>;
  latest: number;
  bootId?: string;
}

/**
 * Polls the dev server's agent inbox and applies each op to the editor store,
 * posting the outcome back so the calling agent can read it. Returns a stop
 * function. When the endpoint does not exist (static hosts without the vite
 * plugin) polling backs off to retryMs and stays silent.
 */
export function startAgentBridge(
  store: EditorStore,
  options: AgentBridgeClientOptions = {},
): () => void {
  const baseUrl = (options.baseUrl ?? "") + AGENT_BRIDGE_BASE;
  const intervalMs = options.intervalMs ?? 600;
  const retryMs = options.retryMs ?? 5_000;
  const fetchImpl = options.fetchImpl ?? fetch;

  // This tab's consumer id: the server hands each op to the first poller it
  // reaches, so a second open tab can't re-apply ops this one owns — and the
  // id rides along on results so the CLI can see which tab answered.
  const consumerId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let stopped = false;
  let lastSeq = 0;
  let bootId: string | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  // Applied ops whose result POST has not landed yet. The op already mutated
  // the store, so dropping the ack would leave the agent's /result long-poll
  // hanging on an op that actually succeeded — retry on the next tick.
  const pendingResults: Array<{ seq: number; result: AgentOpResult }> = [];

  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(tick, delay);
  };

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const response = await fetchImpl(
        `${baseUrl}/inbox?after=${lastSeq}&consumer=${encodeURIComponent(consumerId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`inbox ${response.status}`);
      const body = (await response.json()) as InboxResponse;
      // A restarted server renumbers from 1 — detect it by boot id (a fresh
      // inbox can outgrow the stale cursor within one poll, hiding the seq
      // rollback) and by the rollback itself for servers that predate bootId.
      if (body.bootId !== undefined && body.bootId !== bootId) {
        bootId = body.bootId;
        // Results still queued belong to the previous server instance — under
        // restarted seq numbering they would attach to the wrong ops.
        pendingResults.length = 0;
        // This tick's ops were filtered by the stale cursor — applying them
        // would skip everything at-or-below it permanently. Rewind and let
        // the next poll replay the fresh server's whole inbox. (lastSeq===0
        // fetched ?after=0 already — the whole inbox, nothing withheld.)
        if (lastSeq > 0) {
          lastSeq = 0;
          schedule(intervalMs);
          return;
        }
      } else if (body.latest < lastSeq) {
        lastSeq = 0;
        pendingResults.length = 0;
        schedule(intervalMs);
        return;
      }
      // Apply the whole queued batch with notifications suspended — one React
      // render for the lot instead of one per op (seeding hundreds of frames
      // previously rendered hundreds of times). Results post back afterwards
      // in order; ops read store state synchronously, so deferral is safe.
      const applied: Array<{ seq: number; result: AgentOpResult }> = [];
      store.batchNotifications(() => {
        for (const entry of body.ops) {
          if (entry.seq <= lastSeq || stopped) continue;
          // A drag or in-flight gesture owns the store's transaction — an op
          // applied now would fail outright. Leave it unconsumed; the next
          // poll re-serves it once the gesture releases.
          if (store.hasActiveTransaction()) break;
          lastSeq = entry.seq;
          applied.push({ seq: entry.seq, result: applyAgentOp(store, entry.op) });
        }
      });
      for (const { seq, result } of applied) options.onApplied?.(seq, result);
      pendingResults.push(...applied);
      // The server keeps only the newest 200 results — a deeper backlog would
      // be evicted there anyway, so bound the retry queue the same way.
      if (pendingResults.length > 200) pendingResults.splice(0, pendingResults.length - 200);
      while (pendingResults.length > 0 && !stopped) {
        const { seq, result } = pendingResults[0];
        const post = await fetchImpl(`${baseUrl}/result`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ seq, result, consumer: consumerId }),
        });
        // Keep the failed head in the queue — it retries on the next tick.
        if (!post.ok) throw new Error(`result ${post.status}`);
        pendingResults.shift();
      }
      schedule(intervalMs);
    } catch {
      schedule(retryMs);
    } finally {
      inFlight = false;
    }
  };

  // Release this tab's op claims on unload so ops it never applied (e.g. ones
  // deferred by an unfinished gesture) return to the shared inbox instead of
  // staying claimed by a dead consumer. sendBeacon survives page teardown.
  const releaseClaims = () => {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
    try {
      navigator.sendBeacon(
        `${baseUrl}/release`,
        new Blob([JSON.stringify({ consumer: consumerId })], { type: "application/json" }),
      );
    } catch {
      /* unloading — nothing sensible to retry */
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", releaseClaims);
  }

  void tick();
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", releaseClaims);
    }
  };
}
