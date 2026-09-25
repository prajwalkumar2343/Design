/**
 * Versioned wire contracts for the sandboxed iframe bridge.
 *
 * This module intentionally contains no DOM or transport code. Both sides of
 * the postMessage boundary validate the envelope before using any payload.
 */

export const BRIDGE_PROTOCOL = "design-tool/iframe-bridge" as const;
export const BRIDGE_PROTOCOL_VERSION = 1 as const;
export const SANDBOXED_IFRAME_ORIGIN = "null" as const;

/**
 * Element ids are frame-scoped (`frm~<frameId>~<data:|id:|path:…>`) so the
 * flat node map can hold structurally identical elements from different
 * frame documents without colliding — every document used to mint the same
 * `path:html[1]` ids and corrupt the shared graph.
 */
export const MAX_ELEMENT_ID_LENGTH = 1536;

export function bridgeElementScope(frameId: string): string {
  return `frm~${frameId}~`;
}

export function scopedBridgeElementId(frameId: string, rawId: string): string {
  return bridgeElementScope(frameId) + rawId;
}

/** The document-local form of an element id, or the id itself when unscoped. */
export function unscopeBridgeElementId(frameId: string, elementId: string): string {
  const scope = bridgeElementScope(frameId);
  return elementId.startsWith(scope) ? elementId.slice(scope.length) : elementId;
}

/**
 * True when the element id derives from `data-design-element-id` — the marker
 * of an editor-created element — whether or not it carries a frame scope.
 */
export function isDataBridgeElementId(elementId: string): boolean {
  return elementId.startsWith("data:") || /^frm~.+~data:/.test(elementId);
}

export type BridgeVersion = typeof BRIDGE_PROTOCOL_VERSION;

export interface BridgePoint {
  x: number;
  y: number;
}

export interface BridgeRect extends BridgePoint {
  width: number;
  height: number;
}

export interface BridgeElementTarget {
  elementId: string;
  tagName: string;
  path: string;
  name: string;
  role: string | null;
  bounds: BridgeRect;
  locked?: boolean;
}

export interface BridgeHierarchyNode extends BridgeElementTarget {
  parentId: string | null;
  childIds: string[];
}

export interface BridgeHierarchySnapshot {
  rootIds: string[];
  nodes: BridgeHierarchyNode[];
  truncated: boolean;
}

export interface BridgeInspection {
  target: BridgeElementTarget;
  text: string;
  attributes: Record<string, string>;
  inlineStyle: Record<string, string>;
  computedStyle: Record<string, string>;
}

export type BridgeEventName =
  | "hover"
  | "select"
  | "pointerdown"
  | "pointermove"
  | "pointerup"
  | "keydown"
  | "input"
  | "text-edit-start"
  | "text-commit"
  | "text-cancel";
export type BridgeRequestCommand = "snapshot" | "inspect";

export type SafeInlineStyleProperty =
  | "align-items"
  | "aspect-ratio"
  | "backdrop-filter"
  | "background"
  | "background-color"
  | "border-color"
  | "border-radius"
  | "border-width"
  | "box-shadow"
  | "box-sizing"
  | "color"
  | "display"
  | "flex-direction"
  | "font-family"
  | "font-size"
  | "font-weight"
  | "gap"
  | "height"
  | "justify-content"
  | "letter-spacing"
  | "line-height"
  | "margin"
  | "margin-bottom"
  | "margin-left"
  | "margin-right"
  | "margin-top"
  | "max-height"
  | "max-width"
  | "min-height"
  | "min-width"
  | "opacity"
  | "overflow"
  | "padding"
  | "padding-bottom"
  | "padding-left"
  | "padding-right"
  | "padding-top"
  | "text-align"
  | "text-transform"
  | "transform"
  | "white-space"
  | "width";

