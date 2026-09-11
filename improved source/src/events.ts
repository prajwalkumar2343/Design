/**
 * Event schema for the self-improvement loop.
 *
 * Every user action in the design tool is normalized into one of these
 * versioned, serializable events. The schema deliberately mirrors what the
 * best behavioral-analytics tools capture (Microsoft Clarity, Datadog RUM
 * frustration signals, rrweb) while adding design-tool-specific concepts:
 * prompts, generated artifacts, and UI state changes such as sidebars.
 *
 * Design rules, learned from researching production systems:
 *  - Bounded and sampled: raw pointer streams are downsampled at capture time;
 *    we never store unbounded video-like data.
 *  - Privacy-first: everything stays on the user's machine by default.
 *  - Appended-only: events are immutable facts; corrections happen as new events.
 */

export const EVENT_SCHEMA_VERSION = 1 as const;

/** High-level event categories used for storage partitioning and retention. */
export type EventCategory =
  | "pointer"
  | "click"
  | "scroll"
  | "input"
  | "prompt"
  | "artifact"
  | "ui-state"
  | "error"
  | "custom";

/**
 * A rectangle in viewport coordinates (px, origin top-left).
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EventBase {
  /** Monotonic-per-session sequence number assigned by the tracker. */
  readonly seq: number;
  /** Wall-clock milliseconds since epoch. */
  readonly atMs: number;
  /** Milliseconds since session start (monotonic clock), stable for ordering. */
  readonly tMs: number;
  readonly category: EventCategory;
  readonly kind: string;
}

/** One downsampled pointer sample. */
export interface PointerEventRecord extends EventBase {
  readonly category: "pointer";
  readonly kind: "pointer-move";
  readonly x: number;
  readonly y: number;
  /** Pointer button bitmask at sample time (0 = no buttons). */
  readonly buttons: number;
}

/** A click with its resolved target description. */
export interface ClickEventRecord extends EventBase {
  readonly category: "click";
  readonly kind: "click";
  readonly x: number;
  readonly y: number;
  /** Stable CSS-ish selector of the clicked element, e.g. `button#open-sidebar`. */
  readonly target: string;
  /** Accessible name or visible text of the target when available (trimmed). */
  readonly label: string | null;
  /** True when the element looks interactive (role/button/link/input/handlers). */
  readonly lookedInteractive: boolean;
}

/** Scroll position sample for a scrollable surface. */
export interface ScrollEventRecord extends EventBase {
  readonly category: "scroll";
  readonly kind: "scroll";
  readonly x: number;
  readonly y: number;
  /** Signed distance scrolled since previous sample, px. */
  readonly delta: number;
  readonly surface: string;
}

/** Text input activity (content never stored — only lengths and field ids). */
export interface InputEventRecord extends EventBase {
  readonly category: "input";
  readonly kind: "input-change" | "input-submit" | "input-abandon";
  readonly field: string;
  /** Character count typed so far in the field; content is never recorded. */
  readonly length: number;
}

/** The user sent a prompt to the agent. */
export interface PromptEventRecord extends EventBase {
  readonly category: "prompt";
  readonly kind: "prompt-sent" | "prompt-retry-flagged";
  readonly promptId: string;
  /** Normalized text kept locally to detect retries; may be truncated. */
  readonly text: string;
  readonly textLength: number;
}

/** An artifact (design/frame/website section) the tool produced or the user edited. */
export interface ArtifactEventRecord extends EventBase {
  readonly category: "artifact";
  readonly kind: "artifact-created" | "artifact-accepted" | "artifact-edited" | "artifact-discarded";
  readonly artifactId: string;
  readonly artifactType: string;
  readonly promptId: string | null;
  /** Time from prompt dispatch to this artifact transition, ms (null if n/a). */
  readonly latencyMs: number | null;
}

/** UI state changed: sidebar opened/collapsed, panel resized, tab switched… */
export interface UiStateEventRecord extends EventBase {
  readonly category: "ui-state";
  readonly kind: "ui-state-change";
  /** Dotted feature key, e.g. `left-sidebar`, `right-panel`. */
  readonly feature: string;
  readonly property: string;
  readonly from: string | null;
  readonly to: string;
}

/** A runtime error, ideally near the interaction that triggered it. */
export interface ErrorEventRecord extends EventBase {
  readonly category: "error";
  readonly kind: "app-error";
  readonly message: string;
  readonly source: string | null;
}

/** Application-defined event (e.g. custom instrumentation points). */
export interface CustomEventRecord extends EventBase {
  readonly category: "custom";
  readonly kind: string;
  readonly name: string;
  readonly detail: Record<string, string | number | boolean | null>;
}

export type TrackedEvent =
  | PointerEventRecord
  | ClickEventRecord
  | ScrollEventRecord
  | InputEventRecord
  | PromptEventRecord
  | ArtifactEventRecord
  | UiStateEventRecord
  | ErrorEventRecord
  | CustomEventRecord;

/** Session metadata written once at the start of each session. */
export interface SessionHeader {
  readonly schemaVersion: typeof EVENT_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly startedAtMs: number;
  readonly userAgent: string;
  /** Viewport size at start. */
  readonly viewport: { width: number; height: number };
  /** Identifier of the app build so improvements can be attributed. */
  readonly appVersion: string;
}

/** A stored session = header + ordered events. */
export interface StoredSession {
  readonly header: SessionHeader;
  readonly events: TrackedEvent[];
}

/** Structural guard applied to anything entering a store. */
export function assertTrackedEvent(event: TrackedEvent): void {
  if (!Number.isFinite(event.seq) || event.seq < 0) {
    throw new TypeError(`event.seq must be a non-negative finite number, got ${event.seq}`);
  }
  if (!Number.isFinite(event.atMs) || !Number.isFinite(event.tMs)) {
    throw new TypeError("event.atMs and event.tMs must be finite numbers");
  }
  if (typeof event.kind !== "string" || event.kind.length === 0) {
    throw new TypeError("event.kind must be a non-empty string");
  }
}
