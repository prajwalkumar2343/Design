import {
  type FixEvent,
  type InteractionSample,
  type InteractionStroke,
  type PointerActivityKind,
  type PointerInteractionSnapshot,
} from "./types";

export const MAX_TRAIL_SAMPLES = 600;
export const MAX_TRAIL_WINDOW_MS = 60_000;
export const MIN_SAMPLE_DISTANCE = 2;
export const MAX_ACTIVE_STROKES = 24;
export const MAX_STROKE_SAMPLES = 256;
export const MAX_DISTINCT_ELEMENTS = 64;
export const MAX_FIX_EVENTS = 32;

export type PointerInteractionRecorderErrorCode =
  | "invalid-input"
  | "stroke-already-active";

export class PointerInteractionRecorderError extends Error {
  readonly code: PointerInteractionRecorderErrorCode;

  constructor(code: PointerInteractionRecorderErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PointerInteractionRecorderError";
    this.code = code;
  }
}

export interface PointerSampleInput {
  /** Canvas (world) coordinates — the caller maps screen/iframe points first. */
  x: number;
  y: number;
  atMs?: number;
  frameId?: string | null;
  /** Element under the pointer as reported by the frame bridge. */
  elementId?: string | null;
  buttons?: number;
  pointerId?: number;
}

export interface MarkFixInput {
  elementId: string;
  atMs?: number;
  frameId?: string | null;
}

export interface PointerInteractionRecorderOptions {
  maxTrailSamples?: number;
  maxTrailWindowMs?: number;
  minSampleDistance?: number;
  maxStrokes?: number;
  maxDistinctElements?: number;
  maxFixEvents?: number;
  now?: () => number;
}

function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function distinctList(existing: string[], id: string | null, max: number): string[] {
  if (!id) return existing;
  if (existing.includes(id)) return existing;
  const next = [...existing, id];
  return next.length > max ? next.slice(next.length - max) : next;
}

function extendBounds(
  bounds: InteractionStroke["bounds"],
  x: number,
  y: number,
): InteractionStroke["bounds"] {
  if (bounds === null) return { minX: x, minY: y, maxX: x, maxY: y };
  return {
    minX: Math.min(bounds.minX, x),
    minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x),
    maxY: Math.max(bounds.maxY, y),
  };
}

/**
 * Bounded, framework-free recorder of mouse activity against the canvas.
 *
 * Captures the movement trail, distinct elements pointed at, drawing strokes,
 * and fix/edit events so that a later layer can attach "what the person was
 * doing with the mouse" to a dictation. All collections are bounded — the
 * recorder never grows without limit. Nothing here touches the DOM or the
 * bridge; callers feed it already-mapped canvas coordinates.
 */
export class PointerInteractionRecorder {
  private readonly maxTrailSamples: number;
  private readonly maxTrailWindowMs: number;
  private readonly minSampleDistance: number;
  private readonly maxStrokes: number;
  private readonly maxDistinctElements: number;
  private readonly maxFixEvents: number;
  private readonly now: () => number;

  private trail: InteractionSample[] = [];
  private strokes: InteractionStroke[] = [];
  private fixes: FixEvent[] = [];
  private pointedElementIds: string[] = [];
  private drawOverElementIds: string[] = [];
  private fixElementIds: string[] = [];
  private activity: PointerActivityKind = "pointing";
  private lastSample: InteractionSample | null = null;

  constructor(options: PointerInteractionRecorderOptions = {}) {
    this.maxTrailSamples = options.maxTrailSamples ?? MAX_TRAIL_SAMPLES;
    this.maxTrailWindowMs = options.maxTrailWindowMs ?? MAX_TRAIL_WINDOW_MS;
    this.minSampleDistance = options.minSampleDistance ?? MIN_SAMPLE_DISTANCE;
    this.maxStrokes = options.maxStrokes ?? MAX_ACTIVE_STROKES;
    this.maxDistinctElements = options.maxDistinctElements ?? MAX_DISTINCT_ELEMENTS;
    this.maxFixEvents = options.maxFixEvents ?? MAX_FIX_EVENTS;
    this.now = options.now ?? (() => Date.now());
  }

  private activeStroke(pointerId: number): InteractionStroke | undefined {
    return this.strokes.find(
      (stroke) => stroke.pointerId === pointerId && stroke.endedAtMs === null,
    );
  }

  setActivity(activity: PointerActivityKind): void {
    this.activity = activity;
  }