export type BridgeCommand =
  | {
      command: "set-inline-style";
      targetId: string;
      property: SafeInlineStyleProperty;
      value: string | null;
    }
  | {
      command: "set-text";
      targetId: string;
      text: string;
    }
  | {
      command: "start-text-edit" | "cancel-text-edit";
      targetId: string;
    }
  | {
      command: "commit-text-edit";
      targetId: string;
      text: string;
    }
  | {
      command: "create-element";
      elementId: string;
      kind: BridgeCreationKind;
      bounds: BridgeRect;
      parentId?: string | null;
      text?: string;
      alt?: string;
      src?: string;
      points?: BridgePoint[];
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
      radius?: number;
      editable?: boolean;
      style?: Record<string, string>;
    }
  | {
      command: "delete-element";
      targetId: string;
    }
  | {
      command: "restore-element";
      snapshot: BridgeRestoreSnapshot;
    }
  | {
      command: "duplicate-element";
      targetId: string;
      elementId: string;
    }
  | {
      command: "set-shape-radius";
      targetId: string;
      radius: number;
    }
  | {
      command: "set-shape-fill";
      targetId: string;
      /** Concrete CSS color, or null to restore the pre-editor fill. */
      color: string | null;
    }
  | {
      command: "set-shape-glass";
      targetId: string;
      /** Glass intensity 0–100, or null to remove the effect. */
      level: number | null;
    }
  | {
      command: "pick-element";
      point: BridgePoint;
      shiftKey: boolean;
    }
  | {
      command: "inject-font-faces";
      /** @font-face rules carrying data-URI woff2 payloads for bundled fonts. */
      css: string;
    }
  | {
      command: "set-token-theme";
      /** `:root` custom-property block for the active token theme. */
      css: string;
    };

export type BridgeCreationKind =
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "polygon"
  | "star"
  | "text"
  | "image"
  | "path";

export interface BridgeCreatedElementSnapshot {
  elementId: string;
  /**
   * The raw `data-design-element-id` attribute the element carries. Restore
   * must write this verbatim — re-embedding the derived `elementId` double-
   * prefixes the attribute and the restored element mints a new identity
   * every undo/redo cycle.
   */
  attrId?: string;
  kind: BridgeCreationKind;
  bounds: BridgeRect;
  text: string;
  alt: string;
  src: string;
  points: BridgePoint[];
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  editable: boolean;
  /** Glass intensity 0–100 carried through duplicate/restore; legacy snapshots omit it. */
  glass?: number | null;
  style: Record<string, string>;
}

/** Verbatim-outerHTML snapshot used to undo deleting document markup. */
export interface BridgeMarkupSnapshot {
  markup: string;
  parentId: string | null;
  index: number;
}

export type BridgeRestoreSnapshot = BridgeCreatedElementSnapshot | BridgeMarkupSnapshot;

export type BridgeUndoCommand =
  | {
      command: "set-inline-style";
      targetId: string;
      property: SafeInlineStyleProperty;
      value: string | null;
    }
  | {
      command: "set-text";
      targetId: string;
      text: string;
    }
  | {
      command: "delete-element";
      targetId: string;
    }
  | {
      command: "restore-element";
      snapshot: BridgeRestoreSnapshot;
    }
  | {
      command: "set-shape-radius";
      targetId: string;
      radius: number;
    }
  | {
      command: "set-shape-fill";
      targetId: string;
      color: string | null;
    }
  | {
      command: "set-shape-glass";
      targetId: string;
      level: number | null;
    };

