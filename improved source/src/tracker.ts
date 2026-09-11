/**
 * Browser tracker SDK.
 *
 * Two layers:
 *  - `TrackerCore` is pure: it assigns sequence numbers, samples/bounds the
 *    event stream, keeps the rolling window detectors need, and hands batches
 *    to a sink. Fully unit-testable without a DOM.
 *  - `installTracker()` wires real DOM listeners (pointer, click, scroll,
 *    error) plus app-level helpers (`trackPrompt`, `trackUiState`,
 *    `trackArtifact`) and runs live frustration detection on an interval,
 *    forwarding signals to the improvement engine.
 *
 * Sampling policy follows production practice: pointer moves are throttled by
 * distance/time, everything else records per-occurrence, all buffers bounded.
 */

import {
  runAllDetectors,
  type DetectorConfig,
  type FrustrationSignal,
} from "./detectors.ts";
import {
  type ArtifactEventRecord,
  type SessionHeader,
  type TrackedEvent,
} from "./events.ts";

export interface TrackerSink {
  /** Persists a batch of events; called at most once per flush interval. */
  write(events: readonly TrackedEvent[]): Promise<void>;
}

/** Distributive omit keeps the event union intact for callers. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A partially-timestamped event as handed to TrackerCore.record. */
export type TrackedEventInput = DistributiveOmit<TrackedEvent, "seq" | "atMs" | "tMs"> & {
  atMs?: number;
};

export interface TrackerCoreOptions {
  sessionId: string;
  sink: TrackerSink;
  /** Pointer sample coalescing: skip moves closer than this many px. */
  minPointerDistancePx?: number;
  /** …or more frequent than this many ms, whichever comes second. */
  minPointerIntervalMs?: number;
  /** Max events kept in memory awaiting flush. */
  maxBufferedEvents?: number;
  /** How often buffered events are written to the sink, ms. */
  flushIntervalMs?: number;
  now?: () => number;
}

interface PendingFlush {
  timer: ReturnType<typeof setTimeout> | null;
}

export class TrackerCore {
  private readonly sessionId: string;
  private readonly sink: TrackerSink;
  private readonly minPointerDistancePx: number;
  private readonly minPointerIntervalMs: number;
  private readonly maxBufferedEvents: number;
  private readonly now: () => number;

  private seq = 0;
  private startAtMs = 0;
  private lastPointer: { x: number; y: number; tMs: number } | null = null;
  private buffer: TrackedEvent[] = [];
  private readonly flushState: PendingFlush = { timer: null };
  private readonly flushIntervalMs: number;
  private flushing = false;
  /** Rolling window of recent raw events feeding live detectors. */
  private recent: TrackedEvent[] = [];
  private readonly maxRecentEvents = 4000;

  constructor(options: TrackerCoreOptions) {
    this.sessionId = options.sessionId;
    this.sink = options.sink;
    this.minPointerDistancePx = options.minPointerDistancePx ?? 6;
    this.minPointerIntervalMs = options.minPointerIntervalMs ?? 40;
    this.maxBufferedEvents = options.maxBufferedEvents ?? 2000;
    this.flushIntervalMs = options.flushIntervalMs ?? 5_000;
    this.now = options.now ?? (() => Date.now());
  }

  begin(startedAtMs?: number): void {
    this.startAtMs = startedAtMs ?? this.now();
  }

  get currentSeq(): number {
    return this.seq;
  }

  /** Core ingestion path used by DOM wiring and app instrumentation alike. */
  record(event: TrackedEventInput): void {
    const atMs = event.atMs ?? this.now();
    const record = {
      ...event,
      seq: this.seq++,
      atMs,
      tMs: Math.max(0, atMs - this.startAtMs),
    } as TrackedEvent;

    if (
      record.category === "pointer" &&
      !this.shouldKeepPointer(record.x, record.y, record.atMs)
    ) {
      return;
    }

    this.buffer.push(record);
    this.recent.push(record);
    if (this.recent.length > this.maxRecentEvents) {
      this.recent = this.recent.slice(-this.maxRecentEvents);
    }
    if (this.buffer.length >= this.maxBufferedEvents) {
      void this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  private shouldKeepPointer(x: number, y: number, atMs: number): boolean {
    const last = this.lastPointer;
    if (!last) {
      this.lastPointer = { x, y, tMs: atMs };
      return true;
    }
    const movedFar = Math.hypot(x - last.x, y - last.y) >= this.minPointerDistancePx;
    const enoughTime = atMs - last.tMs >= this.minPointerIntervalMs;
    if (movedFar || enoughTime) {
      this.lastPointer = { x, y, tMs: atMs };
      return true;
    }
    return false;
  }

  private scheduleFlush(): void {
    if (this.flushState.timer) return;
    this.flushState.timer = setTimeout(() => {
      this.flushState.timer = null;
      void this.flush();
    }, this.flushIntervalMs);
  }

  /** Writes buffered events to the sink; safe to call concurrently. */
  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.sink.write(batch);
    } catch {
      // Local persistence must never break the app; drop the batch silently.
    } finally {
      this.flushing = false;
    }
  }

  snapshotRecent(): readonly TrackedEvent[] {
    return this.recent;
  }
}

/* ------------------------------------------------------------------ */
/* DOM installation                                                    */
/* ------------------------------------------------------------------ */

/** Stable-ish selector for an element, e.g. `button#save` or `div.panel>span`. */
export function selectorFor(element: Element | null): string {
  if (!element) return "unknown";
  const tag = element.tagName.toLowerCase().replace(/[^a-z]/g, "") || "el";
  const id = element.getAttribute("id");
  if (id) return `${tag}#${id}`;
  const testId = element.getAttribute("data-testid");
  if (testId) return `${tag}[data-testid=${testId}]`;
  return tag;
}

