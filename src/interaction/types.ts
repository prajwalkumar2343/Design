export const INTERACTION_SNAPSHOT_SCHEMA_VERSION = 1 as const;

/** What the user was doing with the pointer at capture time. */
export type PointerActivityKind = "pointing" | "fixing" | "drawing";

export interface InteractionPoint {
  x: number;
  y: number;
}

/** One bounded pointer sample in canvas (world) coordinates. */
export interface InteractionSample extends InteractionPoint {
  atMs: number;
  frameId: string | null;
  /** The element under the pointer, if any (from the frame bridge). */
  elementId: string | null;
  /** Pointer button bitmask at sample time. */
  buttons: number;
  pointerId: number;
}

/**
 * A bounded pointer gesture: the person pressed, moved, and released while
 * drawing or fixing. Only metadata is kept — never the full sample stream.
 */
export interface InteractionStroke {
  kind: "drawing" | "fixing";
  pointerId: number;
  startedAtMs: number;
  endedAtMs: number | null;
  frameId: string | null;
  sampleCount: number;
  /** Distinct elements the stroke passed over. */
  elementIds: string[];
  /** Bounding box of the stroke in canvas coordinates. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

/** A recorded edit/fix applied to an element (style, text, geometry, gesture). */
export interface FixEvent {
  atMs: number;
  frameId: string | null;
  elementId: string;
}

/**
 * The bounded, agent-facing snapshot of what the person was doing with the
 * mouse: where they moved, which elements they pointed at, and what they fixed
 * or drew over. Intended to accompany dictation so the agent can reconstruct
 * "the person is pointing at the hero title" or "they drew a circle over the
 * pricing card".
 */
export interface PointerInteractionSnapshot {
  schemaVersion: typeof INTERACTION_SNAPSHOT_SCHEMA_VERSION;
  capturedAtMs: number;
  activity: PointerActivityKind;
  /** Latest pointer position and target. */
  current: InteractionSample | null;
  /** Bounded movement trail, oldest first. */
  trail: InteractionSample[];
  /** Completed and in-progress gestures. */
  strokes: InteractionStroke[];
  /** Fix/edit events. */
  fixes: FixEvent[];
  /** Distinct elements pointed at (hovered) during the window. */
  pointedElementIds: string[];
  /** Distinct elements drawn over during the window. */
  drawOverElementIds: string[];
  /** Distinct elements fixed during the window. */
  fixElementIds: string[];
}
