import { describe, expect, it, vi } from "vitest";
import { canvasAgentBridge } from "./vite-plugin-canvas-agent";

type Middleware = (req: FakeReq, res: FakeRes, next: () => void) => void;

function createHandler(): Middleware {
  const plugin = canvasAgentBridge();
  let handler: Middleware | null = null;
  const server = {
    middlewares: {
      use: (fn: Middleware) => {
        handler = fn;
      },
    },
  };
  // The plugin registers identical middleware on dev and preview servers.
  const hook = plugin.configureServer!;
  const fn = typeof hook === "function" ? hook : hook.handler;
  // The hook is this-free — a bare object stands in for the plugin context.
  fn.call({} as never, server as never);
  if (!handler) throw new Error("Plugin did not register middleware");
  return handler;
}

interface FakeReq {
  url: string;
  method: string;
  headers: Record<string, string>;
  socket: { remoteAddress: string };
  on: (event: string, cb?: (chunk?: unknown) => void) => void;
}

function fakeReq(overrides: Partial<FakeReq> = {}): FakeReq {
  return {
    url: "/__canvas-agent/ping",
    method: "GET",
    socket: { remoteAddress: "127.0.0.1" },
    on: () => undefined,
    ...overrides,
    headers: { host: "127.0.0.1:5173", ...overrides.headers },
  };
}

/** A POST request whose body streams in on the next microtask. */
function fakePostReq(url: string, body: unknown): FakeReq {
  const handlers = new Map<string, (chunk?: unknown) => void>();
  return fakeReq({
    url,
    method: "POST",
    on(event, cb) {
      if (cb) handlers.set(event, cb);
      if (event === "end") {
        queueMicrotask(() => {
          handlers.get("data")?.(Buffer.from(JSON.stringify(body)));
          cb?.();
        });
      }
    },
  });
}

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader: (name: string, value: string) => void;
  end: (payload?: string) => void;
  on: () => void;
}

function fakeRes(): FakeRes {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(payload) {
      this.body = payload ?? "";
    },
    on: () => undefined,
  };
}

