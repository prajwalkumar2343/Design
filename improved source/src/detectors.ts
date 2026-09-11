/**
 * Frustration-signal detectors.
 *
 * Pure, deterministic functions over event streams — no DOM, no clocks, no I/O
 * — so they run identically in the browser (live, on a bounded rolling window)
 * and offline (over stored sessions).
 *
 * Threshold defaults come from published behavior of production tools:
 *  - Rage clicks: ≥3 clicks in a small radius within ~1.5s with no page
 *    response between them (Clarity / Datadog / LaunchDarkly conventions).
 *  - Dead clicks: a click on an interactive-looking element with no visible
 *    response within ~700ms.
 *  - Ghost gestures (our extension for design tools): repeated fast pointer
 *    approaches toward a region whose expected UI response never appears —
 *    e.g. sweeping the mouse to the right edge twice because the sidebar
 *    failed to open the first time.
 */

import type { PromptEventRecord, Rect, TrackedEvent } from "./events.ts";

/** A prompt-sent event with its kind narrowed to the literal. */
type PromptSentRecord = Omit<PromptEventRecord, "kind"> & { readonly kind: "prompt-sent" };

export type SignalKind =
  | "ghost-gesture"
  | "rage-click"
  | "dead-click"
  | "error-click"
  | "mouse-thrash"
  | "excessive-scroll"
  | "prompt-retry";

export interface FrustrationSignal {
  readonly id: string;
  readonly kind: SignalKind;
  /** Session-relative time of the final evidence event, ms. */
  readonly atMs: number;
  /** Dotted feature key the signal points at, e.g. `left-sidebar`, `canvas.zoom`. */
  readonly feature: string;
  /** 0..1 — how certain we are this is genuine frustration. */
  readonly confidence: number;
  /** 0..1 — how much pain this pattern implies when it does happen. */
  readonly severity: number;
  readonly evidence: string[];
}

export interface DetectorConfig {
  ghostGesture?: Partial<GhostGestureConfig>;
  rageClick?: Partial<RageClickConfig>;
  deadClick?: Partial<DeadClickConfig>;
  mouseThrash?: Partial<MouseThrashConfig>;
  excessiveScroll?: Partial<ExcessiveScrollConfig>;
  promptRetry?: Partial<PromptRetryConfig>;
}

export interface GhostTargetConfig {
  /** Stable id, e.g. `left-sidebar-edge`. */
  id: string;
  /** Feature key emitted in signals and matched against ui-state changes. */
  feature: string;
  /** Core region of the target (the collapsed rail, an edge strip, a button). */
  region: Rect;
  /** Extra px around the region that still counts as "arriving". */
  tolerancePx: number;
  /** Minimum approach speed into the region for it to count as an attempt, px/ms. */
  minApproachSpeedPxMs: number;
  /** A ui-state change to this feature+property+value resolves the attempt. */
  expectedProperty?: string;
  expectedValue?: string;
  /** Attempts older than this do not chain into one signal, ms. */
  repeatWindowMs: number;
  /** Attempts needed to fire a signal. */
  attemptsThreshold: number;
}

export interface GhostGestureConfig {
  targets: GhostTargetConfig[];
  /** Samples used to compute approach speed, ms lookback. */
  speedLookbackMs: number;
}

export interface RageClickConfig {
  minClicks: number;
  radiusPx: number;
  windowMs: number;
  featureBySelector: Readonly<Record<string, string>>;
  defaultFeature: string;
}

export interface DeadClickConfig {
  responseWindowMs: number;
  errorWindowMs: number;
  featureBySelector: Readonly<Record<string, string>>;
  defaultFeature: string;
}

export interface MouseThrashConfig {
  windowMs: number;
  reversalsThreshold: number;
  areaRadiusPx: number;
  feature: string;
}

export interface ExcessiveScrollConfig {
  windowMs: number;
  distanceThresholdPx: number;
  defaultFeature: string;
}

export interface PromptRetryConfig {
  similarityThreshold: number;
  maxGapMs: number;
  maxTextLength: number;
}

