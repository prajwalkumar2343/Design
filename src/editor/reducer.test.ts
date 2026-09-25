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

  it("removes the frame's node index entries and prunes dangling references", () => {
    let current = state();
    const node = (id: string, parentId: string | null, childIds: string[], frameId = "frame-1") => ({
      type: "node/upsert" as const,
      node: {
        id,
        documentId: "document-1",
        parentId,
        kind: "element" as const,
        name: id,
        attributes: {},
        childIds,
        frameId,
      },
    });
    current = editorReducer(current, node("root", null, ["child"]));
    current = editorReducer(current, node("child", "root", []));
    current = editorReducer(current, {
      type: "selection/set",
      selection: {
        frameIds: ["frame-1"],
        nodeIds: ["child"],
        primaryFrameId: "frame-1",
        primaryNodeId: "child",
      },
    });

    const next = editorReducer(current, { type: "frame/remove", frameId: "frame-1" });

    expect(next.nodes["root"]).toBeUndefined();
    expect(next.nodes["child"]).toBeUndefined();
    expect(next.documents["document-1"].rootNodeIds).toEqual([]);
    expect(next.selection.nodeIds).toEqual([]);
    expect(next.selection.primaryNodeId).toBeNull();
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

  it("detaches a root node from its previous document on a root-to-root document move", () => {
    // Two documents (one per frame) — a node upserted into the other document
    // with parentId still null must leave the FIRST document's root list.
    const current = createEditorStateFromFrameSeeds([
      baseFrame,
      { ...baseFrame, id: "frame-2", documentId: "document-2" },
    ]);
    const withRoot = editorReducer(current, {
      type: "node/upsert",
      node: {
        id: "moving-root",
        documentId: "document-1",
        parentId: null,
        kind: "element",
        name: "Root",
        attributes: {},
        childIds: [],
      },
    });
    expect(withRoot.documents["document-1"].rootNodeIds).toEqual(["moving-root"]);

    const moved = editorReducer(withRoot, {
      type: "node/upsert",
      node: { ...withRoot.nodes["moving-root"], documentId: "document-2" },
    });
    expect(moved.documents["document-1"].rootNodeIds).toEqual([]);
    expect(moved.documents["document-2"].rootNodeIds).toEqual(["moving-root"]);
    expect(moved.nodes["moving-root"].documentId).toBe("document-2");
  });

  it("detaches a root node from its previous document in the bulk upsert path", () => {
    const current = createEditorStateFromFrameSeeds([
      baseFrame,
      { ...baseFrame, id: "frame-2", documentId: "document-2" },
    ]);
    const withRoot = editorReducer(current, {
      type: "node/upsert",
      node: {
        id: "moving-root",
        documentId: "document-1",
        parentId: null,
        kind: "element",
        name: "Root",
        attributes: {},
        childIds: [],
      },
    });

    const moved = editorReducer(withRoot, {
      type: "nodes/upsert-many",
      nodes: [{ ...withRoot.nodes["moving-root"], documentId: "document-2" }],
    });
    expect(moved.documents["document-1"].rootNodeIds).toEqual([]);
    expect(moved.documents["document-2"].rootNodeIds).toEqual(["moving-root"]);
  });

  it("accepts a bulk snapshot that lists a child before its parent", () => {
    const current = createEditorStateFromFrameSeeds([baseFrame]);
    const child = {
      id: "child",
      documentId: "document-1",
      parentId: "parent",
      kind: "element" as const,
      name: "Child",
      attributes: {},
      childIds: [],
    };
    const next = editorReducer(current, {
      type: "nodes/upsert-many",
      nodes: [
        child,
        {
          id: "parent",
          documentId: "document-1",
          parentId: null,
          kind: "element",
          name: "Parent",
          attributes: {},
          childIds: ["child"],
        },
      ],
    });
    expect(next.nodes["parent"].childIds).toEqual(["child"]);
    expect(next.documents["document-1"].rootNodeIds).toContain("parent");
  });

  it("attaches a bulk child to a parent whose snapshot row omitted it", () => {
    const current = createEditorStateFromFrameSeeds([baseFrame]);
    const next = editorReducer(current, {
      type: "nodes/upsert-many",
      nodes: [
        {
          id: "child",
          documentId: "document-1",
          parentId: "parent",
          kind: "element",
          name: "Child",
          attributes: {},
          childIds: [],
        },
        {
          id: "parent",
          documentId: "document-1",
          parentId: null,
          kind: "element",
          name: "Parent",
          attributes: {},
          childIds: [],
        },
      ],
    });
    expect(next.nodes["parent"].childIds).toEqual(["child"]);
  });

  it("moves a root's whole subtree when it crosses documents", () => {
    const current = createEditorStateFromFrameSeeds([
      baseFrame,
      { ...baseFrame, id: "frame-2", documentId: "document-2" },
    ]);
    const withTree = [
      {
        id: "root",
        documentId: "document-1",
        parentId: null,
        kind: "element" as const,
        name: "Root",
        attributes: {},
        childIds: [] as string[],
      },
      {
        id: "child",
        documentId: "document-1",
        parentId: "root",
        kind: "element" as const,
        name: "Child",
        attributes: {},
        childIds: [] as string[],
      },
    ].reduce(
      (s, node) => editorReducer(s, { type: "node/upsert", node }),
      current,
    );
    expect(withTree.nodes["root"].childIds).toEqual(["child"]);

    const single = editorReducer(withTree, {
      type: "node/upsert",
      node: { ...withTree.nodes["root"], documentId: "document-2" },
    });
    expect(single.nodes["child"].documentId).toBe("document-2");

    const bulk = editorReducer(withTree, {
      type: "nodes/upsert-many",
      nodes: [{ ...withTree.nodes["root"], documentId: "document-2" }],
    });
    expect(bulk.nodes["child"].documentId).toBe("document-2");
  });
});
