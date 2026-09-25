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
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    on: () => undefined,
    ...overrides,
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

  it("accepts a loopback Origin header", () => {
    const handler = createHandler();
    const res = fakeRes();
    handler(
      fakeReq({ headers: { origin: "http://localhost:4173" } }),
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
});