export type BridgeCommandAck =
  | {
      kind: "command";
      command: "set-inline-style";
      targetId: string;
      property: SafeInlineStyleProperty;
      previousValue: string | null;
      value: string | null;
      /**
       * Live element rect (frame-document coordinates) read after the edit.
       * Layout may land the element somewhere other than the bounds the
       * editor predicted — flex/grid alignment, min/max clamps, intrinsic
       * sizing — so gesture overlays glue to this rect, not the prediction.
       */
      bounds?: BridgeRect;
      undo: BridgeUndoCommand;
    }
  | {
      kind: "command";
      command: "set-text";
      targetId: string;
      previousText: string;
      text: string;
      undo: BridgeUndoCommand;
    }
  | {
      kind: "command";
      command: "start-text-edit" | "cancel-text-edit";
      targetId: string;
    }
  | {
      kind: "command";
      command: "create-element" | "duplicate-element" | "restore-element";
      targetId: string;
      target: BridgeElementTarget;
      undo: BridgeUndoCommand;
      replay: BridgeCommand;
    }
  | {
      kind: "command";
      command: "delete-element";
      targetId: string;
      undo: BridgeUndoCommand;
      replay: BridgeCommand;
    }
  | {
      kind: "command";
      command: "set-shape-radius";
      targetId: string;
      previousRadius: number;
      radius: number;
      undo: BridgeUndoCommand;
    }
  | {
      kind: "command";
      command: "set-shape-fill";
      targetId: string;
      previousColor: string | null;
      color: string | null;
      undo: BridgeUndoCommand;
    }
  | {
      kind: "command";
      command: "set-shape-glass";
      targetId: string;
      previousLevel: number | null;
      level: number | null;
      undo: BridgeUndoCommand;
    }
  | {
      kind: "command";
      command: "pick-element";
    }
  | {
      kind: "command";
      command: "inject-font-faces";
      /** Sentinel id — the command targets the document, not an element. */
      targetId: string;
      /** False when the exact payload was already present. */
      injected: boolean;
    }
  | {
      kind: "command";
      command: "set-token-theme";
      /** Sentinel id — the command targets the document, not an element. */
      targetId: string;
      /** False when the theme block was cleared rather than written. */
      applied: boolean;
    };

export type BridgeResponseResult =
  | { kind: "snapshot"; snapshot: BridgeHierarchySnapshot }
  | { kind: "inspection"; inspection: BridgeInspection | null }
  | { kind: "command"; ack: BridgeCommandAck };

interface BridgeEnvelopeBase {
  protocol: typeof BRIDGE_PROTOCOL;
  version: BridgeVersion;
  channel: string;
  frameId: string;
}

export type BridgeHandshakeMessage = BridgeEnvelopeBase & {
  type: "handshake";
};

export type BridgeRequestMessage = BridgeEnvelopeBase & {
  type: "request";
  requestId: string;
  command: BridgeRequestCommand;
  targetId?: string;
};

export type BridgeCommandMessage = BridgeEnvelopeBase & {
  type: "command";
  requestId: string;
  command: BridgeCommand;
};

export type BridgeParentMessage =
  | BridgeHandshakeMessage
  | BridgeRequestMessage
  | BridgeCommandMessage;

export type BridgeReadyMessage = BridgeEnvelopeBase & {
  type: "ready";
  capabilities: readonly string[];
};

export type BridgeEventMessage = BridgeEnvelopeBase & {
  type: "event";
  event: BridgeEventName;
  target: BridgeElementTarget | null;
  point: BridgePoint;
  key?: string;
  text?: string;
  buttons?: number;
  pointerId?: number;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
};

export interface BridgeError {
  code: string;
  message: string;
}

export type BridgeResponseMessage =
  | (BridgeEnvelopeBase & {
      type: "response";
      requestId: string;
      ok: true;
      result: BridgeResponseResult;
    })
  | (BridgeEnvelopeBase & {
      type: "response";
      requestId: string;
      ok: false;
      error: BridgeError;
    });

export type BridgeChildMessage =
  | BridgeReadyMessage
  | BridgeEventMessage
  | BridgeResponseMessage;

export type BridgeMessage = BridgeParentMessage | BridgeChildMessage;

export interface BridgeSessionIdentity {
  channel: string;
  frameId: string;
}