const DEFAULTS: Required<{
  rageClick: RageClickConfig;
  deadClick: DeadClickConfig;
  mouseThrash: MouseThrashConfig;
  excessiveScroll: ExcessiveScrollConfig;
  promptRetry: PromptRetryConfig;
}> = {
  rageClick: {
    minClicks: 3,
    radiusPx: 60,
    windowMs: 1500,
    featureBySelector: {},
    defaultFeature: "canvas",
  },
  deadClick: {
    responseWindowMs: 700,
    errorWindowMs: 1000,
    featureBySelector: {},
    defaultFeature: "canvas",
  },
  mouseThrash: {
    windowMs: 2000,
    reversalsThreshold: 6,
    areaRadiusPx: 120,
    feature: "canvas",
  },
  excessiveScroll: {
    windowMs: 10_000,
    distanceThresholdPx: 6400,
    defaultFeature: "canvas.scroll",
  },
  promptRetry: {
    similarityThreshold: 0.7,
    maxGapMs: 10 * 60_000,
    maxTextLength: 4000,
  },
};

function merge<T extends object>(base: T, patch?: Partial<T>): T {
  return { ...base, ...(patch ?? {}) };
}

let signalCounter = 0;
/** Deterministic-ish unique id; uniqueness only matters within one process. */
export function nextSignalId(kind: SignalKind): string {
  signalCounter += 1;
  return `${kind}-${signalCounter}`;
}
export function resetSignalIds(): void {
  signalCounter = 0;
}

/* ------------------------------------------------------------------ */
/* Ghost gestures                                                      */
/* ------------------------------------------------------------------ */

interface Attempt {
  atMs: number;
  x: number;
  y: number;
  speedPxMs: number;
}

/**
 * Repeated fast approaches toward a region that produced no UI response.
 * This is exactly the motivating scenario: move the mouse right, sidebar
 * doesn't appear, quickly sweep again → frustration on `left-sidebar`.
 */
export function detectGhostGestures(
  events: readonly TrackedEvent[],
  config: GhostGestureConfig,
): FrustrationSignal[] {
  const signals: FrustrationSignal[] = [];
  if (config.targets.length === 0) return signals;

  const pointer: Extract<TrackedEvent, { category: "pointer" }>[] = [];
  for (const event of events) pointer.push(...collectPointer(event));

  for (const target of config.targets) {
    const expanded = expandRect(target.region, target.tolerancePx);
    const attempts: Attempt[] = [];

    let inside = false;
    for (let i = 0; i < pointer.length; i++) {
      const sample = pointer[i]!;
      const nowInside = pointInRect(sample.x, sample.y, expanded);
      if (nowInside && !inside) {
        const speed = approachSpeed(pointer, i, config.speedLookbackMs);
        if (speed >= target.minApproachSpeedPxMs) {
          // Session-relative tMs keeps every detector on one clock.
          attempts.push({ atMs: sample.tMs, x: sample.x, y: sample.y, speedPxMs: speed });
        }
      }
      inside = nowInside;
    }

    // A UI response answering the target resolves frustration: approaches
    // after it are fresh intent, not repeated failure.
    const responses = collectResponses(events, target);

    // Chain consecutive attempts that were never answered by a UI response.
    let chain: Attempt[] = [];
    const flushChain = () => {
      if (chain.length >= target.attemptsThreshold && !wasAnswered(chain, responses)) {
        const last = chain.at(-1)!;
        signals.push({
          id: nextSignalId("ghost-gesture"),
          kind: "ghost-gesture",
          atMs: last.atMs,
          feature: target.feature,
          confidence: Math.min(1, 0.55 + 0.15 * (chain.length - target.attemptsThreshold)),
          severity: Math.min(1, 0.6 + 0.1 * chain.length),
          evidence: chain.map(
            (a) =>
              `fast approach #${chain.indexOf(a) + 1} to ${target.id} at t=${Math.round(a.atMs)}ms ` +
              `(${Math.round(a.speedPxMs)}px/ms) — no ${target.feature} response followed`,
          ),
        });
      }
      chain = [];
    };

    for (const attempt of attempts) {
      if (
        chain.length > 0 &&
        attempt.atMs - chain[0]!.atMs > target.repeatWindowMs
      ) {
        flushChain();
      }
      chain.push(attempt);
    }
    flushChain();
  }
  return signals;
}

/** True when a UI response for the target landed between the first approach and a grace window after the last. */
function wasAnswered(chain: readonly Attempt[], responseTimes: readonly number[]): boolean {
  const first = chain[0]!.atMs;
  const last = chain.at(-1)!.atMs + RESPONSE_GRACE_MS;
  return responseTimes.some((t) => t >= first && t <= last);
}

const RESPONSE_GRACE_MS = 250;

function collectPointer(event: TrackedEvent): Extract<TrackedEvent, { category: "pointer" }>[] {
  return event.category === "pointer" ? [event] : [];
}

