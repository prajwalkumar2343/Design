import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createEmptyEditorState } from "../editor/model";
import { createEditorStore } from "../editor/store";
import { useComments } from "./useComments";

describe("useComments", () => {
  it("adds, edits, resolves, and deletes comments with immediate feedback", () => {
    const { result } = renderHook(() => useComments());

    act(() => result.current.addComment("frame-1", { x: 10, y: 20 }));
    expect(result.current.comments).toHaveLength(1);
    expect(result.current.selectedCommentId).toBe(result.current.comments[0].id);

    const id = result.current.comments[0].id;

    act(() => {
      expect(result.current.updateComment(id, "  Tighten spacing  ")).toBe(true);
    });
    expect(result.current.comments[0].body).toBe("Tighten spacing");

    act(() => result.current.toggleCommentResolved(id));
    expect(result.current.comments[0].status).toBe("resolved");
    expect(result.current.feedback).toBe("Comment resolved");

    act(() => result.current.toggleCommentResolved(id));
    expect(result.current.comments[0].status).toBe("open");
    expect(result.current.feedback).toBe("Comment reopened");

    act(() => result.current.deleteComment(id));
    expect(result.current.comments).toHaveLength(0);
    expect(result.current.selectedCommentId).toBeNull();
    expect(result.current.feedback).toBe("Comment deleted");
  });

  it("rejects empty and unchanged edits without clearing the comment", () => {
    const { result } = renderHook(() => useComments());
    act(() => result.current.addComment("frame-1", { x: 0, y: 0 }));
    const id = result.current.comments[0].id;

    act(() => {
      expect(result.current.updateComment(id, "   ")).toBe(false);
    });
    expect(result.current.comments[0].body).toBe("");
    expect(result.current.feedback).toBe("Add a note before saving.");

    act(() => {
      expect(result.current.updateComment(id, "Same note")).toBe(true);
    });
    act(() => {
      expect(result.current.updateComment(id, "Same note")).toBe(true);
    });
    expect(result.current.comments[0].body).toBe("Same note");
    expect(result.current.feedback).toBe("Comment is unchanged.");
  });

  it("never records comment actions in the editor undo history", () => {
    const store = createEditorStore(createEmptyEditorState());
    const { result } = renderHook(() => useComments());

    act(() => result.current.addComment("frame-1", { x: 1, y: 2 }));
    const id = result.current.comments[0].id;
    act(() => result.current.updateComment(id, "Note"));
    act(() => result.current.toggleCommentResolved(id));
    act(() => result.current.deleteComment(id));

    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
    expect(store.getHistory().past).toHaveLength(0);
    expect(store.getHistory().future).toHaveLength(0);
  });
});
