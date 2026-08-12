import { describe, expect, it } from "vitest";

import { createEditorStateFromFrameSeeds, type FrameSeed } from "./model";
import { editorReducer } from "./reducer";

const baseFrame: FrameSeed = {
  id: "frame-1",
  name: "Frame 1",
  documentId: "document-1",
  x: 10,
  y: 20,
  width: 400,
  height: 300,
  srcDoc: "<html />",
  background: "#fff",
};

function state() {
  return createEditorStateFromFrameSeeds([baseFrame, { ...baseFrame, id: "frame-2" }]);
}

describe("editor reducer", () => {
  it("moves one frame immutably while preserving other frames", () => {
    const current = state();
    const next = editorReducer(current, {
      type: "frame/move",
      frameId: "frame-1",
      position: { x: 120, y: 240 },
    });

    expect(next.frames["frame-1"]).toMatchObject({ x: 120, y: 240 });
    expect(next.frames["frame-2"]).toEqual(current.frames["frame-2"]);
    expect(current.frames["frame-1"]).toMatchObject({ x: 10, y: 20 });
  });

  it("normalizes selection to existing, unique ids and primary members", () => {
    const current = state();
    const next = editorReducer(current, {
      type: "selection/set",
      selection: {
        frameIds: ["frame-2", "frame-2", "missing"],
        nodeIds: ["missing-node"],
        primaryFrameId: "missing",
        primaryNodeId: "missing-node",
      },
    });

    expect(next.selection).toEqual({
      frameIds: ["frame-2"],
      nodeIds: [],
      primaryFrameId: "frame-2",
      primaryNodeId: null,
    });
  });

  it("updates active tool and makes repeated updates no-ops", () => {
    const current = state();
    const next = editorReducer(current, { type: "tool/set", tool: "pan" });

    expect(next.activeTool).toBe("pan");
    expect(editorReducer(next, { type: "tool/set", tool: "pan" })).toBe(next);
  });

  it("removes a frame from its page and selection", () => {
    const current = state();
    const next = editorReducer(current, { type: "frame/remove", frameId: "frame-1" });

    expect(next.pages["page-1"].frameIds).toEqual(["frame-2"]);
    expect(next.frames["frame-1"]).toBeUndefined();
    expect(next.selection).toEqual({
      frameIds: [],
      nodeIds: [],
      primaryFrameId: null,
      primaryNodeId: null,
    });
  });

  it("switches and renames normalized pages while scoping visible frames", () => {
    const current = state();
    const withPage = editorReducer(current, {
      type: "page/create",
      page: { id: "page-2", documentId: "document-1", name: "Mobile flow", frameIds: [] },
    });
    const renamed = editorReducer(withPage, { type: "page/rename", pageId: "page-2", name: "Checkout" });
    const switched = editorReducer(renamed, { type: "page/switch", pageId: "page-2" });

    expect(renamed.pages["page-2"].name).toBe("Checkout");
    expect(switched.activePageId).toBe("page-2");
    expect(switched.selection.frameIds).toEqual([]);
  });

  it("updates layer metadata and safely reorders siblings", () => {
    const current = state();
    const withNodes = editorReducer(editorReducer(current, {
      type: "node/upsert",
      node: { id: "root", documentId: "document-1", parentId: null, kind: "element", name: "Root", attributes: {}, childIds: ["first", "second"] },
    }), {
      type: "node/upsert",
      node: { id: "first", documentId: "document-1", parentId: "root", kind: "element", name: "First", attributes: {}, childIds: [] },
    });
    const withSecond = editorReducer(withNodes, {
      type: "node/upsert",
      node: { id: "second", documentId: "document-1", parentId: "root", kind: "element", name: "Second", attributes: {}, childIds: [] },
    });
    const reordered = editorReducer(withSecond, { type: "node/reorder", nodeId: "second", direction: "up" });
    const updated = editorReducer(reordered, { type: "node/update", nodeId: "second", patch: { name: "Renamed", locked: true, hidden: true } });

    expect(reordered.nodes.root.childIds).toEqual(["second", "first"]);
    expect(updated.nodes.second).toMatchObject({ name: "Renamed", locked: true, hidden: true });
  });

  it("removes only a created node subtree and repairs normalized hierarchy", () => {
    const current = state();
    const withRoot = editorReducer(current, {
      type: "node/upsert",
      node: { id: "root", documentId: "document-1", parentId: null, kind: "element", name: "Root", attributes: {}, childIds: ["created"] },
    });
    const withChild = editorReducer(withRoot, {
      type: "node/upsert",
      node: { id: "created", documentId: "document-1", parentId: "root", kind: "element", name: "Created", attributes: { "data-design-tool-created": "true" }, childIds: ["nested"] },
    });
    const withNested = editorReducer(withChild, {
      type: "node/upsert",
      node: { id: "nested", documentId: "document-1", parentId: "created", kind: "element", name: "Nested", attributes: {}, childIds: [] },
    });

    const next = editorReducer(withNested, { type: "node/remove", nodeId: "created" });

    expect(next.nodes.created).toBeUndefined();
    expect(next.nodes.nested).toBeUndefined();
    expect(next.nodes.root.childIds).toEqual([]);
    expect(next.documents["document-1"].rootNodeIds).toEqual(["root"]);
  });
});