const SAFE_INLINE_STYLE_PROPERTIES: readonly SafeInlineStyleProperty[] = [
  "align-items",
  "aspect-ratio",
  "backdrop-filter",
  "background",
  "background-color",
  "border-color",
  "border-radius",
  "border-width",
  "box-shadow",
  "box-sizing",
  "color",
  "display",
  "flex-direction",
  "font-family",
  "font-size",
  "font-weight",
  "gap",
  "height",
  "justify-content",
  "letter-spacing",
  "line-height",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "opacity",
  "overflow",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "text-align",
  "text-transform",
  "transform",
  "white-space",
  "width",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidString(
  value: unknown,
  options: { maxLength: number; allowEmpty?: boolean; allowTextWhitespace?: boolean },
): value is string {
  return (
    typeof value === "string" &&
    value.length <= options.maxLength &&
    (options.allowEmpty || value.length > 0) &&
    !(options.allowTextWhitespace
      // Text payloads legitimately carry \n \t \r — everything else in the
      // C0/DEL range stays rejected.
      ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
      : /[\u0000-\u001f\u007f]/.test(value))
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeDataImage(value: unknown): value is string {
  return isValidString(value, { maxLength: 16_000_000, allowEmpty: false }) &&
    /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(value);
}

function isPoint(value: unknown): value is BridgePoint {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isRect(value: unknown): value is BridgeRect {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    value.width >= 0 &&
    value.height >= 0
  );
}

function isElementTarget(value: unknown): value is BridgeElementTarget {
  return (
    isRecord(value) &&
    isValidString(value.elementId, { maxLength: MAX_ELEMENT_ID_LENGTH }) &&
    isValidString(value.tagName, { maxLength: 64 }) &&
    isValidString(value.path, { maxLength: 2048 }) &&
    isValidString(value.name, { maxLength: 512, allowEmpty: true, allowTextWhitespace: true }) &&
    (value.role === null || isValidString(value.role, { maxLength: 256, allowEmpty: true })) &&
    isRect(value.bounds) &&
    (value.locked === undefined || typeof value.locked === "boolean")
  );
}

function isStringRecord(value: unknown, maxValueLength: number): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        isValidString(key, { maxLength: 256 }) &&
        // Attribute/style values are user text — aria-label, inline styles,
        // computed values all legitimately carry newlines and tabs.
        isValidString(item, { maxLength: maxValueLength, allowEmpty: true, allowTextWhitespace: true }),
    )
  );
}

function isSafeInlineStyleProperty(value: unknown): value is SafeInlineStyleProperty {
  return typeof value === "string" && SAFE_INLINE_STYLE_PROPERTIES.includes(value as SafeInlineStyleProperty);
}

function isCreationKind(value: unknown): value is BridgeCreationKind {
  return typeof value === "string" && [
    "rectangle", "ellipse", "line", "arrow", "polygon", "star", "text", "image", "path",
  ].includes(value);
}

function isShapeRadius(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 360;
}

/**
 * Concrete paint colors plus `var(--token)` links — the runtime deliberately
 * supports token-linked fills. Gradients, urls, and statements stay out.
 */
const CSS_VAR_COLOR_PATTERN = /^var\(\s*--[A-Za-z0-9_-]+\s*(?:,[^()]{1,128})?\)$/;

function isShapeColor(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128 || /[\u0000-\u001f\u007f<>"']/.test(trimmed)) {
    return false;
  }
  return (
    /^#[0-9a-f]{3,8}$/i.test(trimmed) ||
    /^rgba?\(\s*[\d.\s,%/]+\)$/i.test(trimmed) ||
    /^hsla?\(\s*[\d.\s,%/]+\)$/i.test(trimmed) ||
    CSS_VAR_COLOR_PATTERN.test(trimmed) ||
    trimmed.toLowerCase() === "transparent" ||
    // Named CSS colors (red, rebeccapurple, currentcolor…).
    /^[a-z]{2,24}$/i.test(trimmed)
  );
}

