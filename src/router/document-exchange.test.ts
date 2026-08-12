import { describe, expect, it } from "vitest";

import { createEditorStateFromFrameSeeds, type FrameSeed } from "../editor/model";
import { createEditorStore } from "../editor/store";
import {
  DocumentExchangeService,
  MAX_ROUTER_HTML_BYTES,
  validateRouterHtml,
} from "./document-exchange";

const initialHtml = "<!doctype html><html lang=\"en\"><head><title>First</title></head><body><main>One</main></body></html>";
const replacementHtml = "<!doctype html><html lang=\"en\"><head><title>Second</title></head><body><main>Two</main></body></html>";

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

describe("Codex router document exchange", () => {
  it("returns the exact canonical HTML and revision", () => {
    const { service } = createService();

    expect(service.getHtml("document-1")).toEqual({
      documentId: "document-1",
      html: initialHtml,
      revision: 1,
    });
  });

  it("replaces HTML atomically and refreshes every linked frame", () => {
    const { store, service } = createService();

    expect(service.replaceHtml({
      documentId: "document-1",
      expectedRevision: 1,
      html: replacementHtml,
    })).toEqual({
      documentId: "document-1",
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
  });

  it("rejects documents above the router payload bound", () => {
    const oversized = `<!doctype html><html><body>${"x".repeat(MAX_ROUTER_HTML_BYTES)}</body></html>`;
    expect(() => validateRouterHtml(oversized))
      .toThrowError(expect.objectContaining({ code: "html-too-large" }));
  });
});
