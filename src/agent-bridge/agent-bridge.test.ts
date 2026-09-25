import { describe, expect, it } from "vitest";

import {
  createEditorStateFromFrameSeeds,
  createEmptyEditorState,
  type FrameSeed,
} from "../editor/model";
import { startBrainstormSessionCommand } from "../editor/commands";
import { createEditorStore } from "../editor/store";
import { applyAgentOp } from "./apply";
import { buildDesignDocumentHtml } from "./protocol";
import { startAgentBridge } from "./client";

const doc = (body: string) =>
  `<!doctype html><html lang="en"><head><title>T</title></head><body>${body}</body></html>`;

function frame(overrides: Partial<FrameSeed> = {}): FrameSeed {
  return {
    id: "desktop",
    name: "Desktop",
    documentId: "doc-1",
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
    srcDoc: doc("<main>One</main>"),
    background: "#fff",
    ...overrides,
  };
}

function storeWith(frames: FrameSeed[] = []) {
  return createEditorStore(
    frames.length ? createEditorStateFromFrameSeeds(frames) : createEmptyEditorState(),
  );
}

describe("buildDesignDocumentHtml", () => {
  it("returns null when nothing renderable is supplied", () => {
    expect(buildDesignDocumentHtml({})).toBeNull();
    expect(buildDesignDocumentHtml({ html: "   " })).toBeNull();
  });

  it("wraps a fragment and css into a complete document", () => {
    const html = buildDesignDocumentHtml({
      fragment: '<main class="hero">Hi</main>',
      css: ".hero { color: red; }",
      title: "Hero",
    })!;
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("<title>Hero</title>");
    expect(html).toContain(".hero { color: red; }");
    expect(html).toContain('<main class="hero">Hi</main>');
  });

  it("injects css into a complete document before </head>", () => {
    const html = buildDesignDocumentHtml({ html: doc("<p>x</p>"), css: "p { margin: 0; }" })!;
    expect(html.indexOf("p { margin: 0; }")).toBeLessThan(html.indexOf("</head>"));
    expect(html).toContain("data-canvas-agent-css");
  });

  it("treats doctype-less html as a fragment", () => {
    const html = buildDesignDocumentHtml({ html: "<section>Partial</section>" })!;
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("<section>Partial</section>");
  });

  it("escapes </style sequences inside css", () => {
    const html = buildDesignDocumentHtml({ fragment: "x", css: "a::after{content:'</style>'}" })!;
    expect(html).not.toContain("</style>'}");
  });

  it("keeps the doctype first when injecting css into a doctype-only document", () => {
    // "<!doctype html><p>x</p>" has no <html>/<head> tags — the style must
    // land after the doctype (implicit head), not before it.
    const html = buildDesignDocumentHtml({
      html: "<!doctype html><p>x</p>",
      css: "p { margin: 0; }",
    })!;
    expect(html.indexOf("<!doctype")).toBe(0);
    expect(html.indexOf("<!doctype")).toBeLessThan(html.indexOf("<style"));
    expect(html.indexOf("<style")).toBeLessThan(html.indexOf("<p>x</p>"));
  });
});