function isCreatedElementSnapshot(value: unknown): value is BridgeCreatedElementSnapshot {
  return isRecord(value) &&
    isValidString(value.elementId, { maxLength: MAX_ELEMENT_ID_LENGTH }) &&
    (value.attrId === undefined || isValidString(value.attrId, { maxLength: 512, allowEmpty: true })) &&
    isCreationKind(value.kind) &&
    isRect(value.bounds) &&
    isValidString(value.text, { maxLength: 20000, allowEmpty: true, allowTextWhitespace: true }) &&
    isValidString(value.alt, { maxLength: 4096, allowEmpty: true, allowTextWhitespace: true }) &&
    (value.kind === "image" ? isSafeDataImage(value.src) : value.src === "") &&
    Array.isArray(value.points) && value.points.length <= 256 && value.points.every(isPoint) &&
    isValidString(value.fill, { maxLength: 4096, allowEmpty: true }) &&
    isValidString(value.stroke, { maxLength: 4096, allowEmpty: true }) &&
    isFiniteNumber(value.strokeWidth) && value.strokeWidth >= 0 && value.strokeWidth <= 100 &&
    isShapeRadius(value.radius) &&
    typeof value.editable === "boolean" &&
    (value.glass === undefined || value.glass === null || (isFiniteNumber(value.glass) && value.glass >= 0 && value.glass <= 100)) &&
    isStringRecord(value.style, 4096);
}

/** outerHTML snapshots from document-markup deletes — formatting newlines are legitimate. */
function isMarkupSnapshot(value: unknown): value is BridgeMarkupSnapshot {
  return isRecord(value) &&
    isValidString(value.markup, { maxLength: 2_000_000, allowTextWhitespace: true }) &&
    (value.parentId === null || isValidString(value.parentId, { maxLength: MAX_ELEMENT_ID_LENGTH })) &&
    isFiniteNumber(value.index) && value.index >= 0;
}