describe("canvas-agent bridge middleware", () => {
  it("ignores non-bridge paths", () => {
    const handler = createHandler();
    const next = vi.fn();
    handler(fakeReq({ url: "/index.html" }), fakeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("serves ping to a plain loopback client (CLI agents send no fetch headers)", () => {
    const handler = createHandler();
    const res = fakeRes();
    handler(fakeReq(), res, () => undefined);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it("serves ping to the app's own same-origin fetches", () => {
    const handler = createHandler();
    const res = fakeRes();
    handler(
      fakeReq({
        headers: {
          "sec-fetch-site": "same-origin",
          origin: "http://127.0.0.1:5173",
        },
      }),
      res,
      () => undefined,
    );
    expect(res.statusCode).toBe(200);
  });

  it("rejects non-loopback sockets", () => {
    const handler = createHandler();
    const res = fakeRes();
    handler(fakeReq({ socket: { remoteAddress: "192.168.1.20" } }), res, () => undefined);
    expect(res.statusCode).toBe(403);
  });

  it("rejects cross-site browser requests even on a loopback socket", () => {
    const handler = createHandler();
    const res = fakeRes();
    handler(
      fakeReq({ headers: { "sec-fetch-site": "cross-site" } }),
      res,
      () => undefined,
    );
    expect(res.statusCode).toBe(403);
  });

  it("rejects a foreign Origin header", () => {
    const handler = createHandler();
    const res = fakeRes();
    handler(
      fakeReq({ headers: { origin: "https://evil.example" } }),
      res,
      () => undefined,
    );
    expect(res.statusCode).toBe(403);
  });

  it("rejects a null Origin (sandboxed/opaque contexts)", () => {
    const handler = createHandler();
    const res = fakeRes();
    handler(
      fakeReq({ headers: { origin: "null" } }),
      res,
      () => undefined,
    );
    expect(res.statusCode).toBe(403);
  });

  it("rejects a loopback Origin served by a different port", () => {
    const handler = createHandler();
    const res = fakeRes();
    handler(
      fakeReq({ headers: { origin: "http://localhost:4173" } }),
      res,
      () => undefined,
    );
    expect(res.statusCode).toBe(403);
  });

  it("rejects same-site (cross-port) browser fetches", () => {
    const handler = createHandler();
    const res = fakeRes();
    handler(
      fakeReq({ headers: { "sec-fetch-site": "same-site" } }),
      res,
      () => undefined,
    );
    expect(res.statusCode).toBe(403);
  });

  it("accepts an Origin matching this server's host and port", () => {
    const handler = createHandler();
    const res = fakeRes();
    handler(
      fakeReq({ headers: { origin: "http://127.0.0.1:5173" } }),
      res,
      () => undefined,
    );
    expect(res.statusCode).toBe(200);
  });

  it("resolves an evicted op's result poll with op-dropped instead of hanging", async () => {
    const handler = createHandler();
    // Overflow the 200-entry inbox: seq 1 is evicted before any client polls.
    for (let index = 0; index < 201; index += 1) {
      handler(fakePostReq("/__canvas-agent/op", { op: "list" }), fakeRes(), () => undefined);
      // Enqueue happens after the body stream finishes — yield a macrotask so
      // seqs stay ordered and seq 1 is the evicted entry.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const res = fakeRes();
    handler(fakeReq({ url: "/__canvas-agent/result?seq=1&timeout=25" }), res, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const payload = JSON.parse(res.body) as { result?: { error?: { code?: string } } };
    expect(payload.result?.error?.code).toBe("op-dropped");
  });

  it("claims inbox ops for the first consumer and hides them from other tabs", async () => {
    const handler = createHandler();
    handler(fakePostReq("/__canvas-agent/op", { op: "list" }), fakeRes(), () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const first = fakeRes();
    handler(fakeReq({ url: "/__canvas-agent/inbox?after=0&consumer=tab-a" }), first, () => undefined);
    expect((JSON.parse(first.body) as { ops: unknown[] }).ops).toHaveLength(1);

    const otherTab = fakeRes();
    handler(fakeReq({ url: "/__canvas-agent/inbox?after=0&consumer=tab-b" }), otherTab, () => undefined);
    expect((JSON.parse(otherTab.body) as { ops: unknown[] }).ops).toHaveLength(0);

    // The owning consumer still sees its own ops when re-polling.
    const again = fakeRes();
    handler(fakeReq({ url: "/__canvas-agent/inbox?after=0&consumer=tab-a" }), again, () => undefined);
    expect((JSON.parse(again.body) as { ops: unknown[] }).ops).toHaveLength(1);
  });

  it("re-serves ops whose claim lease expired to a different consumer", async () => {
    vi.useFakeTimers();
    try {
      const handler = createHandler();
      handler(fakePostReq("/__canvas-agent/op", { op: "list" }), fakeRes(), () => undefined);
      await vi.advanceTimersByTimeAsync(0);

      const first = fakeRes();
      handler(fakeReq({ url: "/__canvas-agent/inbox?after=0&consumer=tab-a" }), first, () => undefined);
      expect((JSON.parse(first.body) as { ops: unknown[] }).ops).toHaveLength(1);

      // The claiming tab goes silent (closed mid-gesture) — past the lease the
      // op belongs to whoever polls next instead of stranding forever.
      vi.setSystemTime(Date.now() + 61_000);
      const takeover = fakeRes();
      handler(fakeReq({ url: "/__canvas-agent/inbox?after=0&consumer=tab-b" }), takeover, () => undefined);
      expect((JSON.parse(takeover.body) as { ops: unknown[] }).ops).toHaveLength(1);

      // The stale owner's claim is gone — it no longer sees the op either.
      const staleOwner = fakeRes();
      handler(fakeReq({ url: "/__canvas-agent/inbox?after=0&consumer=tab-a" }), staleOwner, () => undefined);
      expect((JSON.parse(staleOwner.body) as { ops: unknown[] }).ops).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases a consumer's claims so another tab can serve them", async () => {
    const handler = createHandler();
    handler(fakePostReq("/__canvas-agent/op", { op: "list" }), fakeRes(), () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    handler(fakeReq({ url: "/__canvas-agent/inbox?after=0&consumer=tab-a" }), fakeRes(), () => undefined);
    const blocked = fakeRes();
    handler(fakeReq({ url: "/__canvas-agent/inbox?after=0&consumer=tab-b" }), blocked, () => undefined);
    expect((JSON.parse(blocked.body) as { ops: unknown[] }).ops).toHaveLength(0);

    const releaseRes = fakeRes();
    handler(fakePostReq("/__canvas-agent/release", { consumer: "tab-a" }), releaseRes, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((JSON.parse(releaseRes.body) as { released?: number }).released).toBe(1);

    const served = fakeRes();
    handler(fakeReq({ url: "/__canvas-agent/inbox?after=0&consumer=tab-b" }), served, () => undefined);
    expect((JSON.parse(served.body) as { ops: unknown[] }).ops).toHaveLength(1);
  });

  it("never re-serves a completed op, even after its claim lease lapses", async () => {
    vi.useFakeTimers();
    try {
      const handler = createHandler();
      handler(fakePostReq("/__canvas-agent/op", { op: "list" }), fakeRes(), () => undefined);
      await vi.advanceTimersByTimeAsync(0);
      handler(fakeReq({ url: "/__canvas-agent/inbox?after=0&consumer=tab-a" }), fakeRes(), () => undefined);
      handler(
        fakePostReq("/__canvas-agent/result", { seq: 1, result: { ok: true }, consumer: "tab-a" }),
        fakeRes(),
        () => undefined,
      );
      await vi.advanceTimersByTimeAsync(0);

      // Owner went silent after applying — the completed op must not replay
      // on another tab (an id-less push would duplicate its frame).
      vi.setSystemTime(Date.now() + 61_000);
      const takeover = fakeRes();
      handler(fakeReq({ url: "/__canvas-agent/inbox?after=0&consumer=tab-b" }), takeover, () => undefined);
      expect((JSON.parse(takeover.body) as { ops: unknown[] }).ops).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("release leaves completed claims in place", async () => {
    const handler = createHandler();
    handler(fakePostReq("/__canvas-agent/op", { op: "list" }), fakeRes(), () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    handler(fakeReq({ url: "/__canvas-agent/inbox?after=0&consumer=tab-a" }), fakeRes(), () => undefined);
    handler(
      fakePostReq("/__canvas-agent/result", { seq: 1, result: { ok: true }, consumer: "tab-a" }),
      fakeRes(),
      () => undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    handler(fakePostReq("/__canvas-agent/release", { consumer: "tab-a" }), fakeRes(), () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const served = fakeRes();
    handler(fakeReq({ url: "/__canvas-agent/inbox?after=0&consumer=tab-b" }), served, () => undefined);
    expect((JSON.parse(served.body) as { ops: unknown[] }).ops).toHaveLength(0);
  });

  it("ignores a late result from a consumer whose claim was taken over", async () => {
    vi.useFakeTimers();
    try {
      const handler = createHandler();
      handler(fakePostReq("/__canvas-agent/op", { op: "list" }), fakeRes(), () => undefined);
      await vi.advanceTimersByTimeAsync(0);
      handler(fakeReq({ url: "/__canvas-agent/inbox?after=0&consumer=tab-a" }), fakeRes(), () => undefined);

      vi.setSystemTime(Date.now() + 61_000);
      handler(fakeReq({ url: "/__canvas-agent/inbox?after=0&consumer=tab-b" }), fakeRes(), () => undefined);

      // The stale owner's late ack must not overwrite the new owner's result.
      const stale = fakeRes();
      handler(
        fakePostReq("/__canvas-agent/result", { seq: 1, result: { ok: true, note: "stale" }, consumer: "tab-a" }),
        stale,
        () => undefined,
      );
      await vi.advanceTimersByTimeAsync(0);
      expect((JSON.parse(stale.body) as { superseded?: boolean }).superseded).toBe(true);

      handler(
        fakePostReq("/__canvas-agent/result", { seq: 1, result: { ok: true, note: "fresh" }, consumer: "tab-b" }),
        fakeRes(),
        () => undefined,
      );
      await vi.advanceTimersByTimeAsync(0);

      const res = fakeRes();
      handler(fakeReq({ url: "/__canvas-agent/result?seq=1&timeout=25" }), res, () => undefined);
      await vi.advanceTimersByTimeAsync(10);
      const payload = JSON.parse(res.body) as { result?: { note?: string }; consumer?: string };
      expect(payload.result?.note).toBe("fresh");
      expect(payload.consumer).toBe("tab-b");
    } finally {
      vi.useRealTimers();
    }
  });

  it("echoes the consumer id that posted a result", async () => {
    const handler = createHandler();
    handler(fakePostReq("/__canvas-agent/op", { op: "list" }), fakeRes(), () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    handler(
      fakePostReq("/__canvas-agent/result", { seq: 1, result: { ok: true }, consumer: "tab-a" }),
      fakeRes(),
      () => undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const res = fakeRes();
    handler(fakeReq({ url: "/__canvas-agent/result?seq=1&timeout=25" }), res, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const payload = JSON.parse(res.body) as { consumer?: string };
    expect(payload.consumer).toBe("tab-a");
  });
});
