import { useCallback, useRef, useState } from "react";
import type { Point } from "../canvas/types";
import type { EditorStore } from "../editor/store";
import {
  createCanvasComment,
  createEmptyCommentsState,
  type CanvasComment,
  type CommentsState,
} from "./model";

export interface UseCommentsResult extends CommentsState {
  selectedComment: CanvasComment | null;
  addComment: (frameId: string, point: Point) => void;
  selectComment: (commentId: string | null) => void;
  updateComment: (commentId: string, body: string) => boolean;
  toggleCommentResolved: (commentId: string) => void;
  deleteComment: (commentId: string) => void;
}

export function useComments(editorStore: EditorStore): UseCommentsResult {
  const [state, setState] = useState<CommentsState>(createEmptyCommentsState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const applyState = useCallback((next: CommentsState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const commitChange = useCallback(
    ({
      label,
      before,
      after,
      undoFeedback,
      redoFeedback,
    }: {
      label: string;
      before: CommentsState;
      after: CommentsState;
      undoFeedback: string;
      redoFeedback: string;
    }) => {
      editorStore.beginTransaction(label);
      applyState(after);
      editorStore.commitTransaction({
        undo: () => applyState({ ...before, feedback: undoFeedback }),
        redo: () => applyState({ ...after, feedback: redoFeedback }),
      });
    },
    [applyState, editorStore],
  );

  const addComment = useCallback(
    (frameId: string, point: Point) => {
      const before = stateRef.current;
      const comment = createCanvasComment(frameId, point);
      const after: CommentsState = {
        comments: [...before.comments, comment],
        selectedCommentId: comment.id,
        feedback: "Comment added — add a note.",
      };
      commitChange({
        label: "Add comment",
        before,
        after,
        undoFeedback: "Comment undone",
        redoFeedback: "Comment restored",
      });
    },
    [commitChange],
  );

  const selectComment = useCallback(
    (commentId: string | null) => {
      if (commentId !== null && !stateRef.current.comments.some((comment) => comment.id === commentId)) {
        return;
      }
      applyState({
        ...stateRef.current,
        selectedCommentId: commentId,
        feedback: null,
      });
    },
    [applyState],
  );

  const updateComment = useCallback(
    (commentId: string, body: string): boolean => {
      const nextBody = body.trim();
      const before = stateRef.current;
      const comment = before.comments.find((entry) => entry.id === commentId);
      if (!comment) return false;
      if (!nextBody) {
        applyState({ ...before, feedback: "Add a note before saving." });
        return false;
      }
      if (comment.body === nextBody) {
        applyState({ ...before, feedback: "Comment is unchanged." });
        return true;
      }
      const after: CommentsState = {
        ...before,
        comments: before.comments.map((entry) => entry.id === commentId ? { ...entry, body: nextBody } : entry),
        feedback: "Comment saved",
      };
      commitChange({
        label: "Edit comment",
        before,
        after,
        undoFeedback: "Comment edit undone",
        redoFeedback: "Comment edit restored",
      });
      return true;
    },
    [applyState, commitChange],
  );

  const toggleCommentResolved = useCallback(
    (commentId: string) => {
      const before = stateRef.current;
      const comment = before.comments.find((entry) => entry.id === commentId);
      if (!comment) return;
      const resolved = comment.status !== "resolved";
      const after: CommentsState = {
        ...before,
        comments: before.comments.map((entry) => entry.id === commentId ? { ...entry, status: resolved ? "resolved" : "open" } : entry),
        feedback: resolved ? "Comment resolved" : "Comment reopened",
      };
      commitChange({
        label: resolved ? "Resolve comment" : "Reopen comment",
        before,
        after,
        undoFeedback: resolved ? "Comment reopened" : "Comment resolved",
        redoFeedback: resolved ? "Comment resolved" : "Comment reopened",
      });
    },
    [commitChange],
  );

  const deleteComment = useCallback(
    (commentId: string) => {
      const before = stateRef.current;
      if (!before.comments.some((comment) => comment.id === commentId)) return;
      const after: CommentsState = {
        comments: before.comments.filter((comment) => comment.id !== commentId),
        selectedCommentId: before.selectedCommentId === commentId ? null : before.selectedCommentId,
        feedback: "Comment deleted",
      };
      commitChange({
        label: "Delete comment",
        before,
        after,
        undoFeedback: "Comment restored",
        redoFeedback: "Comment deleted",
      });
    },
    [commitChange],
  );

  const selectedComment = state.selectedCommentId
    ? state.comments.find((comment) => comment.id === state.selectedCommentId) ?? null
    : null;

  return {
    ...state,
    selectedComment,
    addComment,
    selectComment,
    updateComment,
    toggleCommentResolved,
    deleteComment,
  };
}

