import { describe, expect, it } from "vitest";
import { createCanvasComment, createEmptyCommentsState } from "./model";

describe("comments model", () => {
  it("creates an empty state with nothing selected or reported", () => {
    expect(createEmptyCommentsState()).toEqual({
      comments: [],
      selectedCommentId: null,
      feedback: null,
    });
  });

  it("mints a blank open comment pinned to the given frame and point", () => {
    const comment = createCanvasComment("frame-9", { x: 12, y: 34 });
    expect(comment).toEqual({
      id: expect.stringMatching(/^comment-/),
      frameId: "frame-9",
      point: { x: 12, y: 34 },
      body: "",
      status: "open",
    });
  });

  it("mints unique ids across calls", () => {
    const first = createCanvasComment("f", { x: 0, y: 0 });
    const second = createCanvasComment("f", { x: 0, y: 0 });
    expect(first.id).not.toBe(second.id);
  });
});
