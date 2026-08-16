import { BRIDGE_PROTOCOL, BRIDGE_PROTOCOL_VERSION, type BridgeSessionIdentity } from "./protocol";

export const BRIDGE_RUNTIME_MARKER = "data-design-tool-iframe-bridge";

export interface BridgeRuntimeConfig extends BridgeSessionIdentity {
  parentOrigin: string;
}

const SAFE_STYLE_PROPERTIES = [
  "align-items",
  "aspect-ratio",
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
] as const;

function escapeScriptJson(value: string): string {
  return value
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function serializeRuntimeConfig(config: BridgeRuntimeConfig): string {
  return escapeScriptJson(JSON.stringify(config));
}

/**
 * Returns a self-contained runtime. It deliberately has no imports, fetches,
 * storage access, or same-origin assumptions because it executes in an opaque
 * `sandbox="allow-scripts"` document.
 */
export function createBridgeRuntimeSource(config: BridgeRuntimeConfig): string {
  const serializedConfig = serializeRuntimeConfig(config);
  const serializedSafeProperties = JSON.stringify(SAFE_STYLE_PROPERTIES);

  return `
(() => {
  "use strict";
  const CONFIG = ${serializedConfig};
  const PROTOCOL = ${JSON.stringify(BRIDGE_PROTOCOL)};
  const VERSION = ${BRIDGE_PROTOCOL_VERSION};
  const SAFE_STYLE_PROPERTIES = new Set(${serializedSafeProperties});
  const MAX_NODES = 2000;
  const MAX_DEPTH = 64;
  const MAX_TEXT_LENGTH = 20000;
  const MAX_ATTRIBUTE_LENGTH = 4096;
  let lastHoveredElementId = null;
  let lastSelectedElement = null;
  let activeTextEdit = null;
  let pendingPointerMove = null;
  let pendingPointerMoveFrame = null;

  const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  const isSafeString = (value, maxLength, allowEmpty = false) =>
    typeof value === "string" && value.length <= maxLength && (allowEmpty || value.length > 0) && !/[\\u0000-\\u001f\\u007f]/.test(value);
  const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
  const isPoint = (value) => isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
  const isEnvelope = (value) =>
    isRecord(value) &&
    value.protocol === PROTOCOL &&
    value.version === VERSION &&
    value.channel === CONFIG.channel &&
    value.frameId === CONFIG.frameId;

  function post(message) {
    window.parent.postMessage({
      protocol: PROTOCOL,
      version: VERSION,
      channel: CONFIG.channel,
      frameId: CONFIG.frameId,
      ...message,
    }, "*");
  }

  function sendResponse(requestId, response) {
    post({ type: "response", requestId, ...response });
  }

  function sendError(requestId, code, message) {
    sendResponse(requestId, { ok: false, error: { code, message } });
  }

  function sendReady() {
    post({
      type: "ready",
      capabilities: [
        "hover", "select", "pointer-events", "snapshot", "inspect", "set-inline-style", "set-text",
        "create-element", "delete-element", "duplicate-element",
      ],
    });
  }

  function encodeId(value) {
    return encodeURIComponent(value);
  }

  function elementPath(element) {
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(current.tagName.toLowerCase() + "[" + index + "]");
      current = current.parentElement;
    }
    return parts.join("/");
  }

  function elementId(element) {
    const stableAttribute = element.getAttribute("data-design-element-id");
    if (stableAttribute && isSafeString(stableAttribute, 256)) {
      return "data:" + encodeId(stableAttribute);
    }
    if (element.id && document.getElementById(element.id) === element) {
      return "id:" + encodeId(element.id);
    }
    return "path:" + elementPath(element);
  }

  function localBounds(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: Number.isFinite(rect.x) ? rect.x : 0,
      y: Number.isFinite(rect.y) ? rect.y : 0,
      width: Number.isFinite(rect.width) && rect.width >= 0 ? rect.width : 0,
      height: Number.isFinite(rect.height) && rect.height >= 0 ? rect.height : 0,
    };
  }

  function textPreview(element) {
    return (element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 512);
  }

  function describe(element) {
    if (!(element instanceof Element)) return null;
    const role = element.getAttribute("role");
    const ariaLabel = element.getAttribute("aria-label");
    const name = ariaLabel || element.getAttribute("name") || textPreview(element) || element.tagName.toLowerCase();
    return {
      elementId: elementId(element),
      tagName: element.tagName.toLowerCase(),
      path: elementPath(element),
      name,
      role,
      bounds: localBounds(element),
      locked: element.getAttribute("data-design-locked") === "true",
    };
  }

  function findElement(targetId) {
    if (!isSafeString(targetId, 512)) return null;
    const elements = document.querySelectorAll("*");
    for (const element of elements) {
      if (elementId(element) === targetId) return element;
    }
    return null;
  }

  function safeColor(value, fallback) {
    if (!isSafeString(value, 4096, true) || /[;]|url\\s*\\(|expression\\s*\\(|javascript\\s*:|@import|-moz-binding/i.test(value)) return fallback;
    if (window.CSS && typeof window.CSS.supports === "function" && value && !window.CSS.supports("color", value)) return fallback;
    return value || fallback;
  }

  function safeDataImage(value) {
    return isSafeString(value, 16000000, true) && /^data:image\\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(value);
  }

  function safeBounds(bounds) {
    return isRecord(bounds) && isFiniteNumber(bounds.x) && isFiniteNumber(bounds.y) &&
      isFiniteNumber(bounds.width) && isFiniteNumber(bounds.height) &&
      bounds.x >= 0 && bounds.y >= 0 && bounds.width >= 1 && bounds.height >= 1 &&
      bounds.x <= 100000 && bounds.y <= 100000 && bounds.width <= 100000 && bounds.height <= 100000;
  }

  function safePoints(points) {
    return Array.isArray(points) && points.length >= 2 && points.length <= 256 && points.every((point) =>
      isPoint(point) && point.x >= -100000 && point.x <= 100000 && point.y >= -100000 && point.y <= 100000);
  }

  function styleCreatedElement(element, bounds) {
    element.style.position = "fixed";
    element.style.left = bounds.x + "px";
    element.style.top = bounds.y + "px";
    element.style.width = bounds.width + "px";
    element.style.height = bounds.height + "px";
    element.style.boxSizing = "border-box";
    element.style.zIndex = "10";
  }

  function normalizePoints(points, bounds) {
    const source = points || [];
    return source.map((point) => ({
      x: point.x - bounds.x,
      y: point.y - bounds.y,
    }));
  }

  function svgPointString(points) {
    return points.map((point) => point.x + "," + point.y).join(" ");
  }

  function createSvgChild(svg, kind, points, fill, stroke, strokeWidth) {
    const ns = "http://www.w3.org/2000/svg";
    const normalized = points || [];
    let child;
    if (kind === "line" || kind === "arrow") {
      child = document.createElementNS(ns, "line");
      const first = normalized[0] || { x: 0, y: 0 };
      const last = normalized[normalized.length - 1] || first;
      child.setAttribute("x1", String(first.x));
      child.setAttribute("y1", String(first.y));
      child.setAttribute("x2", String(last.x));
      child.setAttribute("y2", String(last.y));
      if (kind === "arrow") {
        child.setAttribute("marker-end", "url(#design-tool-arrowhead)");
      }
    } else {
      child = document.createElementNS(ns, kind === "path" ? "polyline" : "polygon");
      child.setAttribute("points", svgPointString(normalized));
      if (kind === "path") child.setAttribute("fill", "none");
    }
    child.setAttribute("fill", fill || (kind === "path" || kind === "line" || kind === "arrow" ? "none" : "#d9d9d9"));
    child.setAttribute("stroke", stroke || "#222222");
    child.setAttribute("stroke-width", String(strokeWidth || 2));
    child.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(child);
  }

  function createElementFromSpec(spec) {
    if (!isRecord(spec) || !isSafeString(spec.elementId, 512) || !isSafeString(spec.kind, 32) ||
      !safeBounds(spec.bounds) || findElement(spec.elementId)) {
      throw { code: "invalid-create", message: "The requested element definition is invalid" };
    }
    const kind = spec.kind;
    const bounds = spec.bounds;
    const fill = safeColor(spec.fill, "#d9d9d9");
    const stroke = safeColor(spec.stroke, "#222222");
    const strokeWidth = isFiniteNumber(spec.strokeWidth) && spec.strokeWidth >= 0 && spec.strokeWidth <= 100 ? spec.strokeWidth : 2;
    const parent = spec.parentId ? findElement(spec.parentId) : document.body;
    if (!parent || !(parent instanceof Element)) throw { code: "parent-not-found", message: "The requested parent does not exist" };
    let element;
    if (kind === "rectangle" || kind === "ellipse") {
      element = document.createElement("div");
      element.style.background = fill;
      element.style.border = strokeWidth + "px solid " + stroke;
      if (kind === "ellipse") element.style.borderRadius = "999px";
      styleCreatedElement(element, bounds);
    } else if (kind === "text") {
      element = document.createElement("div");
      element.textContent = isSafeString(spec.text, MAX_TEXT_LENGTH, true) ? spec.text : "";
      element.style.color = safeColor(spec.fill, "#171717");
      element.style.fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif";
      element.style.fontSize = "16px";
      element.style.lineHeight = "1.35";
      element.style.whiteSpace = "pre-wrap";
      element.style.padding = "4px";
      styleCreatedElement(element, bounds);
      if (spec.editable !== false) {
        element.contentEditable = "true";
        element.setAttribute("spellcheck", "false");
      }
    } else if (kind === "image") {
      if (!safeDataImage(spec.src || "")) throw { code: "unsafe-image", message: "Images must be local data URLs" };
      element = document.createElement("img");
      element.src = spec.src;
      element.alt = isSafeString(spec.alt, 4096, true) ? spec.alt : "";
      element.style.objectFit = "cover";
      element.style.background = "transparent";
      styleCreatedElement(element, bounds);
    } else {
      if (!safePoints(spec.points)) throw { code: "invalid-path", message: "A vector shape needs at least two safe points" };
      element = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      element.setAttribute("viewBox", "0 0 " + bounds.width + " " + bounds.height);
      element.setAttribute("aria-label", kind);
      styleCreatedElement(element, bounds);
      element.style.overflow = "visible";
      if (kind === "arrow") {
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
        marker.setAttribute("id", "design-tool-arrowhead");
        marker.setAttribute("markerWidth", "8");
        marker.setAttribute("markerHeight", "8");
        marker.setAttribute("refX", "7");
        marker.setAttribute("refY", "4");
        marker.setAttribute("orient", "auto");
        const tip = document.createElementNS("http://www.w3.org/2000/svg", "path");
        tip.setAttribute("d", "M0,0 L8,4 L0,8 Z");
        tip.setAttribute("fill", stroke);
        marker.appendChild(tip);
        defs.appendChild(marker);
        element.appendChild(defs);
      }
      createSvgChild(element, kind, normalizePoints(spec.points, bounds), fill, stroke, strokeWidth);
    }
    element.setAttribute("data-design-element-id", spec.elementId);
    element.setAttribute("data-design-tool-created", "true");
    element.setAttribute("data-design-tool-kind", kind);
    element.setAttribute("data-design-tool-bounds", JSON.stringify(bounds));
    element.setAttribute("data-design-tool-points", JSON.stringify(spec.points || []));
    element.setAttribute("data-design-tool-fill", fill);
    element.setAttribute("data-design-tool-stroke", stroke);
    element.setAttribute("data-design-tool-stroke-width", String(strokeWidth));
    element.setAttribute("data-design-tool-editable", spec.editable === false ? "false" : "true");
    parent.appendChild(element);
    return element;
  }

  function createdSnapshot(element) {
    if (!(element instanceof Element) || element.getAttribute("data-design-tool-created") !== "true") return null;
    const boundsValue = element.getAttribute("data-design-tool-bounds");
    let bounds;
    try { bounds = JSON.parse(boundsValue || "null"); } catch { bounds = null; }
    if (!safeBounds(bounds)) return null;
    let points;
    try { points = JSON.parse(element.getAttribute("data-design-tool-points") || "[]"); } catch { points = []; }
    if (!Array.isArray(points) || !points.every(isPoint)) points = [];
    return {
      elementId: elementId(element),
      kind: element.getAttribute("data-design-tool-kind") || "rectangle",
      bounds,
      text: (element.textContent || "").slice(0, MAX_TEXT_LENGTH),
      alt: element instanceof HTMLImageElement ? (element.alt || "").slice(0, 4096) : "",
      src: element instanceof HTMLImageElement ? (element.getAttribute("src") || "").slice(0, 16000000) : "",
      points,
      fill: element.getAttribute("data-design-tool-fill") || "#d9d9d9",
      stroke: element.getAttribute("data-design-tool-stroke") || "#222222",
      strokeWidth: Number(element.getAttribute("data-design-tool-stroke-width") || 2),
      editable: element.getAttribute("data-design-tool-editable") !== "false",
    };
  }

  function createCommandFromSnapshot(snapshot) {
    return {
      command: "create-element",
      elementId: snapshot.elementId,
      kind: snapshot.kind,
      bounds: snapshot.bounds,
      text: snapshot.text,
      alt: snapshot.alt,
      src: snapshot.src,
      points: snapshot.points,
      fill: snapshot.fill,
      stroke: snapshot.stroke,
      strokeWidth: snapshot.strokeWidth,
      editable: snapshot.editable,
    };
  }

  function collectAttributes(element) {
    const attributes = {};
    for (const attribute of Array.from(element.attributes).slice(0, 32)) {
      if (/^on/i.test(attribute.name)) continue;
      attributes[attribute.name] = attribute.value.slice(0, MAX_ATTRIBUTE_LENGTH);
    }
    return attributes;
  }

  const COMPUTED_PROPERTIES = [
    "display", "position", "box-sizing", "aspect-ratio", "white-space", "object-fit", "width", "height", "top", "right", "bottom", "left",
    "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right",
    "padding-bottom", "padding-left", "gap", "color", "background-color", "font-family", "font-size",
    "font-weight", "line-height", "letter-spacing", "text-align", "text-transform", "opacity",
    "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
    "border-color", "border-width", "box-shadow", "background", "overflow", "transform", "z-index",
  ];

  function inspect(element) {
    const target = describe(element);
    if (!target) return null;
    const computedStyle = {};
    const inlineStyle = {};
    const computed = window.getComputedStyle(element);
    for (const property of COMPUTED_PROPERTIES) {
      computedStyle[property] = computed.getPropertyValue(property).slice(0, MAX_ATTRIBUTE_LENGTH);
      const inlineValue = element.style.getPropertyValue(property);
      if (inlineValue) inlineStyle[property] = inlineValue.slice(0, MAX_ATTRIBUTE_LENGTH);
    }
    return {
      target,
      text: (element.textContent || "").slice(0, MAX_TEXT_LENGTH),
      attributes: collectAttributes(element),
      inlineStyle,
      computedStyle,
    };
  }

  function snapshot() {
    const nodes = [];
    const rootIds = [];
    let truncated = false;

    function visit(element, parentId, depth) {
      if (nodes.length >= MAX_NODES || depth > MAX_DEPTH) {
        truncated = true;
        return null;
      }
      const target = describe(element);
      if (!target) return null;
      const node = { ...target, parentId, childIds: [] };
      nodes.push(node);
      if (parentId === null) rootIds.push(target.elementId);
      for (const child of Array.from(element.children)) {
        const childId = visit(child, target.elementId, depth + 1);
        if (childId) node.childIds.push(childId);
      }
      return target.elementId;
    }

    const root = document.documentElement || document.body;
    if (root) visit(root, null, 0);
    return { rootIds, nodes, truncated };
  }

  function eventPoint(event) {
    return {
      x: isFiniteNumber(event.clientX) ? event.clientX : 0,
      y: isFiniteNumber(event.clientY) ? event.clientY : 0,
    };
  }

  function isEditableTextElement(element) {
    return element instanceof HTMLElement &&
      !["HTML", "BODY", "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "IMG"].includes(element.tagName) &&
      element.children.length === 0 &&
      (element.textContent || "").length <= MAX_TEXT_LENGTH;
  }

  function restoreTextEdit(edit) {
    if (edit.contentEditable === null) edit.element.removeAttribute("contenteditable");
    else edit.element.setAttribute("contenteditable", edit.contentEditable);
    if (edit.spellcheck === null) edit.element.removeAttribute("spellcheck");
    else edit.element.setAttribute("spellcheck", edit.spellcheck);
    edit.element.removeAttribute("data-design-tool-editing");
  }

  function beginTextEdit(element, event) {
    if (!isEditableTextElement(element)) return false;
    if (activeTextEdit && activeTextEdit.element === element) {
      element.focus();
      return true;
    }
    const edit = {
      element,
      originalText: (element.textContent || "").slice(0, MAX_TEXT_LENGTH),
      contentEditable: element.getAttribute("contenteditable"),
      spellcheck: element.getAttribute("spellcheck"),
      pending: null,
    };
    activeTextEdit = edit;
    element.contentEditable = "true";
    element.setAttribute("spellcheck", "false");
    element.setAttribute("data-design-tool-editing", "true");
    element.focus();
    sendEvent("text-edit-start", event || { target: element, clientX: 0, clientY: 0 }, describe(element));
    return true;
  }

  function finishTextEdit(event) {
    if (!activeTextEdit || activeTextEdit.pending) return false;
    activeTextEdit.pending = "commit";
    sendEvent("text-commit", event, describe(activeTextEdit.element));
    return true;
  }

  function cancelTextEdit(event, notify = true) {
    if (!activeTextEdit) return false;
    const edit = activeTextEdit;
    activeTextEdit = null;
    edit.element.textContent = edit.originalText;
    restoreTextEdit(edit);
    if (notify) sendEvent("text-cancel", event || { target: edit.element, clientX: 0, clientY: 0 }, describe(edit.element));
    return true;
  }

  function sendEvent(eventName, event, target) {
    post({
      type: "event",
      event: eventName,
      target,
      point: eventPoint(event),
      ...(typeof event.key === "string" ? { key: event.key.slice(0, 64) } : {}),
      ...(typeof event.target?.textContent === "string" && eventName === "input"
        ? { text: event.target.textContent.slice(0, MAX_TEXT_LENGTH) }
        : {}),
      ...(typeof event.target?.textContent === "string" && (eventName === "text-edit-start" || eventName === "text-commit" || eventName === "text-cancel")
        ? { text: event.target.textContent.slice(0, MAX_TEXT_LENGTH) }
        : {}),
      ...(typeof event.buttons === "number" ? { buttons: event.buttons } : {}),
      ...(typeof event.pointerId === "number" ? { pointerId: event.pointerId } : {}),
      shiftKey: Boolean(event.shiftKey),
      altKey: Boolean(event.altKey),
    });
  }

  function handleHover(event) {
    const target = event.target instanceof Element ? describe(event.target) : null;
    const nextId = target ? target.elementId : null;
    if (nextId === lastHoveredElementId) return;
    lastHoveredElementId = nextId;
    sendEvent("hover", event, target);
  }

  function handlePointerOut(event) {
    if (event.relatedTarget instanceof Node && event.target instanceof Node && event.target.contains(event.relatedTarget)) return;
    if (lastHoveredElementId !== null) {
      lastHoveredElementId = null;
      sendEvent("hover", event, null);
    }
  }

  function dispatchPendingPointerMove() {
    pendingPointerMoveFrame = null;
    const event = pendingPointerMove;
    pendingPointerMove = null;
    if (!event) return;
    const target = event.target instanceof Element ? describe(event.target) : null;
    sendEvent("pointermove", event, target);
    const nextId = target ? target.elementId : null;
    if (nextId === lastHoveredElementId) return;
    lastHoveredElementId = nextId;
    sendEvent("hover", event, target);
  }

  function queuePointerMove(event) {
    pendingPointerMove = event;
    if (pendingPointerMoveFrame !== null) return;
    if (typeof requestAnimationFrame === "function") {
      pendingPointerMoveFrame = requestAnimationFrame(dispatchPendingPointerMove);
    } else {
      dispatchPendingPointerMove();
    }
  }

  function isSafeStyleValue(value) {
    return value === null || (
      isSafeString(value, 4096, true) &&
      !/[;]|url\\s*\\(|expression\\s*\\(|javascript\\s*:|@import|-moz-binding/i.test(value)
    );
  }

  function runCommand(command) {
    if (!isRecord(command) || !isSafeString(command.command, 64)) {
      throw { code: "invalid-command", message: "The bridge command shape is invalid" };
    }
    const needsTarget = command.command === "set-inline-style" || command.command === "set-text" ||
      command.command === "start-text-edit" || command.command === "cancel-text-edit" || command.command === "commit-text-edit";
    const element = needsTarget ? findElement(command.targetId) : null;
    if (needsTarget && !element) throw { code: "target-not-found", message: "The requested element no longer exists" };

    if (command.command === "set-inline-style") {
      if (!SAFE_STYLE_PROPERTIES.has(command.property) || !isSafeStyleValue(command.value)) {
        throw { code: "unsafe-style", message: "The requested inline style is not allowed" };
      }
      const previousValue = element.style.getPropertyValue(command.property) || null;
      if (previousValue && previousValue.length > 4096) {
        throw { code: "style-too-large", message: "The existing inline style is too large to reverse safely" };
      }
      if (command.value === null || command.value === "") element.style.removeProperty(command.property);
      else {
        if (window.CSS && typeof window.CSS.supports === "function" && !window.CSS.supports(command.property, command.value)) {
          throw { code: "invalid-style", message: "The value is not valid for the requested style property" };
        }
        element.style.setProperty(command.property, command.value);
      }
      const value = element.style.getPropertyValue(command.property) || null;
      return {
        kind: "command",
        command: "set-inline-style",
        targetId: command.targetId,
        property: command.property,
        previousValue,
        value,
        undo: { command: "set-inline-style", targetId: command.targetId, property: command.property, value: previousValue },
      };
    }

    if (command.command === "set-text") {
      if (!isSafeString(command.text, MAX_TEXT_LENGTH, true) || /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|IMG)$/.test(element.tagName)) {
        throw { code: "unsafe-text-target", message: "Text edits are not allowed for this element" };
      }
      const previousText = element.textContent || "";
      if (previousText.length > MAX_TEXT_LENGTH) {
        throw { code: "text-too-large", message: "The existing text is too large to reverse safely" };
      }
      element.textContent = command.text;
      return {
        kind: "command",
        command: "set-text",
        targetId: command.targetId,
        previousText,
        text: command.text,
        undo: { command: "set-text", targetId: command.targetId, text: previousText },
      };
    }
    if (command.command === "start-text-edit") {
      beginTextEdit(element, { target: element, clientX: 0, clientY: 0 });
      return { kind: "command", command: "start-text-edit", targetId: command.targetId };
    }
    if (command.command === "cancel-text-edit") {
      if (activeTextEdit && activeTextEdit.element === element) cancelTextEdit(null, false);
      return { kind: "command", command: "cancel-text-edit", targetId: command.targetId };
    }
    if (command.command === "commit-text-edit") {
      if (!isSafeString(command.text, MAX_TEXT_LENGTH, true) || /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|IMG)$/.test(element.tagName)) {
        throw { code: "unsafe-text-target", message: "Text edits are not allowed for this element" };
      }
      const edit = activeTextEdit && activeTextEdit.element === element ? activeTextEdit : null;
      const previousText = edit ? edit.originalText : (element.textContent || "");
      element.textContent = command.text;
      if (edit) {
        restoreTextEdit(edit);
        activeTextEdit = null;
      }
      return {
        kind: "command",
        command: "set-text",
        targetId: command.targetId,
        previousText,
        text: command.text,
        undo: { command: "set-text", targetId: command.targetId, text: previousText },
      };
    }
    if (command.command === "create-element") {
      const element = createElementFromSpec(command);
      const target = describe(element);
      if (!target) throw { code: "create-failed", message: "The created element could not be inspected" };
      return {
        kind: "command",
        command: "create-element",
        targetId: target.elementId,
        target,
        undo: { command: "delete-element", targetId: target.elementId },
        replay: command,
      };
    }
    if (command.command === "delete-element") {
      const element = findElement(command.targetId);
      if (!element || element.getAttribute("data-design-tool-created") !== "true") {
        throw { code: "delete-not-supported", message: "Only elements created by this editor can be deleted safely" };
      }
      const snapshotValue = createdSnapshot(element);
      if (!snapshotValue) throw { code: "delete-not-reversible", message: "The element cannot be reversed safely" };
      element.remove();
      return {
        kind: "command",
        command: "delete-element",
        targetId: command.targetId,
        undo: { command: "restore-element", snapshot: snapshotValue },
        replay: command,
      };
    }
    if (command.command === "restore-element") {
      const element = createElementFromSpec(command.snapshot);
      const target = describe(element);
      if (!target) throw { code: "restore-failed", message: "The element could not be restored" };
      const replay = createCommandFromSnapshot(command.snapshot);
      return {
        kind: "command",
        command: "restore-element",
        targetId: target.elementId,
        target,
        undo: { command: "delete-element", targetId: target.elementId },
        replay,
      };
    }
    if (command.command === "duplicate-element") {
      const source = findElement(command.targetId);
      const sourceSnapshot = source ? createdSnapshot(source) : null;
      if (!sourceSnapshot) throw { code: "duplicate-not-supported", message: "Only editor-created elements can be duplicated safely" };
      const snapshotValue = {
        ...sourceSnapshot,
        elementId: command.elementId,
        bounds: { ...sourceSnapshot.bounds, x: sourceSnapshot.bounds.x + 16, y: sourceSnapshot.bounds.y + 16 },
      };
      const element = createElementFromSpec(snapshotValue);
      const target = describe(element);
      if (!target) throw { code: "duplicate-failed", message: "The duplicate could not be inspected" };
      return {
        kind: "command",
        command: "duplicate-element",
        targetId: target.elementId,
        target,
        undo: { command: "delete-element", targetId: target.elementId },
        replay: createCommandFromSnapshot(snapshotValue),
      };
    }
    throw { code: "unsupported-command", message: "The requested bridge command is not supported" };
  }

  function handleParentMessage(event) {
    if (event.source !== window.parent || event.origin !== CONFIG.parentOrigin || !isEnvelope(event.data)) return;
    const message = event.data;
    if (message.type === "handshake") {
      sendReady();
      return;
    }
    if (message.type === "request") {
      if (!isSafeString(message.requestId, 256)) return;
      if (message.command === "snapshot") {
        sendResponse(message.requestId, { ok: true, result: { kind: "snapshot", snapshot: snapshot() } });
        return;
      }
      if (message.command === "inspect" && isSafeString(message.targetId, 512)) {
        sendResponse(message.requestId, { ok: true, result: { kind: "inspection", inspection: inspect(findElement(message.targetId)) } });
        return;
      }
      sendError(message.requestId, "invalid-request", "The requested inspection is invalid");
      return;
    }
    if (message.type === "command" && isSafeString(message.requestId, 256)) {
      try {
        sendResponse(message.requestId, { ok: true, result: { kind: "command", ack: runCommand(message.command) } });
      } catch (error) {
        const bridgeError = isRecord(error) && isSafeString(error.code, 128) && isSafeString(error.message, 2048)
          ? error
          : { code: "command-failed", message: "The bridge command could not be applied" };
        sendError(message.requestId, bridgeError.code, bridgeError.message);
      }
    }
  }

  function install() {
    document.addEventListener("pointerover", handleHover, true);
    document.addEventListener("pointermove", queuePointerMove, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    ["pointerdown", "pointerup"].forEach((eventName) => {
      document.addEventListener(eventName, (event) => {
        const target = event.target instanceof Element ? describe(event.target) : null;
        sendEvent(eventName, event, target);
      }, true);
    });
    document.addEventListener("dblclick", (event) => {
      const element = event.target instanceof Element ? event.target : null;
      if (element && beginTextEdit(element, event)) event.preventDefault();
    }, true);
    document.addEventListener("keydown", (event) => {
      const target = event.target instanceof Element ? describe(event.target) : null;
      if (activeTextEdit && activeTextEdit.element === event.target) {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelTextEdit(event);
        } else if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          finishTextEdit(event);
        }
      } else if (!activeTextEdit && event.key === "Enter" && lastSelectedElement) {
        event.preventDefault();
        beginTextEdit(lastSelectedElement, event);
      }
      sendEvent("keydown", event, target);
    }, true);
    document.addEventListener("input", (event) => {
      const target = event.target instanceof Element ? describe(event.target) : null;
      sendEvent("input", event, target);
    }, true);
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? describe(event.target) : null;
      lastSelectedElement = event.target instanceof Element ? event.target : null;
      sendEvent("select", event, target);
    }, true);
    document.addEventListener("blur", (event) => {
      if (activeTextEdit && activeTextEdit.element === event.target) finishTextEdit(event);
    }, true);
    sendReady();
  }

  window.addEventListener("message", handleParentMessage);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
`.trim();
}