function looksInteractive(element: Element | null): boolean {
  if (!element) return false;
  if (element.closest("button,a,input,textarea,select,[role=button],[onclick]")) return true;
  const cursor = element instanceof HTMLElement ? getComputedStyle(element).cursor : "";
  return cursor === "pointer";
}

function labelFor(element: Element | null): string | null {
  if (!element) return null;
  const text =
    element.getAttribute("aria-label") ??
    element.textContent?.trim().slice(0, 60) ??
    null;
  return text && text.length > 0 ? text : null;
}

export interface InstallOptions {
  core: TrackerCore;
  header: SessionHeader;
  detectorConfig?: DetectorConfig;
  /** Called whenever live detection produces signals (throttled per kind+feature). */
  onSignals?: (signals: readonly FrustrationSignal[]) => void;
  /** Interval between live detector passes, ms. */
  detectionIntervalMs?: number;
  targetWindow?: Window;
}

export interface InstalledTracker {
  stop(): void;
  trackUiState(feature: string, property: string, from: string | null, to: string): void;
  trackPrompt(promptId: string, text: string): void;
  trackArtifact(
    kind: ArtifactEventRecord["kind"],
    artifactId: string,
    artifactType: string,
    promptId: string | null,
    latencyMs: number | null,
  ): void;
  runDetectors(): FrustrationSignal[];
}

/**
 * Attaches listeners to the window/document. Returns a handle that both stops
 * observation and exposes typed methods for app-level events the DOM cannot see.
 */
export function installTracker(options: InstallOptions): InstalledTracker {
  const win = options.targetWindow ?? window;
  const doc = win.document;
  const { core } = options;

  const onPointerMove = (event: PointerEvent): void => {
    core.record({
      category: "pointer",
      kind: "pointer-move",
      x: event.clientX,
      y: event.clientY,
      buttons: event.buttons,
    });
  };
  const onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    core.record({
      category: "click",
      kind: "click",
      x: event.clientX,
      y: event.clientY,
      target: selectorFor(target),
      label: labelFor(target),
      lookedInteractive: looksInteractive(target),
    });
  };
  let lastScroll: { x: number; y: number } | null = null;
  const onScroll = (): void => {
    const x = win.scrollX;
    const y = win.scrollY;
    const delta = lastScroll ? Math.hypot(x - lastScroll.x, y - lastScroll.y) : 0;
    lastScroll = { x, y };
    if (delta < 8) return;
    core.record({
      category: "scroll",
      kind: "scroll",
      x,
      y,
      delta,
      surface: hoverSurface || "window",
    });
  };
  const onError = (event: ErrorEvent): void => {
    core.record({
      category: "error",
      kind: "app-error",
      message: String(event.message ?? "unknown").slice(0, 300),
      source: event.filename ? String(event.filename).slice(0, 300) : null,
    });
  };

  win.addEventListener("pointermove", onPointerMove, { passive: true });
  win.addEventListener("click", onClick, { passive: true });
  win.addEventListener("scroll", onScroll, { passive: true });
  win.addEventListener("error", onError);

  // Track which scrollable surface the pointer is over for scroll attribution.
  let hoverSurface = "";
  const onPointerOver = (event: PointerEvent): void => {
    const el = event.target instanceof Element ? event.target : null;
    const surface = el?.closest("[class*=scroll],[data-scroll-surface],main,body");
    hoverSurface = surface instanceof Element ? selectorFor(surface) : "";
  };
  win.addEventListener("pointerover", onPointerOver, { passive: true });

  const signalSeen = new Map<string, number>();
  const emitNew = (signals: readonly FrustrationSignal[]): FrustrationSignal[] => {
    const fresh: FrustrationSignal[] = [];
    for (const signal of signals) {
      const key = `${signal.kind}:${signal.feature}`;
      const lastAt = signalSeen.get(key) ?? -Infinity;
      if (signal.atMs - lastAt < 30_000) continue;
      signalSeen.set(key, signal.atMs);
      fresh.push(signal);
    }
    return fresh;
  };

  const pass = (): FrustrationSignal[] => {
    const signals = [
      ...runAllDetectors(core.snapshotRecent(), options.detectorConfig),
    ];
    const fresh = emitNew(signals);
    if (fresh.length > 0) options.onSignals?.(fresh);
    return fresh;
  };

  const detectionTimer =
    options.detectionIntervalMs === undefined
      ? null
      : setInterval(pass, options.detectionIntervalMs);

  return {
    stop(): void {
      win.removeEventListener("pointermove", onPointerMove);
      win.removeEventListener("click", onClick);
      win.removeEventListener("scroll", onScroll);
      win.removeEventListener("error", onError);
      win.removeEventListener("pointerover", onPointerOver);
      if (detectionTimer !== null) clearInterval(detectionTimer);
      void core.flush();
    },
    trackUiState(feature, property, from, to): void {
      core.record({ category: "ui-state", kind: "ui-state-change", feature, property, from, to });
    },
    trackPrompt(promptId: string, text: string): void {
      core.record({
        category: "prompt",
        kind: "prompt-sent",
        promptId,
        text: text.slice(0, 4000),
        textLength: text.length,
      });
    },
    trackArtifact(kind, artifactId, artifactType, promptId, latencyMs): void {
      core.record({ category: "artifact", kind, artifactId, artifactType, promptId, latencyMs });
    },
    runDetectors: pass,
  };
}
