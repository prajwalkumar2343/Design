import type { Point } from "../canvas/types";

export type CommentStatus = "open" | "resolved";

export interface CanvasComment {
  id: string;
  frameId: string;
  point: Point;
  body: string;
  status: CommentStatus;
}

export interface CommentsState {
  comments: CanvasComment[];
  selectedCommentId: string | null;
  feedback: string | null;
}

export function createEmptyCommentsState(): CommentsState {
  return {
    comments: [],
    selectedCommentId: null,
    feedback: null,
  };
}

export function createCanvasComment(frameId: string, point: Point): CanvasComment {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `comment-${random}`,
    frameId,
    point,
    body: "",
    status: "open",
  };
}