function collectResponses(events: readonly TrackedEvent[], target: GhostTargetConfig): number[] {
  const times: number[] = [];
  for (const event of events) {
    if (event.category !== "ui-state") continue;
    if (event.feature !== target.feature) continue;
    if (target.expectedProperty && event.property !== target.expectedProperty) continue;
    if (target.expectedValue && event.to !== target.expectedValue) continue;
    times.push(event.tMs);
  }
  return times;
}

function pointInRect(x: number, y: number, rect: Rect): boolean {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

function expandRect(rect: Rect, byPx: number): Rect {
  return {
    x: rect.x - byPx,
    y: rect.y - byPx,
    width: rect.width + byPx * 2,
    height: rect.height + byPx * 2,
  };
}

/** Average speed of the final hop into the region; robust to pauses before it. */
function approachSpeed(
  samples: readonly { x: number; y: number; atMs: number }[],
  index: number,
  lookbackMs: number,
): number {
  const current = samples[index]!;
  for (let j = index - 1; j >= 0; j--) {
    const prior = samples[j]!;
    const dt = current.atMs - prior.atMs;
    if (dt <= 0) continue;
    if (dt > lookbackMs) return 0;
    return Math.hypot(current.x - prior.x, current.y - prior.y) / dt;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Rage / dead / error clicks                                          */
/* ------------------------------------------------------------------ */

type ClickRecord = Extract<TrackedEvent, { category: "click" }>;

export function detectRageClicks(
  events: readonly TrackedEvent[],
  patch?: Partial<RageClickConfig>,
): FrustrationSignal[] {
  const config = merge(DEFAULTS.rageClick, patch);
  const signals: FrustrationSignal[] = [];
  const clicks = events.filter((e): e is ClickRecord => e.category === "click");

  let cluster: ClickRecord[] = [];
  const flush = () => {
    if (cluster.length >= config.minClicks) {
      const last = cluster.at(-1)!;
      const selectors = new Set(cluster.map((c) => c.target));
      const feature =
        config.featureBySelector[last.target] ?? featureFromTarget(last.target) ?? config.defaultFeature;
      signals.push({
        id: nextSignalId("rage-click"),
        kind: "rage-click",
        atMs: last.tMs,
        feature,
        confidence: Math.min(1, 0.5 + 0.12 * (cluster.length - config.minClicks)),
        severity: Math.min(1, 0.55 + 0.08 * cluster.length),
        evidence: [
          `${cluster.length} clicks within ${config.radiusPx}px over ${Math.round(
            last.tMs - cluster[0]!.tMs,
          )}ms`,
          `targets: ${[...selectors].join(", ")}`,
          "no UI state change between first and last click",
        ],
      });
    }
    cluster = [];
  };

  for (const click of clicks) {
    const previous = cluster.at(-1);
    if (
      previous &&
      (click.tMs - previous.tMs > config.windowMs ||
        Math.hypot(click.x - previous.x, click.y - previous.y) > config.radiusPx)
    ) {
      flush();
    }
    cluster.push(click);
  }
  flush();
  return signals;
}

export function detectDeadAndErrorClicks(
  events: readonly TrackedEvent[],
  patch?: Partial<DeadClickConfig>,
): FrustrationSignal[] {
  const config = merge(DEFAULTS.deadClick, patch);
  const signals: FrustrationSignal[] = [];

  for (let i = 0; i < events.length; i++) {
    const click = events[i];
    if (!click || click.category !== "click" || !click.lookedInteractive) continue;

    let responded = false;
    let erroredAt: number | null = null;
    for (let j = i + 1; j < events.length; j++) {
      const later = events[j]!;
      const dt = later.tMs - click.tMs;
      if (dt > Math.max(config.responseWindowMs, config.errorWindowMs)) break;
      if (isResponse(later)) {
        responded = true;
        break;
      }
      if (later.category === "error" && dt <= config.errorWindowMs && erroredAt === null) {
        erroredAt = later.tMs;
      }
    }

    const feature =
      config.featureBySelector[click.target] ?? featureFromTarget(click.target) ?? config.defaultFeature;

    if (erroredAt !== null) {
      signals.push({
        id: nextSignalId("error-click"),
        kind: "error-click",
        atMs: erroredAt,
        feature,
        confidence: 0.85,
        severity: 0.9,
        evidence: [`click on "${click.label ?? click.target}" was followed by an app error`],
      });
    } else if (!responded) {
      signals.push({
        id: nextSignalId("dead-click"),
        kind: "dead-click",
        atMs: click.tMs + config.responseWindowMs,
        feature,
        confidence: click.lookedInteractive ? 0.6 : 0.4,
        severity: 0.5,
        evidence: [
          `no visible response within ${config.responseWindowMs}ms after clicking "${
            click.label ?? click.target
          }"`,
        ],
      });
    }
  }
  return signals;
}

function isResponse(event: TrackedEvent): boolean {
  return (
    event.category === "ui-state" ||
    event.category === "artifact" ||
    event.category === "prompt" ||
    (event.category === "custom" && event.kind === "response")
  );
}

/** Derives a dotted feature key from a selector like `button#open-sidebar` → `button.open-sidebar`. */
export function featureFromTarget(target: string): string | null {
  const match = /^([a-z-]+)(?:[#.]([A-Za-z0-9_-]+))?/.exec(target);
  if (!match) return null;
  const tag = match[1];
  const name = match[2];
  return name ? `${tag}.${name.replace(/([A-Z])/g, "-$1").toLowerCase()}` : tag ?? null;
}

/* ------------------------------------------------------------------ */
/* Mouse thrash & excessive scroll                                     */
/* ------------------------------------------------------------------ */

export function detectMouseThrash(
  events: readonly TrackedEvent[],
  patch?: Partial<MouseThrashConfig>,
): FrustrationSignal[] {
  const config = merge(DEFAULTS.mouseThrash, patch);
  const moves = events.filter((e): e is Extract<TrackedEvent, { category: "pointer" }> => e.category === "pointer");
  const signals: FrustrationSignal[] = [];

  let windowMoves: typeof moves = [];
  const evaluate = () => {
    if (windowMoves.length < config.reversalsThreshold) return;
    let reversals = 0;
    let lastDx = 0;
    let lastDy = 0;
    for (let i = 1; i < windowMoves.length; i++) {
      const dx = windowMoves[i]!.x - windowMoves[i - 1]!.x;
      const dy = windowMoves[i]!.y - windowMoves[i - 1]!.y;
      if ((lastDx !== 0 && Math.sign(dx) === -Math.sign(lastDx)) ||
          (lastDy !== 0 && Math.sign(dy) === -Math.sign(lastDy))) {
        reversals += 1;
      }
      if (dx !== 0) lastDx = dx;
      if (dy !== 0) lastDy = dy;
    }
    const xs = windowMoves.map((m) => m.x);
    const ys = windowMoves.map((m) => m.y);
    const spreadX = Math.max(...xs) - Math.min(...xs);
    const spreadY = Math.max(...ys) - Math.min(...ys);
    if (reversals >= config.reversalsThreshold && Math.max(spreadX, spreadY) < config.areaRadiusPx * 2) {
      signals.push({
        id: nextSignalId("mouse-thrash"),
        kind: "mouse-thrash",
        atMs: windowMoves.at(-1)!.tMs,
        feature: config.feature,
        confidence: Math.min(1, 0.45 + 0.06 * reversals),
        severity: 0.45,
        evidence: [
          `${reversals} direction reversals within ${config.windowMs}ms in a ${
            Math.round(Math.max(spreadX, spreadY))
          }px area`,
        ],
      });
    }
  };

  for (const move of moves) {
    while (windowMoves.length > 0 && move.tMs - windowMoves[0]!.tMs > config.windowMs) {
      windowMoves = windowMoves.slice(1);
    }
    windowMoves.push(move);
    evaluate();
  }
  return signals.filter(dedupeNearby(1500));
}

export function detectExcessiveScroll(
  events: readonly TrackedEvent[],
  patch?: Partial<ExcessiveScrollConfig>,
): FrustrationSignal[] {
  const config = merge(DEFAULTS.excessiveScroll, patch);
  const scrolls = events.filter((e): e is Extract<TrackedEvent, { category: "scroll" }> => e.category === "scroll");
  const signals: FrustrationSignal[] = [];

  let windowScrolls: typeof scrolls = [];
  let distance = 0;
  const evaluate = () => {
    if (distance >= config.distanceThresholdPx && windowScrolls.length >= 2) {
      const surface = windowScrolls.at(-1)!.surface;
      signals.push({
        id: nextSignalId("excessive-scroll"),
        kind: "excessive-scroll",
        atMs: windowScrolls.at(-1)!.tMs,
        feature: surface ? `${surface}.scroll` : config.defaultFeature,
        confidence: 0.5,
        severity: 0.4,
        evidence: [
          `${Math.round(distance)}px scrolled on ${surface || "page"} within ${config.windowMs}ms`,
        ],
      });
    }
  };

  for (const scroll of scrolls) {
    while (windowScrolls.length > 0 && scroll.tMs - windowScrolls[0]!.tMs > config.windowMs) {
      distance -= Math.abs(windowScrolls[0]!.delta);
      windowScrolls = windowScrolls.slice(1);
    }
    windowScrolls.push(scroll);
    distance += Math.abs(scroll.delta);
    evaluate();
  }
  return signals.filter(dedupeNearby(3000));
}

/* ------------------------------------------------------------------ */
/* Prompt retries                                                      */
/* ------------------------------------------------------------------ */

export function detectPromptRetries(
  events: readonly TrackedEvent[],
  patch?: Partial<PromptRetryConfig>,
): FrustrationSignal[] {
  const config = merge(DEFAULTS.promptRetry, patch);
  const signals: FrustrationSignal[] = [];

  const prompts = events.filter(
    (e): e is PromptSentRecord => e.category === "prompt" && e.kind === "prompt-sent",
  );

  for (let i = 1; i < prompts.length; i++) {
    const retry = prompts[i]!;
    const previous = prompts[i - 1]!;
    if (retry.tMs - previous.tMs > config.maxGapMs) continue;

    // An accepted artifact between the two prompts means the user moved on happily.
    const acceptedBetween = events.some(
      (e) =>
        e.category === "artifact" &&
        e.kind === "artifact-accepted" &&
        e.tMs >= previous.tMs &&
        e.tMs <= retry.tMs,
    );
    if (acceptedBetween) continue;

    const similarity = tokenSimilarity(previous.text, retry.text, config.maxTextLength);
    if (similarity >= config.similarityThreshold) {
      signals.push({
        id: nextSignalId("prompt-retry"),
        kind: "prompt-retry",
        atMs: retry.tMs,
        feature: "agent.prompt",
        confidence: Math.min(1, 0.5 + 0.3 * similarity),
        severity: 0.7,
        evidence: [
          `prompt re-sent with ${(similarity * 100).toFixed(0)}% similarity after no accepted artifact`,
        ],
      });
    }
  }
  return signals;
}

function tokenize(text: string, maxLength: number): Set<string> {
  const clipped = text.slice(0, maxLength).toLowerCase();
  return new Set(clipped.split(/[^a-z0-9]+/u).filter((token) => token.length > 0));
}

export function tokenSimilarity(a: string, b: string, maxLength: number): number {
  const setA = tokenize(a, maxLength);
  const setB = tokenize(b, maxLength);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Collapses signals of the same kind that fire close together. */
function dedupeNearby(minGapMs: number): (signal: FrustrationSignal, index: number, all: FrustrationSignal[]) => boolean {
  return (signal, index, all) => {
    const previousSameKindBefore = all[index - 1];
    if (!previousSameKindBefore || previousSameKindBefore.kind !== signal.kind) return true;
    return signal.atMs - previousSameKindBefore.atMs >= minGapMs;
  };
}

/**
 * Runs every detector once and returns the merged, time-sorted signal list.
 */
export function runAllDetectors(events: readonly TrackedEvent[], config?: DetectorConfig): FrustrationSignal[] {
  const signals: FrustrationSignal[] = [];
  if (config?.ghostGesture?.targets?.length) {
    signals.push(...detectGhostGestures(events, {
      targets: config.ghostGesture.targets,
      speedLookbackMs: config.ghostGesture.speedLookbackMs ?? 120,
    }));
  }
  signals.push(...detectRageClicks(events, config?.rageClick));
  signals.push(...detectDeadAndErrorClicks(events, config?.deadClick));
  signals.push(...detectMouseThrash(events, config?.mouseThrash));
  signals.push(...detectExcessiveScroll(events, config?.excessiveScroll));
  signals.push(...detectPromptRetries(events, config?.promptRetry));
  const order: Record<SignalKind, number> = {
    "ghost-gesture": 0,
    "rage-click": 1,
    "dead-click": 2,
    "error-click": 3,
    "mouse-thrash": 4,
    "excessive-scroll": 5,
    "prompt-retry": 6,
  };
  return signals.sort((a, b) => a.atMs - b.atMs || order[a.kind] - order[b.kind]);
}