  /** Records one pointer movement; returns the stored sample or null when filtered as jitter. */
  sample(input: PointerSampleInput): InteractionSample | null {
    const { x, y } = input;
    if (!isFinitePoint(x, y)) {
      throw new PointerInteractionRecorderError("invalid-input", "Pointer sample must be finite");
    }
    const atMs = input.atMs ?? this.now();
    const pointerId = input.pointerId ?? 0;
    const buttons = input.buttons ?? 0;
    const frameId = input.frameId ?? null;
    const elementId = input.elementId ?? null;

    const sample: InteractionSample = {
      atMs,
      x,
      y,
      frameId,
      elementId,
      buttons,
      pointerId,
    };

    const stroke = this.activeStroke(pointerId);
    if (stroke && stroke.sampleCount < MAX_STROKE_SAMPLES) {
      stroke.sampleCount += 1;
      stroke.bounds = extendBounds(stroke.bounds, x, y);
      stroke.frameId = stroke.frameId ?? frameId;
      if (elementId && !stroke.elementIds.includes(elementId)) {
        stroke.elementIds.push(elementId);
        this.drawOverElementIds = distinctList(
          this.drawOverElementIds,
          elementId,
          this.maxDistinctElements,
        );
      }
    }

    if (elementId) {
      this.pointedElementIds = distinctList(
        this.pointedElementIds,
        elementId,
        this.maxDistinctElements,
      );
    }

    const last = this.lastSample;
    if (
      last !== null &&
      Math.hypot(sample.x - last.x, sample.y - last.y) < this.minSampleDistance &&
      sample.elementId === last.elementId &&
      sample.buttons === last.buttons
    ) {
      return null;
    }

    this.trail.push(sample);
    this.lastSample = sample;

    const cutoff = atMs - this.maxTrailWindowMs;
    while (
      this.trail.length > this.maxTrailSamples ||
      (this.trail.length > 1 && this.trail[0].atMs < cutoff)
    ) {
      this.trail.shift();
    }
    return sample;
  }

  /** Starts a drawing or fixing gesture for one pointer. */
  beginStroke(kind: "drawing" | "fixing", pointerId: number, atMs?: number): void {
    if (this.activeStroke(pointerId)) {
      throw new PointerInteractionRecorderError(
        "stroke-already-active",
        `Stroke for pointer ${pointerId} is already active`,
      );
    }
    const stroke: InteractionStroke = {
      kind,
      pointerId,
      startedAtMs: atMs ?? this.now(),
      endedAtMs: null,
      frameId: null,
      sampleCount: 0,
      elementIds: [],
      bounds: null,
    };
    this.strokes.push(stroke);
    if (this.strokes.length > this.maxStrokes) {
      const firstOpen = this.strokes.findIndex((item) => item.endedAtMs === null);
      if (firstOpen === 0) {
        this.strokes.shift();
      } else {
        this.strokes.splice(0, 1);
      }
    }
  }

  /** Completes an active gesture. */
  endStroke(pointerId: number, atMs?: number): void {
    const stroke = this.activeStroke(pointerId);
    if (!stroke) return;
    stroke.endedAtMs = atMs ?? this.now();
    if (stroke.kind === "fixing" && stroke.elementIds.length > 0) {
      this.fixElementIds = distinctList(
        this.fixElementIds,
        stroke.elementIds[stroke.elementIds.length - 1],
        this.maxDistinctElements,
      );
    }
  }

  /** Abandons an active gesture without recording it as completed. */
  cancelStroke(pointerId: number): void {
    const index = this.strokes.findIndex(
      (stroke) => stroke.pointerId === pointerId && stroke.endedAtMs === null,
    );
    if (index >= 0) this.strokes.splice(index, 1);
  }

  /** Records a fix/edit applied to an element. */
  markFix(input: MarkFixInput): void {
    if (!input.elementId) {
      throw new PointerInteractionRecorderError("invalid-input", "Fix target is required");
    }
    this.fixes.push({
      atMs: input.atMs ?? this.now(),
      frameId: input.frameId ?? null,
      elementId: input.elementId,
    });
    if (this.fixes.length > this.maxFixEvents) {
      this.fixes.shift();
    }
    this.fixElementIds = distinctList(
      this.fixElementIds,
      input.elementId,
      this.maxDistinctElements,
    );
  }

  /** Bounded snapshot for the agent; never the raw, unbounded history. */
  snapshot(): PointerInteractionSnapshot {
    return {
      schemaVersion: 1,
      capturedAtMs: this.now(),
      activity: this.activity,
      current: this.lastSample,
      trail: [...this.trail],
      strokes: this.strokes.map((stroke) => ({
        ...stroke,
        elementIds: [...stroke.elementIds],
        bounds: stroke.bounds === null ? null : { ...stroke.bounds },
      })),
      fixes: [...this.fixes],
      pointedElementIds: [...this.pointedElementIds],
      drawOverElementIds: [...this.drawOverElementIds],
      fixElementIds: [...this.fixElementIds],
    };
  }

  /** Clears the window — call after a dictation capture has been consumed. */
  reset(): void {
    this.trail = [];
    this.strokes = [];
    this.fixes = [];
    this.pointedElementIds = [];
    this.drawOverElementIds = [];
    this.fixElementIds = [];
    this.lastSample = null;
    this.activity = "pointing";
  }
}
