import { useCallback, useRef, useState } from "react";
import type { Point } from "../canvas/types";
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
  clearComments: () => void;
}

export function useComments(): UseCommentsResult {
  const [state, setState] = useState<CommentsState>(createEmptyCommentsState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const applyState = useCallback((next: CommentsState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const addComment = useCallback(
    (frameId: string, point: Point) => {
      const comment = createCanvasComment(frameId, point);
      applyState({
        comments: [...stateRef.current.comments, comment],
        selectedCommentId: comment.id,
        feedback: null,
      });
    },
    [applyState],
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
      applyState({
        ...before,
        comments: before.comments.map((entry) => entry.id === commentId ? { ...entry, body: nextBody } : entry),
        feedback: null,
      });
      return true;
    },
    [applyState],
  );

  const toggleCommentResolved = useCallback(
    (commentId: string) => {
      const before = stateRef.current;
      const comment = before.comments.find((entry) => entry.id === commentId);
      if (!comment) return;
      const resolved = comment.status !== "resolved";
      applyState({
        ...before,
        comments: before.comments.map((entry) => entry.id === commentId ? { ...entry, status: resolved ? "resolved" : "open" } : entry),
        feedback: resolved ? "Comment resolved" : "Comment reopened",
      });
    },
    [applyState],
  );

  const deleteComment = useCallback(
    (commentId: string) => {
      const before = stateRef.current;
      if (!before.comments.some((comment) => comment.id === commentId)) return;
      applyState({
        comments: before.comments.filter((comment) => comment.id !== commentId),
        selectedCommentId: before.selectedCommentId === commentId ? null : before.selectedCommentId,
        feedback: "Comment deleted",
      });
    },
    [applyState],
  );

  const selectedComment = state.selectedCommentId
    ? state.comments.find((comment) => comment.id === state.selectedCommentId) ?? null
    : null;

  const clearComments = useCallback(() => {
    applyState(createEmptyCommentsState());
  }, [applyState]);

  return {
    ...state,
    selectedComment,
    addComment,
    selectComment,
    updateComment,
    toggleCommentResolved,
    deleteComment,
    clearComments,
  };
}
