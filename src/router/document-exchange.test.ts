import { describe, expect, it } from "vitest";

import { createEmptyEditorState, createEditorStateFromFrameSeeds, selectFrameRenderModels, type FrameSeed } from "../editor/model";
import { startBrainstormSessionCommand } from "../editor/commands";
import { createEditorStore } from "../editor/store";
import {
  DocumentExchangeService,
  MAX_ROUTER_HTML_BYTES,
  validateRouterHtml,
} from "./document-exchange";
import { renderFrameDocument } from "../frame/render-document";
import { WIREFRAME_THEME_MARKER } from "../frame/wireframe-theme";

const initialHtml = "<!doctype html><html lang=\"en\"><head><title>First</title></head><body><main>One</main></body></html>";
const replacementHtml = "<!doctype html><html lang=\"en\"><head><title>Second</title></head><body><main>Two</main></body></html>";
const wireframeHtml = "<!doctype html><html lang=\"en\"><head><style>.page { display: grid; gap: 16px; padding: 24px; }</style></head><body><main class=\"page\"><h1>Wireframe</h1></main></body></html>";

function frame(overrides: Partial<FrameSeed> = {}): FrameSeed {
  return {
    id: "desktop",
    name: "Desktop",
    documentId: "document-1",
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
    srcDoc: initialHtml,
    background: "#fff",
    ...overrides,
  };
}

function createService() {
  const store = createEditorStore(
    createEditorStateFromFrameSeeds([
      frame(),
      frame({ id: "mobile", name: "Mobile", width: 390, height: 844 }),
    ]),
  );
  return { store, service: new DocumentExchangeService(store) };
}

function createBlankBrainstormService() {
  const store = createEditorStore(createEmptyEditorState());
  store.execute(startBrainstormSessionCommand({
    sessionId: "session-1",
    briefFrameId: "brief-1",
  }, 0), { label: "Start Brainstorm session" });
  return { store, service: new DocumentExchangeService(store) };
}

function createWireframeInput(overrides: Partial<Parameters<DocumentExchangeService["createWireframe"]>[0]> = {}) {
  return {
    mode: "wireframe" as const,
    expectedSessionRevision: 1,
    documentId: "wireframe-document",
    pageId: "wireframe-page",
    frameId: "wireframe-frame",
    documentName: "Wireframe",
    pageName: "Wireframe page",
    frameName: "Wireframe",
    html: wireframeHtml,
    x: 560,
    y: 0,
    width: 720,
    height: 560,
    background: "#ffffff",
    ...overrides,
  };
}