describe("applyAgentOp push (create)", () => {
  it("creates a design frame on a fresh agent page when the canvas is empty", () => {
    const store = storeWith();
    const result = applyAgentOp(store, { op: "push", html: doc("<h1>Hi</h1>"), name: "Hero" });
    expect(result.ok).toBe(true);

    const state = store.getState();
    const frame = Object.values(state.frames)[0];
    expect(frame.name).toBe("Hero");
    expect(frame.width).toBe(1440);
    expect(frame.height).toBe(900);
    expect(state.documents[frame.documentId].mode).toBe("design");
    expect(state.activePageId).toBe(frame.pageId);
    expect(state.selection.primaryFrameId).toBe(frame.id);
    expect(result).toMatchObject({ created: true, frameId: frame.id });
  });

  it("auto-places to the right of existing frames on the active page", () => {
    const store = storeWith([frame()]);
    const result = applyAgentOp(store, { op: "push", html: doc("<p>new</p>") });
    expect(result.ok).toBe(true);
    const created = Object.values(store.getState().frames).find((f) => f.id !== "desktop")!;
    expect(created.pageId).toBe("page-1");
    expect(created.x).toBe(1440 + 120);
    expect(created.y).toBe(0);
  });

  it("honors explicit geometry, id, and background", () => {
    const store = storeWith();
    const result = applyAgentOp(store, {
      op: "push",
      id: "hero",
      html: doc("<p>x</p>"),
      x: 500,
      y: -200,
      width: 390,
      height: 844,
      background: "#000",
    });
    expect(result).toMatchObject({ ok: true, frameId: "hero", documentId: "hero-doc", x: 500 });
    const frame = store.getState().frames["hero"];
    expect(frame).toMatchObject({ x: 500, y: -200, width: 390, height: 844, background: "#000" });
  });

  it("uses the document title as the frame name when none is given", () => {
    const store = storeWith();
    applyAgentOp(store, { op: "push", html: doc("<p>x</p>") });
    const frame = Object.values(store.getState().frames)[0];
    expect(frame.name).toBe("T");
  });

  it("rejects invalid html without mutating state", () => {
    const store = storeWith();
    const result = applyAgentOp(store, { op: "push", html: "not a document" });
    // doctype-less html is wrapped as a fragment, so this is valid — use a
    // reserved marker instead to trip admission.
    expect(result.ok).toBe(true);
    const bad = applyAgentOp(store, {
      op: "push",
      html: doc('<div data-design-tool-iframe-bridge>x</div>'),
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("reserved-runtime-marker");
  });

  it("refuses design pushes while a brainstorm session is briefing", () => {
    const store = storeWith();
    store.execute(
      startBrainstormSessionCommand({ sessionId: "s-1", briefFrameId: "b-1" }, 0),
      { label: "start" },
    );
    const result = applyAgentOp(store, { op: "push", html: doc("<p>x</p>") });
    expect(result).toMatchObject({ ok: false, error: { code: "brainstorm-wireframe-required" } });
    expect(Object.keys(store.getState().frames)).toHaveLength(0);
  });
});

describe("applyAgentOp push (replace)", () => {
  it("replaces the document when id matches an existing frame", () => {
    const store = storeWith([frame()]);
    const result = applyAgentOp(store, { op: "push", id: "desktop", html: doc("<main>Two</main>") });
    expect(result).toMatchObject({ ok: true, created: false, frameId: "desktop", documentId: "doc-1" });
    const document = store.getState().documents["doc-1"];
    expect(document.srcDoc).toContain("Two");
    expect(document.revision).toBe(2);
  });

  it("replaces via documentId", () => {
    const store = storeWith([frame()]);
    const result = applyAgentOp(store, { op: "push", documentId: "doc-1", html: doc("<main>Three</main>") });
    expect(result).toMatchObject({ ok: true, created: false, frameId: null, documentId: "doc-1" });
  });

  it("patches frame sizing on replace", () => {
    const store = storeWith([frame()]);
    applyAgentOp(store, { op: "push", id: "desktop", html: doc("<p>v2</p>"), width: 390, name: "Phone" });
    const updated = store.getState().frames["desktop"];
    expect(updated.width).toBe(390);
    expect(updated.name).toBe("Phone");
  });
});

describe("applyAgentOp remove / list", () => {
  it("removes a frame", () => {
    const store = storeWith([frame()]);
    const result = applyAgentOp(store, { op: "remove", frameId: "desktop" });
    expect(result).toMatchObject({ ok: true, frameId: "desktop" });
    expect(store.getState().frames["desktop"]).toBeUndefined();
  });

  it("fails remove for unknown frames", () => {
    const store = storeWith();
    const result = applyAgentOp(store, { op: "remove", frameId: "nope" });
    expect(result).toMatchObject({ ok: false, error: { code: "frame-not-found" } });
  });

  it("lists canvas state", () => {
    const store = storeWith([frame()]);
    const result = applyAgentOp(store, { op: "list" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const frames = result.frames as Array<{ id: string }>;
      const documents = result.documents as Array<{ id: string; revision: number }>;
      expect(frames.map((f) => f.id)).toEqual(["desktop"]);
      expect(documents[0]).toMatchObject({ id: "doc-1", revision: 1 });
    }
  });

  it("rejects unknown ops without throwing", () => {
    const store = storeWith();
    expect(applyAgentOp(store, { op: "explode" })).toMatchObject({
      ok: false,
      error: { code: "invalid-op" },
    });
    expect(applyAgentOp(store, "garbage")).toMatchObject({ ok: false });
  });
});

describe("startAgentBridge", () => {
  it("polls the inbox, applies ops, and posts results back", async () => {
    const store = storeWith();
    const posted: Array<{ seq: number; result: { ok: boolean } }> = [];
    let inboxCalls = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/inbox")) {
        inboxCalls += 1;
        const ops = inboxCalls === 1 ? [{ seq: 1, op: { op: "push", id: "a", html: doc("<p>x</p>") } }] : [];
        return new Response(JSON.stringify({ ops, latest: 1 }), { status: 200 });
      }
      if (url.includes("/result")) {
        posted.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    };

    const stop = startAgentBridge(store, { fetchImpl, intervalMs: 2, retryMs: 2 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    stop();

    expect(store.getState().frames["a"]).toBeDefined();
    expect(posted[0]).toMatchObject({ seq: 1, result: { ok: true } });
  });

  it("retries a failed result post instead of dropping the ack", async () => {
    const store = storeWith();
    const posted: Array<{ seq: number }> = [];
    let inboxCalls = 0;
    let failFirstResult = true;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/inbox")) {
        inboxCalls += 1;
        const ops = inboxCalls === 1 ? [{ seq: 1, op: { op: "push", id: "a", html: doc("<p>x</p>") } }] : [];
        return new Response(JSON.stringify({ ops, latest: 1 }), { status: 200 });
      }
      if (url.includes("/result")) {
        if (failFirstResult) {
          failFirstResult = false;
          return new Response("boom", { status: 500 });
        }
        posted.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    };

    const stop = startAgentBridge(store, { fetchImpl, intervalMs: 2, retryMs: 2 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    stop();

    // The op applied on the first tick; its result lands on a later retry.
    expect(store.getState().frames["a"]).toBeDefined();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ seq: 1, result: { ok: true } });
  });

  it("replays the inbox after a server restart renumbers seqs", async () => {
    const store = storeWith();
    const push = (id: string) => ({ op: "push", id, html: doc(`<p>${id}</p>`) });
    // Generation A delivers seqs 1..3; a restarted server renumbers from 1.
    const inboxA = [1, 2, 3].map((seq) => ({ seq, op: push(`a${seq}`) }));
    const inboxB = [1, 2].map((seq) => ({ seq, op: push(`b${seq}`) }));
    let inbox = inboxA;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/inbox")) {
        const after = Number(new URL(url, "http://l").searchParams.get("after") ?? "0");
        // Mirror the server: ?after= filters strictly greater seqs.
        return new Response(
          JSON.stringify({ ops: inbox.filter((e) => e.seq > after), latest: inbox.length }),
          { status: 200 },
        );
      }
      if (url.includes("/result")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    };

    const stop = startAgentBridge(store, { fetchImpl, intervalMs: 2, retryMs: 2 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(store.getState().frames["a3"]).toBeDefined();

    inbox = inboxB; // server restarted — its ?after=N filter now withholds ops 1..N
    await new Promise((resolve) => setTimeout(resolve, 60));
    stop();

    // lastSeq must rewind to 0 so the fresh inbox replays — not snap forward
    // to the new latest and drop every queued op.
    expect(store.getState().frames["b1"]).toBeDefined();
    expect(store.getState().frames["b2"]).toBeDefined();
  });

  it("detects a restart whose fresh inbox already outgrew the stale cursor", async () => {
    const store = storeWith();
    const push = (id: string) => ({ op: "push", id, html: doc(`<p>${id}</p>`) });
    // Generation A leaves the cursor at seq 3. The restarted server then
    // receives a burst bigger than 3 before the next poll — its latest (5)
    // is AHEAD of the cursor, so only the boot id change betrays it.
    const inboxA = [1, 2, 3].map((seq) => ({ seq, op: push(`a${seq}`) }));
    const inboxB = [1, 2, 3, 4, 5].map((seq) => ({ seq, op: push(`b${seq}`) }));
    let inbox = inboxA;
    let bootId = "boot-a";
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/inbox")) {
        const after = Number(new URL(url, "http://l").searchParams.get("after") ?? "0");
        return new Response(
          JSON.stringify({
            ops: inbox.filter((e) => e.seq > after),
            latest: inbox.length,
            bootId,
          }),
          { status: 200 },
        );
      }
      if (url.includes("/result")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    };

    const stop = startAgentBridge(store, { fetchImpl, intervalMs: 2, retryMs: 2 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(store.getState().frames["a3"]).toBeDefined();

    inbox = inboxB;
    bootId = "boot-b"; // restart: seqs restarted at 1 but latest (5) > cursor (3)
    await new Promise((resolve) => setTimeout(resolve, 60));
    stop();

    // Without the boot-id check the client keeps polling ?after=3 and only
    // b4/b5 ever arrive — b1..b3 are dropped permanently.
    for (const id of ["b1", "b2", "b3", "b4", "b5"]) {
      expect(store.getState().frames[id]).toBeDefined();
    }
  });

  it("defers ops while a gesture transaction owns the store, then applies them", async () => {
    const store = storeWith();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/inbox")) {
        const after = Number(new URL(url, "http://l").searchParams.get("after") ?? "0");
        const ops = [{ seq: 1, op: { op: "push", id: "a", html: doc("<p>x</p>") } }];
        return new Response(JSON.stringify({ ops: ops.filter((e) => e.seq > after), latest: 1 }), { status: 200 });
      }
      if (url.includes("/result")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    };

    const token = store.beginTransaction("drag");
    const stop = startAgentBridge(store, { fetchImpl, intervalMs: 2, retryMs: 2 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    // The op stays unconsumed while the drag holds the transaction.
    expect(store.getState().frames["a"]).toBeUndefined();

    store.commitTransaction(undefined, token);
    await new Promise((resolve) => setTimeout(resolve, 40));
    stop();
    expect(store.getState().frames["a"]).toBeDefined();
  });

  it("sends a stable consumer id on inbox polls and result posts", async () => {
    const store = storeWith();
    const consumers: string[] = [];
    let inboxCalls = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/inbox")) {
        inboxCalls += 1;
        consumers.push(new URL(url, "http://l").searchParams.get("consumer") ?? "");
        const ops = inboxCalls === 1 ? [{ seq: 1, op: { op: "push", id: "a", html: doc("<p>x</p>") } }] : [];
        return new Response(JSON.stringify({ ops, latest: 1 }), { status: 200 });
      }
      if (url.includes("/result")) {
        consumers.push(String(JSON.parse(String(init?.body)).consumer ?? ""));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    };

    const stop = startAgentBridge(store, { fetchImpl, intervalMs: 2, retryMs: 2 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    stop();

    expect(consumers.length).toBeGreaterThan(1);
    expect(new Set(consumers).size).toBe(1);
    expect(consumers[0]).not.toBe("");
  });
});
