import { describe, expect, it } from "vitest";
import { createEmptyEditorState } from "../editor/model";
import { applyPendingDocumentWrites, type PendingDocumentWrite } from "./live-documents";

function stateWithDocument(srcDoc: string, revision = 3) {
  const state = createEmptyEditorState();
  state.documents["doc-1"] = {
    id: "doc-1",
    name: "Doc",
    mode: "design",
    srcDoc,
    revision,
    rootNodeIds: [],
    pageIds: [],
  };
  return state;
}

describe("applyPendingDocumentWrites", () => {
  it("swaps a harvested document into the serialized state", () => {
    const state = stateWithDocument("<!doctype html><html><body>old</body></html>");
    const pending = new Map<string, PendingDocumentWrite>([
      ["doc-1", { html: "<!doctype html><html><body>live</body></html>", revision: 3 }],
    ]);
    const overlaid = applyPendingDocumentWrites(state, pending);
    expect(overlaid.documents["doc-1"]?.srcDoc).toContain("live");
    expect(state.documents["doc-1"]?.srcDoc).toContain("old");
  });

  it("drops stale writes once the document revision moves on", () => {
    const state = stateWithDocument("<!doctype html><html><body>old</body></html>", 4);
    const pending = new Map<string, PendingDocumentWrite>([
      ["doc-1", { html: "<!doctype html><html><body>live</body></html>", revision: 3 }],
    ]);
    const overlaid = applyPendingDocumentWrites(state, pending);
    expect(overlaid).toBe(state);
    expect(pending.size).toBe(0);
  });

  it("drops writes for documents that no longer exist and no-ops identical html", () => {
    const state = stateWithDocument("<!doctype html><html><body>same</body></html>");
    const pending = new Map<string, PendingDocumentWrite>([
      ["doc-1", { html: "<!doctype html><html><body>same</body></html>", revision: 3 }],
      ["doc-gone", { html: "<!doctype html><html><body>x</body></html>", revision: 1 }],
    ]);
    const overlaid = applyPendingDocumentWrites(state, pending);
    expect(overlaid).toBe(state);
    expect(pending.size).toBe(0);
  });
});
