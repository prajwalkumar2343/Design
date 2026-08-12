import { describe, expect, it } from "vitest";

import {
  applyEditorCommand,
  createFrameCommand,
  moveFrameCommand,
  setSelectionCommand,
} from "./commands";
import { createEditorStateFromFrameSeeds, type FrameSeed } from "./model";

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

describe("editor commands", () => {
  it("creates a normalized document, page, and frame atomically", () => {
    const next = applyEditorCommand(createEditorStateFromFrameSeeds([]), createFrameCommand(frame));

    expect(next.documents["document-1"]).toMatchObject({ id: "document-1", srcDoc: "<html />" });
    expect(next.pages["page-1"]).toMatchObject({ documentId: "document-1", frameIds: ["frame-1"] });
    expect(next.frames["frame-1"]).toMatchObject({ documentId: "document-1", pageId: "page-1", x: 10, y: 20 });
  });

  it("moves a frame and applies selection through typed commands", () => {
    const initial = createEditorStateFromFrameSeeds([frame]);
    const moved = applyEditorCommand(
      initial,
      moveFrameCommand({ frameId: "frame-1", position: { x: 80, y: 90 } }),
    );
    const selected = applyEditorCommand(
      moved,
      setSelectionCommand({
        frameIds: ["frame-1"],
        nodeIds: [],
        primaryFrameId: "frame-1",
        primaryNodeId: null,
      }),
    );

    expect(moved.frames["frame-1"]).toMatchObject({ x: 80, y: 90 });
    expect(selected.selection.primaryFrameId).toBe("frame-1");
  });
});
