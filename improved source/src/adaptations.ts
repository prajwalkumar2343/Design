/**
 * The adaptation catalog: concrete, reviewable UI changes the system may make.
 *
 * Every adaptation is small, reversible, and tied to one feature. This mirrors
 * what makes adaptive-UI research (SUPPLE, RL-based personalization) work in
 * practice: constrain the action space, then let evidence pick actions.
 */

export type AdaptationKind =
  /** Open a collapsible panel when pointer hover-intent is detected near it. */
  | "panel-open-on-hover-intent"
  /** Widen the interactive hit area of an element. */
  | "increase-hit-target"
  /** Make a control more visually prominent (affordance). */
  | "strengthen-affordance"
  /** Show explicit feedback after an action so clicks never feel dead. */
  | "add-action-feedback"
  /** Surface a hint for a feature the user keeps missing. */
  | "show-contextual-hint";

export interface Adaptation {
  readonly id: string;
  readonly kind: AdaptationKind;
  /** Dotted feature key this change applies to. */
  readonly feature: string;
  readonly params: Readonly<Record<string, string | number | boolean>>;
  /** One-line human-readable description shown in reports/UI. */
  readonly description: string;
}

/** Host-app callback that applies an adaptation and reports success. */
export type Applier = (adaptation: Adaptation) => Promise<boolean>;

/**
 * Builds the canonical adaptation for a (kind, feature) pair. Stable ids make
 * deduplication trivial: the same fix is never applied twice.
 */
export function buildAdaptation(kind: AdaptationKind, feature: string): Adaptation {
  const slug = feature.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  switch (kind) {
    case "panel-open-on-hover-intent":
      return {
        id: `${kind}:${feature}`,
        kind,
        feature,
        params: { hoverDelayMs: 120, tolerancePx: 24 },
        description: `Open "${feature}" automatically on quick hover approach instead of requiring a click.`,
      };
    case "increase-hit-target":
      return {
        id: `${kind}:${feature}`,
        kind,
        feature,
        params: { minSizePx: 44 },
        description: `Enlarge the clickable area of "${feature}" so fast clicks land.`,
      };
    case "strengthen-affordance":
      return {
        id: `${kind}:${feature}`,
        kind,
        feature,
        params: {},
        description: `Make "${feature}" look interactive (stronger affordance styling).`,
      };
    case "add-action-feedback":
      return {
        id: `${kind}:${feature}`,
        kind,
        feature,
        params: { feedbackWindowMs: 250 },
        description: `Give immediate visual feedback when "${feature}" is activated.`,
      };
    case "show-contextual-hint":
      return {
        id: `${kind}:${feature}`,
        kind,
        feature,
        params: { maxShows: 2 },
        description: `Show a one-time hint revealing how to use "${feature}".`,
      };
  }
}

/** Kinds of adaptation each frustration signal tends to justify (ordered by preference). */
export const SIGNAL_TO_ADAPTATION: Record<string, AdaptationKind[]> = {
  "ghost-gesture": ["panel-open-on-hover-intent", "strengthen-affordance", "show-contextual-hint"],
  "rage-click": ["increase-hit-target", "add-action-feedback", "strengthen-affordance"],
  "dead-click": ["add-action-feedback", "increase-hit-target"],
  "error-click": ["add-action-feedback"],
  "mouse-thrash": ["show-contextual-hint"],
  "excessive-scroll": [],
  "prompt-retry": [],
};
