import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

// Loopback-only inbox that lets a local agent (Claude Code / Codex with the
// canvas-design plugin) push HTML/CSS into the running canvas. The browser app
// polls GET /inbox and applies ops through the editor store; results travel
// back through POST /result and are read by the agent via a long-polling
// GET /result. The wire base path is mirrored in src/agent-bridge/protocol.ts.
const BASE = "/__canvas-agent";
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_INBOX = 200;
const MAX_RESULTS = 200;
const MAX_RESULT_WAIT_MS = 30_000;

interface InboxEntry {
  seq: number;
  op: unknown;
}

interface ResultWaiter {
  seq: number;
  res: ServerResponse;
  timer: ReturnType<typeof setTimeout>;
}

// Result shape returned for ops evicted from the inbox before the app
// consumed them — an explicit failure instead of a long-poll timeout.
const DROPPED_OP_RESULT = {
  ok: false,
  op: "unknown",
  error: {
    code: "op-dropped",
    message: "The op was evicted from the inbox before the app consumed it",
  },
};

function isLoopback(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress ?? "";
  return (
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote === "::ffff:127.0.0.1" ||
    remote === "::ffff:7f00:1"
  );
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * The socket check alone cannot stop drive-by writes: any web page open in
 * the user's browser can POST to a loopback server (a "simple" text/plain
 * request skips CORS preflight), and the remote address is still 127.0.0.1.
 * Browsers attach Sec-Fetch-Site to every request — including simple ones —
 * so a cross-site page is always distinguishable from the app's own same-
 * origin fetches. Origin is a second signal for clients that send it.
 * Non-browser agents (push-design.mjs) send neither header and stay allowed.
 */
function isSameSiteClient(req: IncomingMessage): boolean {
  const fetchSite = req.headers["sec-fetch-site"];
  if (
    typeof fetchSite === "string" &&
    fetchSite !== "same-origin" &&
    fetchSite !== "same-site" &&
    fetchSite !== "none"
  ) {
    return false;
  }
  const origin = req.headers.origin;
  if (typeof origin === "string") {
    if (origin === "null") return false;
    try {
      if (!LOOPBACK_HOSTNAMES.has(new URL(origin).hostname)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  // The request may already be dead — readBody destroys oversized uploads —
  // and writing to a destroyed socket throws inside the error path itself.
  if (res.destroyed || res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body-too-large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function canvasAgentBridge(): Plugin {
  // Identifies this server instance — a restart renumbers seq from 1, and a
  // fast-refilling inbox can outgrow a client's stale cursor before the seq
  // rollback is detectable. The boot id is not.
  const bootId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let seq = 0;
  const inbox: InboxEntry[] = [];
  const results = new Map<number, unknown>();
  // Seqs evicted from the inbox before the app consumed them — they can never
  // produce a result, so /result resolves them immediately with op-dropped.
  const droppedSeqs = new Set<number>();
  const waiters = new Set<ResultWaiter>();

  const flushWaiters = (finishedSeq: number, result: unknown) => {
    for (const waiter of [...waiters]) {
      if (waiter.seq !== finishedSeq) continue;
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      sendJson(waiter.res, 200, { seq: finishedSeq, result });
    }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.slice(BASE.length) || "/";

    if (!isLoopback(req) || !isSameSiteClient(req)) {
      sendJson(res, 403, { error: { code: "forbidden", message: "Loopback same-site clients only" } });
      return;
    }

    // Declared sizes over the cap get a clean rejection before the socket is
    // destroyed — the streaming overflow check in readBody stays as backstop
    // for chunked bodies without a content-length.
    if (req.method === "POST" && Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) {
      sendJson(res, 413, { error: { code: "body-too-large", message: `Request body exceeds ${MAX_BODY_BYTES} bytes` } });
      req.destroy();
      return;
    }

    if (req.method === "GET" && path === "/ping") {
      sendJson(res, 200, { ok: true, latest: seq, bootId });
      return;
    }

    if (req.method === "POST" && path === "/op") {
      let op: unknown;
      try {
        op = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: { code: "invalid-json", message: "Request body must be JSON" } });
        return;
      }
      seq += 1;
      inbox.push({ seq, op });
      if (inbox.length > MAX_INBOX) {
        for (const evicted of inbox.splice(0, inbox.length - MAX_INBOX)) {
          droppedSeqs.add(evicted.seq);
          flushWaiters(evicted.seq, DROPPED_OP_RESULT);
        }
        while (droppedSeqs.size > MAX_INBOX) {
          droppedSeqs.delete(droppedSeqs.values().next().value as number);
        }
      }
      sendJson(res, 200, { seq });
      return;
    }

    if (req.method === "GET" && path === "/inbox") {
      const after = Number(url.searchParams.get("after") ?? "0");
      sendJson(res, 200, {
        ops: inbox.filter((entry) => entry.seq > after),
        latest: seq,
        bootId,
      });
      return;
    }

    if (req.method === "POST" && path === "/result") {
      let body: { seq?: unknown; result?: unknown };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: { code: "invalid-json", message: "Request body must be JSON" } });
        return;
      }
      const resultSeq = Number(body.seq);
      if (!Number.isSafeInteger(resultSeq) || resultSeq < 1) {
        sendJson(res, 400, { error: { code: "invalid-seq", message: "Result seq must be a positive integer" } });
        return;
      }
      results.set(resultSeq, body.result ?? null);
      if (results.size > MAX_RESULTS) {
        results.delete(results.keys().next().value as number);
      }
      flushWaiters(resultSeq, body.result ?? null);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && path === "/result") {
      const resultSeq = Number(url.searchParams.get("seq") ?? "0");
      if (!Number.isSafeInteger(resultSeq) || resultSeq < 1) {
        sendJson(res, 400, { error: { code: "invalid-seq", message: "seq must be a positive integer" } });
        return;
      }
      if (results.has(resultSeq)) {
        sendJson(res, 200, { seq: resultSeq, result: results.get(resultSeq) });
        return;
      }
      if (droppedSeqs.has(resultSeq)) {
        sendJson(res, 200, { seq: resultSeq, result: DROPPED_OP_RESULT });
        return;
      }
      const timeout = Math.min(
        Math.max(Number(url.searchParams.get("timeout") ?? "15000") || 0, 0),
        MAX_RESULT_WAIT_MS,
      );
      const timer = setTimeout(() => {
        waiters.delete(waiter);
        sendJson(res, 504, {
          seq: resultSeq,
          error: { code: "result-timeout", message: "No result within the timeout" },
        });
      }, timeout);
      const waiter: ResultWaiter = { seq: resultSeq, res, timer };
      waiters.add(waiter);
      res.on("close", () => {
        waiters.delete(waiter);
        clearTimeout(timer);
      });
      return;
    }

    sendJson(res, 404, { error: { code: "not-found", message: `Unknown route: ${path}` } });
  };

  const useMiddleware = (server: {
    middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void };
  }) => {
    server.middlewares.use((req, res, next) => {
      if (
        req.url !== BASE &&
        !req.url?.startsWith(`${BASE}/`) &&
        !req.url?.startsWith(`${BASE}?`)
      ) {
        next();
        return;
      }
      handle(req, res).catch((error) => {
        sendJson(res, 500, {
          error: { code: "internal", message: error instanceof Error ? error.message : String(error) },
        });
      });
    });
  };

  return {
    name: "canvas-agent-bridge",
    configureServer: useMiddleware,
    configurePreviewServer: useMiddleware,
  };
}