function isBridgeCommand(value: unknown): value is BridgeCommand {
  if (!isRecord(value) || typeof value.command !== "string") return false;
  if (value.command === "set-inline-style") {
    return (
      isValidString(value.targetId, { maxLength: MAX_ELEMENT_ID_LENGTH }) &&
      isSafeInlineStyleProperty(value.property) &&
      (value.value === null || isValidString(value.value, { maxLength: 4096, allowEmpty: true, allowTextWhitespace: true }))
    );
  }
  if (value.command === "set-text") {
    return isValidString(value.targetId, { maxLength: MAX_ELEMENT_ID_LENGTH }) &&
      isValidString(value.text, { maxLength: 20000, allowEmpty: true, allowTextWhitespace: true });
  }
  if (value.command === "start-text-edit" || value.command === "cancel-text-edit") {
    return isValidString(value.targetId, { maxLength: MAX_ELEMENT_ID_LENGTH });
  }
  if (value.command === "commit-text-edit") {
    return isValidString(value.targetId, { maxLength: MAX_ELEMENT_ID_LENGTH }) &&
      isValidString(value.text, { maxLength: 20000, allowEmpty: true, allowTextWhitespace: true });
  }
  if (value.command === "delete-element") {
    return isValidString(value.targetId, { maxLength: MAX_ELEMENT_ID_LENGTH });
  }
  if (value.command === "restore-element") {
    return isCreatedElementSnapshot(value.snapshot) || isMarkupSnapshot(value.snapshot);
  }
  if (value.command === "duplicate-element") {
    return isValidString(value.targetId, { maxLength: MAX_ELEMENT_ID_LENGTH }) &&
      isValidString(value.elementId, { maxLength: 512 });
  }
  if (value.command === "set-shape-radius") {
    return isValidString(value.targetId, { maxLength: MAX_ELEMENT_ID_LENGTH }) && isShapeRadius(value.radius);
  }
  if (value.command === "set-shape-fill") {
    return isValidString(value.targetId, { maxLength: MAX_ELEMENT_ID_LENGTH }) &&
      (value.color === null || isShapeColor(value.color));
  }
  if (value.command === "set-shape-glass") {
    return isValidString(value.targetId, { maxLength: MAX_ELEMENT_ID_LENGTH }) &&
      (value.level === null || (isFiniteNumber(value.level) && value.level >= 0 && value.level <= 100));
  }
  if (value.command === "pick-element") {
    return isPoint(value.point) && typeof value.shiftKey === "boolean";
  }
  if (value.command === "inject-font-faces") {
    return isValidString(value.css, { maxLength: 4_000_000, allowTextWhitespace: true });
  }
  if (value.command === "set-token-theme") {
    return typeof value.css === "string" && value.css.length <= 262_144;
  }
  if (value.command === "create-element") {
    return isValidString(value.elementId, { maxLength: 512 }) &&
      isCreationKind(value.kind) &&
      isRect(value.bounds) &&
      (value.parentId === undefined || value.parentId === null || isValidString(value.parentId, { maxLength: MAX_ELEMENT_ID_LENGTH })) &&
      (value.text === undefined || isValidString(value.text, { maxLength: 20000, allowEmpty: true, allowTextWhitespace: true })) &&
      (value.alt === undefined || isValidString(value.alt, { maxLength: 4096, allowEmpty: true, allowTextWhitespace: true })) &&
      (value.src === undefined || (value.kind === "image" ? isSafeDataImage(value.src) : value.src === "")) &&
      (value.points === undefined || (Array.isArray(value.points) && value.points.length <= 256 && value.points.every(isPoint))) &&
      (value.fill === undefined || isValidString(value.fill, { maxLength: 4096, allowEmpty: true })) &&
      (value.stroke === undefined || isValidString(value.stroke, { maxLength: 4096, allowEmpty: true })) &&
      (value.strokeWidth === undefined || (isFiniteNumber(value.strokeWidth) && value.strokeWidth >= 0 && value.strokeWidth <= 100)) &&
      (value.radius === undefined || isShapeRadius(value.radius)) &&
      (value.editable === undefined || typeof value.editable === "boolean") &&
      (value.style === undefined || isStringRecord(value.style, 4096));
  }
  return false;
}

function isHierarchyNode(value: unknown): value is BridgeHierarchyNode {
  const record = isRecord(value) ? value : null;
  return (
    isElementTarget(value) &&
    record !== null &&
    (record.parentId === null || isValidString(record.parentId, { maxLength: MAX_ELEMENT_ID_LENGTH })) &&
    Array.isArray(record.childIds) &&
    record.childIds.every((id) => isValidString(id, { maxLength: MAX_ELEMENT_ID_LENGTH }))
  );
}

function isHierarchySnapshot(value: unknown): value is BridgeHierarchySnapshot {
  return (
    isRecord(value) &&
    Array.isArray(value.rootIds) &&
    value.rootIds.every((id) => isValidString(id, { maxLength: MAX_ELEMENT_ID_LENGTH })) &&
    Array.isArray(value.nodes) &&
    value.nodes.length <= 5000 &&
    value.nodes.every(isHierarchyNode) &&
    typeof value.truncated === "boolean"
  );
}

function isInspection(value: unknown): value is BridgeInspection {
  return (
    isRecord(value) &&
    isElementTarget(value.target) &&
    isValidString(value.text, { maxLength: 20000, allowEmpty: true, allowTextWhitespace: true }) &&
    isStringRecord(value.attributes, 4096) &&
    isStringRecord(value.inlineStyle, 4096) &&
    isStringRecord(value.computedStyle, 4096)
  );
}