describe("Codex router document exchange", () => {
  it("returns the exact canonical HTML and revision", () => {
    const { service } = createService();

    expect(service.getHtml("document-1")).toEqual({
      documentId: "document-1",
      html: initialHtml,
      mode: "design",
      revision: 1,
    });
  });

  it("replaces HTML atomically and refreshes every linked frame", () => {
    const { store, service } = createService();

    expect(service.replaceHtml({
      documentId: "document-1",
      expectedRevision: 1,
      html: replacementHtml,
      mode: "design",
    })).toEqual({
      documentId: "document-1",
      mode: "design",
      previousRevision: 1,
      revision: 2,
      changed: true,
      affectedFrameIds: ["desktop", "mobile"],
      htmlBytes: new TextEncoder().encode(replacementHtml).byteLength,
    });
    expect(store.getState().documents["document-1"]).toMatchObject({
      srcDoc: replacementHtml,
      revision: 2,
    });
    expect(store.getHistory().past).toHaveLength(1);
  });

  it("rejects a stale Codex write without changing the document", () => {
    const { store, service } = createService();

    expect(() => service.replaceHtml({
      documentId: "document-1",
      expectedRevision: 2,
      html: replacementHtml,
      mode: "design",
    })).toThrowError(expect.objectContaining({ code: "stale-revision" }));
    expect(store.getState().documents["document-1"]).toMatchObject({
      srcDoc: initialHtml,
      revision: 1,
    });
  });

  it("does not create a new revision for identical HTML", () => {
    const { store, service } = createService();

    expect(service.replaceHtml({
      documentId: "document-1",
      expectedRevision: 1,
      html: initialHtml,
      mode: "design",
    })).toMatchObject({ changed: false, previousRevision: 1, revision: 1 });
    expect(store.getHistory().past).toHaveLength(0);
  });

  it("validates complete HTML and blocks bridge-runtime impersonation", () => {
    expect(validateRouterHtml(initialHtml)).toEqual({
      htmlBytes: new TextEncoder().encode(initialHtml).byteLength,
      title: "First",
      language: "en",
    });
    expect(() => validateRouterHtml("<main>fragment</main>"))
      .toThrowError(expect.objectContaining({ code: "invalid-html" }));
    expect(() => validateRouterHtml(
      "<!doctype html><html><body><script data-design-tool-iframe-bridge=\"1\"></script></body></html>",
    )).toThrowError(expect.objectContaining({ code: "reserved-runtime-marker" }));
    expect(() => validateRouterHtml(
      "<!doctype html><html><head><style data-design-tool-wireframe-theme=\"1\"></style></head><body></body></html>",
    )).toThrowError(expect.objectContaining({ code: "reserved-wireframe-theme-marker" }));
  });

  it("rejects documents above the router payload bound", () => {
    const oversized = `<!doctype html><html><body>${"x".repeat(MAX_ROUTER_HTML_BYTES)}</body></html>`;
    expect(() => validateRouterHtml(oversized))
      .toThrowError(expect.objectContaining({ code: "html-too-large" }));
  });

  it("requires an explicit valid document mode at the agent boundary", () => {
    const { service } = createService();
    const missingMode = {
      documentId: "document-1",
      expectedRevision: 1,
      html: replacementHtml,
    } as never;
    expect(() => service.replaceHtml(missingMode))
      .toThrowError(expect.objectContaining({ code: "mode-required" }));
    expect(() => service.replaceHtml({
      documentId: "document-1",
      expectedRevision: 1,
      html: replacementHtml,
      mode: "prototype" as never,
    })).toThrowError(expect.objectContaining({ code: "invalid-mode" }));
  });

  it("persists accepted wireframe mode and refreshes all linked frames", () => {
    const { store, service } = createService();

    expect(service.replaceHtml({
      documentId: "document-1",
      expectedRevision: 1,
      html: wireframeHtml,
      mode: "wireframe",
    })).toMatchObject({
      mode: "wireframe",
      previousRevision: 1,
      revision: 2,
      changed: true,
      affectedFrameIds: ["desktop", "mobile"],
    });
    expect(service.getHtml("document-1")).toMatchObject({
      html: wireframeHtml,
      mode: "wireframe",
      revision: 2,
    });
    expect(store.getHistory().past).toHaveLength(1);
  });

  it("rejects design HTML during briefing before executing a command", () => {
    const { store, service } = createService();
    store.execute(startBrainstormSessionCommand({
      sessionId: "session-1",
      briefFrameId: "brief-1",
    }, 0), { label: "Start Brainstorm session" });
    const before = store.getState().documents["document-1"];
    const historyLength = store.getHistory().past.length;

    expect(() => service.replaceHtml({
      documentId: "document-1",
      expectedRevision: before.revision,
      html: replacementHtml,
      mode: "design",
    })).toThrowError(expect.objectContaining({ code: "brainstorm-wireframe-required" }));
    expect(store.getState().documents["document-1"]).toEqual(before);
    expect(store.getHistory().past).toHaveLength(historyLength);
  });

  it("accepts wireframe HTML during an active Brainstorm session", () => {
    const { store, service } = createService();
    store.execute(startBrainstormSessionCommand({
      sessionId: "session-1",
      briefFrameId: "brief-1",
    }, 0), { label: "Start Brainstorm session" });

    expect(service.replaceHtml({
      documentId: "document-1",
      expectedRevision: 1,
      html: wireframeHtml,
      mode: "wireframe",
    })).toMatchObject({ mode: "wireframe", revision: 2, changed: true });
  });

  it("keeps document mode, HTML, and revision unchanged for rejected or stale writes", () => {
    const { store, service } = createService();
    const before = store.getState().documents["document-1"];
    const historyLength = store.getHistory().past.length;

    expect(() => service.replaceHtml({
      documentId: "document-1",
      expectedRevision: 1,
      html: "<!doctype html><html><head><style>.x { color: red; }</style></head><body><div class=x></div></body></html>",
      mode: "wireframe",
    })).toThrowError(expect.objectContaining({ code: "wireframe-css-property" }));
    expect(() => service.replaceHtml({
      documentId: "document-1",
      expectedRevision: 2,
      html: wireframeHtml,
      mode: "wireframe",
    })).toThrowError(expect.objectContaining({ code: "stale-revision" }));
    expect(store.getState().documents["document-1"]).toEqual(before);
    expect(store.getHistory().past).toHaveLength(historyLength);
  });

  it("creates the first normalized wireframe from a blank Brainstorm session", () => {
    const { store, service } = createBlankBrainstormService();

    expect(service.createWireframe(createWireframeInput())).toEqual({
      documentId: "wireframe-document",
      pageId: "wireframe-page",
      frameId: "wireframe-frame",
      mode: "wireframe",
      documentRevision: 1,
      previousSessionRevision: 1,
      sessionRevision: 2,
      affectedFrameIds: ["wireframe-frame"],
      htmlBytes: new TextEncoder().encode(wireframeHtml).byteLength,
    });
    expect(store.getState().documents["wireframe-document"]).toMatchObject({
      mode: "wireframe",
      srcDoc: wireframeHtml,
      revision: 1,
      pageIds: ["wireframe-page"],
    });
    expect(store.getState().pages["wireframe-page"].frameIds).toEqual(["wireframe-frame"]);
    expect(store.getState().session.lifecycle).toBe("wireframing");
    expect(selectFrameRenderModels(store.getState())).toEqual([
      expect.objectContaining({ id: "wireframe-frame", mode: "wireframe", srcDoc: wireframeHtml }),
    ]);
    expect(store.getHistory().past).toHaveLength(2);
  });

  it("exposes the created frame beside the Brief Frame through the neutral render path", () => {
    const { store, service } = createBlankBrainstormService();
    service.createWireframe(createWireframeInput({ x: 560, y: 0 }));
    const state = store.getState();
    const frame = selectFrameRenderModels(state)[0];

    expect(state.session.briefFrame).toMatchObject({ x: 0, width: 520 });
    expect(frame).toMatchObject({ id: "wireframe-frame", x: 560, mode: "wireframe" });
    expect(frame.x).toBeGreaterThan((state.session.briefFrame?.x ?? 0) + (state.session.briefFrame?.width ?? 0));
    expect(renderFrameDocument(frame.srcDoc, frame.mode, {
      channel: "wireframe-channel",
      frameId: frame.id,
      parentOrigin: "http://127.0.0.1:4173",
    })).toContain(WIREFRAME_THEME_MARKER);
  });

  it("creates additional wireframes while keeping wireframing lifecycle and advancing revision", () => {
    const { store, service } = createBlankBrainstormService();
    service.createWireframe(createWireframeInput());

    const result = service.createWireframe(createWireframeInput({
      expectedSessionRevision: 2,
      documentId: "wireframe-document-2",
      pageId: "wireframe-page-2",
      frameId: "wireframe-frame-2",
      frameName: "Second wireframe",
      x: 1320,
    }));

    expect(result).toMatchObject({
      previousSessionRevision: 2,
      sessionRevision: 3,
      affectedFrameIds: ["wireframe-frame-2"],
    });
    expect(store.getState().session.lifecycle).toBe("wireframing");
    expect(Object.keys(store.getState().documents)).toEqual(["wireframe-document", "wireframe-document-2"]);
    expect(selectFrameRenderModels(store.getState()).map((frame) => frame.id)).toEqual(["wireframe-frame-2"]);
  });

  it("requires wireframe mode and strict admitted HTML", () => {
    const { service } = createBlankBrainstormService();
    expect(() => service.createWireframe(createWireframeInput({ mode: "design" as never })))
      .toThrowError(expect.objectContaining({ code: "invalid-mode" }));
    expect(() => service.createWireframe(createWireframeInput({
      html: "<!doctype html><html><body><script>alert(1)</script></body></html>",
    }))).toThrowError(expect.objectContaining({ code: "wireframe-script" }));
  });

  it("rejects stale session revisions and duplicate or inconsistent IDs before mutation", () => {
    const { store, service } = createBlankBrainstormService();
    const before = store.getState();
    const historyLength = store.getHistory().past.length;

    expect(() => service.createWireframe(createWireframeInput({ expectedSessionRevision: 2 })))
      .toThrowError(expect.objectContaining({ code: "stale-session-revision" }));
    expect(() => service.createWireframe(createWireframeInput({ documentId: "wireframe-page" })))
      .toThrowError(expect.objectContaining({ code: "inconsistent-wireframe-ids" }));
    expect(store.getState()).toBe(before);
    expect(store.getHistory().past).toHaveLength(historyLength);

    service.createWireframe(createWireframeInput());
    const afterCreate = store.getState();
    const afterCreateHistoryLength = store.getHistory().past.length;
    expect(() => service.createWireframe(createWireframeInput({ expectedSessionRevision: 2 })))
      .toThrowError(expect.objectContaining({ code: "duplicate-document-id" }));
    expect(() => service.createWireframe(createWireframeInput({
      expectedSessionRevision: 2,
      documentId: "wireframe-document-3",
      pageId: "wireframe-page",
      frameId: "wireframe-frame-3",
    }))).toThrowError(expect.objectContaining({ code: "duplicate-page-id" }));
    expect(() => service.createWireframe(createWireframeInput({
      expectedSessionRevision: 2,
      documentId: "wireframe-document-4",
      pageId: "wireframe-page-4",
      frameId: "wireframe-frame",
    }))).toThrowError(expect.objectContaining({ code: "duplicate-frame-id" }));
    expect(store.getState()).toBe(afterCreate);
    expect(store.getHistory().past).toHaveLength(afterCreateHistoryLength);
  });

  it("rejects completed sessions without changing state or history", () => {
    const { store, service } = createBlankBrainstormService();
    store.execute({ type: "session/lifecycle-transition", to: "wireframing", expectedRevision: 1 });
    store.execute({ type: "session/lifecycle-transition", to: "completed", expectedRevision: 2 });
    const before = store.getState();
    const historyLength = store.getHistory().past.length;

    expect(() => service.createWireframe(createWireframeInput({ expectedSessionRevision: 3 })))
      .toThrowError(expect.objectContaining({ code: "invalid-lifecycle-transition" }));
    expect(store.getState()).toBe(before);
    expect(store.getHistory().past).toHaveLength(historyLength);
  });

  it("rolls back normalized entities when the session reducer rejects inside the transaction", () => {
    const malformedState = createEmptyEditorState();
    malformedState.session = {
      ...malformedState.session,
      lifecycle: "briefing",
      sessionId: "session-1",
      revision: 1,
      briefFrame: null,
    };
    const store = createEditorStore(malformedState);
    const service = new DocumentExchangeService(store);
    const before = store.getState();
    const historyLength = store.getHistory().past.length;

    expect(() => service.createWireframe(createWireframeInput()))
      .toThrowError(expect.objectContaining({ code: "invalid-input" }));
    expect(store.getState()).toBe(before);
    expect(store.getHistory().past).toHaveLength(historyLength);
    expect(store.hasActiveTransaction()).toBe(false);
  });

  it("undoes and redoes the complete wireframe creation as one transaction", () => {
    const { store, service } = createBlankBrainstormService();
    service.createWireframe(createWireframeInput());
    expect(store.getHistory().past).toHaveLength(2);

    expect(store.undo()).toBe(true);
    expect(store.getState().documents).toEqual({});
    expect(store.getState().pages).toEqual({});
    expect(store.getState().frames).toEqual({});
    expect(store.getState().session.lifecycle).toBe("briefing");
    expect(store.getState().session.revision).toBe(1);

    expect(store.redo()).toBe(true);
    expect(store.getState().documents["wireframe-document"].mode).toBe("wireframe");
    expect(store.getState().session.lifecycle).toBe("wireframing");
    expect(store.getState().session.revision).toBe(2);
  });
});
