import { describe, expect, it } from "vitest";

import { createFrameCommand, moveFrameCommand, setSelectionCommand } from "./commands";
import { createEditorStateFromFrameSeeds, type FrameSeed } from "./model";
import { createEditorStore } from "./store";

const frame: FrameSeed = {
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

describe("editor store history", () => {
  it("records a command and restores it with undo/redo", () => {
    const store = createEditorStore(createEditorStateFromFrameSeeds([frame]));

    store.execute(moveFrameCommand({ frameId: "frame-1", position: { x: 80, y: 90 } }));
    expect(store.getHistory().past).toHaveLength(1);
    expect(store.getState().frames["frame-1"]).toMatchObject({ x: 80, y: 90 });

    expect(store.undo()).toBe(true);
    expect(store.getState().frames["frame-1"]).toMatchObject({ x: 10, y: 20 });
    expect(store.getHistory().future).toHaveLength(1);

    expect(store.redo()).toBe(true);
    expect(store.getState().frames["frame-1"]).toMatchObject({ x: 80, y: 90 });
  });

  it("coalesces repeated movement commands into one reversible transaction", () => {
    const store = createEditorStore(createEditorStateFromFrameSeeds([frame]));

    store.beginTransaction("Move Frame 1");
    store.execute(moveFrameCommand({ frameId: "frame-1", position: { x: 30, y: 40 } }));
    store.execute(moveFrameCommand({ frameId: "frame-1", position: { x: 80, y: 90 } }));
    expect(store.commitTransaction()).toBe(true);

    expect(store.getHistory().past).toHaveLength(1);
    expect(store.getHistory().past[0].label).toBe("Move Frame 1");
    store.undo();
    expect(store.getState().frames["frame-1"]).toMatchObject({ x: 10, y: 20 });
  });

  it("does not add selection-only changes to history", () => {
    const store = createEditorStore(
      createEditorStateFromFrameSeeds([frame, { ...frame, id: "frame-2" }]),
    );
    const before = store.getHistory();

    store.execute(
      setSelectionCommand({
        frameIds: ["frame-2"],
        nodeIds: [],
        primaryFrameId: "frame-2",
        primaryNodeId: null,
      }),
      { history: "skip" },
    );

    expect(store.getState().selection.primaryFrameId).toBe("frame-2");
    expect(store.getHistory()).toEqual(before);
  });

  it("rolls back a failed transaction without leaving history", () => {
    const store = createEditorStore(createEditorStateFromFrameSeeds([frame]));

    expect(() =>
      store.transact("Broken move", () => {
        store.execute(moveFrameCommand({ frameId: "frame-1", position: { x: 50, y: 60 } }));
        throw new Error("abort");
      }),
    ).toThrow("abort");

    expect(store.getState().frames["frame-1"]).toMatchObject({ x: 10, y: 20 });
    expect(store.getHistory().past).toHaveLength(0);
  });

  it("records frame creation as one command and can undo it", () => {
    const store = createEditorStore(createEditorStateFromFrameSeeds([]));

    store.execute(createFrameCommand(frame));
    expect(store.getState().frames["frame-1"]).toBeDefined();
    expect(store.getHistory().past).toHaveLength(1);

    store.undo();
    expect(store.getState().frames["frame-1"]).toBeUndefined();
    expect(store.getState().pages["page-1"]).toBeUndefined();
    expect(store.getState().documents["document-1"]).toBeUndefined();
  });

  it("keeps a live bridge effect in the same history transaction", () => {
    const store = createEditorStore(createEditorStateFromFrameSeeds([frame]));
    const calls: string[] = [];

    store.beginTransaction("Create live layer");
    store.execute({
      type: "node/upsert",
      node: { id: "created", documentId: "document-1", parentId: null, kind: "element", name: "Created", attributes: {}, childIds: [] },
    });
    store.commitTransaction({ undo: () => calls.push("undo"), redo: () => calls.push("redo") });

    expect(store.getHistory().past).toHaveLength(1);
    store.undo();
    store.redo();
    expect(calls).toEqual(["undo", "redo"]);
  });
});