function isCommandAck(value: unknown): value is BridgeCommandAck {
  if (!isRecord(value) || value.kind !== "command" || !isValidString(value.targetId, { maxLength: MAX_ELEMENT_ID_LENGTH })) {
    return false;
  }
  if (value.command === "set-inline-style") {
    return (
      isSafeInlineStyleProperty(value.property) &&
      (value.previousValue === null || isValidString(value.previousValue, { maxLength: 4096, allowEmpty: true, allowTextWhitespace: true })) &&
      (value.value === null || isValidString(value.value, { maxLength: 4096, allowEmpty: true, allowTextWhitespace: true })) &&
      (value.bounds === undefined || isRect(value.bounds)) &&
      isRecord(value.undo) &&
      isBridgeCommand(value.undo) &&
      value.undo.command === "set-inline-style"
    );
  }
  if (value.command === "set-text") return (
    isValidString(value.previousText, { maxLength: 20000, allowEmpty: true, allowTextWhitespace: true }) &&
    isValidString(value.text, { maxLength: 20000, allowEmpty: true, allowTextWhitespace: true }) &&
    isRecord(value.undo) &&
    isBridgeCommand(value.undo) &&
      value.undo.command === "set-text"
  );
  if (value.command === "start-text-edit" || value.command === "cancel-text-edit") return true;
  if (value.command === "delete-element") {
    return isBridgeCommand(value.undo) && value.undo.command === "restore-element" &&
      isBridgeCommand(value.replay) && value.replay.command === "delete-element";
  }
  if (value.command === "create-element" || value.command === "duplicate-element" || value.command === "restore-element") {
    return isElementTarget(value.target) &&
      isBridgeCommand(value.undo) && value.undo.command === "delete-element" &&
      isBridgeCommand(value.replay) && value.replay.command === "create-element";
  }
  if (value.command === "set-shape-radius") {
    return isShapeRadius(value.previousRadius) &&
      isShapeRadius(value.radius) &&
      isRecord(value.undo) &&
      isBridgeCommand(value.undo) &&
      value.undo.command === "set-shape-radius";
  }
  if (value.command === "set-shape-fill") {
    return (value.previousColor === null || isShapeColor(value.previousColor)) &&
      (value.color === null || isShapeColor(value.color)) &&
      isRecord(value.undo) &&
      isBridgeCommand(value.undo) &&
      value.undo.command === "set-shape-fill";
  }
  if (value.command === "set-shape-glass") {
    return (value.previousLevel === null || (isFiniteNumber(value.previousLevel) && value.previousLevel >= 0 && value.previousLevel <= 100)) &&
      (value.level === null || (isFiniteNumber(value.level) && value.level >= 0 && value.level <= 100)) &&
      isRecord(value.undo) &&
      isBridgeCommand(value.undo) &&
      value.undo.command === "set-shape-glass";
  }
  if (value.command === "pick-element") return true;
  if (value.command === "inject-font-faces") return typeof value.injected === "boolean";
  if (value.command === "set-token-theme") return typeof value.applied === "boolean";
  return false;
}

function isEnvelopeBase(value: unknown): value is BridgeEnvelopeBase {
  return (
    isRecord(value) &&
    value.protocol === BRIDGE_PROTOCOL &&
    value.version === BRIDGE_PROTOCOL_VERSION &&
    isValidString(value.channel, { maxLength: 256 }) &&
    isValidString(value.frameId, { maxLength: 256 })
  );
}

function isResponseResult(value: unknown): value is BridgeResponseResult {
  if (!isRecord(value) || !isValidString(value.kind, { maxLength: 32 })) {
    return false;
  }
  if (value.kind === "snapshot") {
    return isHierarchySnapshot(value.snapshot);
  }
  if (value.kind === "inspection") {
    return value.inspection === null || isInspection(value.inspection);
  }
  return value.kind === "command" && isCommandAck(value.ack);
}

export function isSafeInlineStylePropertyName(value: string): value is SafeInlineStyleProperty {
  return isSafeInlineStyleProperty(value);
}

export function parseBridgeMessage(value: unknown): BridgeMessage | null {
  const record = isRecord(value) ? value : null;
  if (!isEnvelopeBase(value) || record === null || typeof record.type !== "string") {
    return null;
  }

  switch (record.type) {
    case "handshake":
      return value as BridgeHandshakeMessage;
    case "ready":
      return Array.isArray(record.capabilities) &&
        record.capabilities.every((capability) => isValidString(capability, { maxLength: 128 }))
        ? (value as BridgeReadyMessage)
        : null;
    case "event":
      return (
        ["hover", "select", "pointerdown", "pointermove", "pointerup", "keydown", "input", "text-edit-start", "text-commit", "text-cancel"].includes(record.event as string) &&
        (record.target === null || isElementTarget(record.target)) &&
        isPoint(record.point) &&
        (record.key === undefined || isValidString(record.key, { maxLength: 64, allowEmpty: true })) &&
        (record.text === undefined || isValidString(record.text, { maxLength: 20000, allowEmpty: true, allowTextWhitespace: true })) &&
        (record.buttons === undefined || (typeof record.buttons === "number" && Number.isInteger(record.buttons) && record.buttons >= 0 && record.buttons <= 31)) &&
        (record.pointerId === undefined || (typeof record.pointerId === "number" && Number.isInteger(record.pointerId) && record.pointerId >= 0)) &&
        (record.shiftKey === undefined || typeof record.shiftKey === "boolean") &&
        (record.altKey === undefined || typeof record.altKey === "boolean") &&
        (record.metaKey === undefined || typeof record.metaKey === "boolean") &&
        (record.ctrlKey === undefined || typeof record.ctrlKey === "boolean")
      )
        ? (value as BridgeEventMessage)
        : null;
    case "request":
      return (
        isValidString(record.requestId, { maxLength: 256 }) &&
        (record.command === "snapshot" || record.command === "inspect") &&
        (record.targetId === undefined || isValidString(record.targetId, { maxLength: MAX_ELEMENT_ID_LENGTH }))
      )
        ? (value as BridgeRequestMessage)
        : null;
    case "command":
      return isValidString(record.requestId, { maxLength: 256 }) && isBridgeCommand(record.command)
        ? (value as BridgeCommandMessage)
        : null;
    case "response":
      if (!isValidString(record.requestId, { maxLength: 256 }) || typeof record.ok !== "boolean") {
        return null;
      }
      if (record.ok) {
        return isResponseResult(record.result) ? (value as BridgeResponseMessage) : null;
      }
      return isRecord(record.error) &&
        isValidString(record.error.code, { maxLength: 128 }) &&
        isValidString(record.error.message, { maxLength: 2048 })
        ? (value as BridgeResponseMessage)
        : null;
    default:
      return null;
  }
}

export function validateBridgeMessage(
  value: unknown,
  identity: BridgeSessionIdentity,
): BridgeMessage | null {
  const message = parseBridgeMessage(value);
  if (!message || message.channel !== identity.channel || message.frameId !== identity.frameId) {
    return null;
  }
  return message;
}

export function createBridgeHandshake(identity: BridgeSessionIdentity): BridgeHandshakeMessage {
  return { protocol: BRIDGE_PROTOCOL, version: BRIDGE_PROTOCOL_VERSION, ...identity, type: "handshake" };
}

export function createBridgeRequest(
  identity: BridgeSessionIdentity,
  requestId: string,
  command: BridgeRequestCommand,
  targetId?: string,
): BridgeRequestMessage {
  return {
    protocol: BRIDGE_PROTOCOL,
    version: BRIDGE_PROTOCOL_VERSION,
    ...identity,
    type: "request",
    requestId,
    command,
    ...(targetId === undefined ? {} : { targetId }),
  };
}

export function createBridgeCommand(
  identity: BridgeSessionIdentity,
  requestId: string,
  command: BridgeCommand,
): BridgeCommandMessage {
  return {
    protocol: BRIDGE_PROTOCOL,
    version: BRIDGE_PROTOCOL_VERSION,
    ...identity,
    type: "command",
    requestId,
    command,
  };
}
