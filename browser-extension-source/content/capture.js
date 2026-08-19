// Canvas Capture — HTML + CSS serializer.
//
// Captures a section of the current page as a self-contained HTML document:
//   - deep-clones the selected element,
//   - removes non-visual or executable tags (scripts, iframes, meta, ...),
//   - inlines the computed styles of every remaining element (only the
//     properties whose computed value differs from the element's parent),
//   - wraps everything in a complete document with paste metadata on <html>.
//
// The metadata attributes are read by the Canvas web app
// (src/clipboard/paste-html.ts) and removed before the HTML is stored.

(function () {
  "use strict";

  const STRIP_TAGS = new Set([
    "SCRIPT", "IFRAME", "OBJECT", "EMBED", "BASE", "LINK", "META",
    "NOSCRIPT", "SOURCE", "TRACK", "TEMPLATE", "PORTAL", "AUDIO", "VIDEO",
  ]);

  const STYLE_PROPERTIES = [
    // Box and layout
    "display", "position", "top", "right", "bottom", "left", "inset",
    "float", "clear", "box-sizing", "width", "min-width", "max-width",
    "height", "min-height", "max-height", "aspect-ratio",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "overflow", "overflow-x", "overflow-y", "overflow-wrap",
    "z-index", "visibility", "opacity", "object-fit", "object-position",
    "isolation", "mix-blend-mode", "contain", "resize", "direction",
    "writing-mode", "clip-path",
    "order", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink",
    "flex-basis", "flex-flow", "justify-content", "align-items",
    "align-content", "align-self", "justify-items", "justify-self",
    "place-content", "place-items", "place-self",
    "grid-template-columns", "grid-template-rows", "grid-template-areas",
    "grid-auto-columns", "grid-auto-rows", "grid-auto-flow",
    "grid-column", "grid-column-start", "grid-column-end",
    "grid-row", "grid-row-start", "grid-row-end", "grid-area",
    "column-gap", "row-gap", "gap",
    "columns", "column-width", "column-count", "column-fill",
    "column-span", "column-rule-color", "column-rule-style", "column-rule-width",
    // Typography and text
    "color", "font-family", "font-size", "font-style", "font-weight",
    "font-stretch", "font-variant", "font-feature-settings",
    "letter-spacing", "line-height", "text-align", "text-align-last",
    "text-decoration-line", "text-decoration-style",
    "text-decoration-color", "text-decoration-thickness",
    "text-underline-offset", "text-indent", "text-overflow",
    "text-shadow", "text-transform", "text-wrap", "white-space",
    "word-break", "word-spacing", "word-wrap", "tab-size", "quotes",
    "vertical-align", "list-style-type", "list-style-position",
    "list-style-image", "counter-increment", "counter-reset",
    "caret-color", "accent-color", "user-select", "cursor",
    "pointer-events",
    // Visuals
    "background-color", "background-image", "background-position-x",
    "background-position-y", "background-size", "background-repeat",
    "background-origin", "background-clip", "background-attachment",
    "background-blend-mode",
    "border-top-color", "border-top-style", "border-top-width",
    "border-right-color", "border-right-style", "border-right-width",
    "border-bottom-color", "border-bottom-style", "border-bottom-width",
    "border-left-color", "border-left-style", "border-left-width",
    "border-top-left-radius", "border-top-right-radius",
    "border-bottom-left-radius", "border-bottom-right-radius",
    "outline-color", "outline-style", "outline-width", "outline-offset",
    "box-shadow", "filter", "backdrop-filter",
    "transform", "transform-origin", "transform-style",
    "transition", "transition-delay", "transition-duration",
    "transition-property", "transition-timing-function",
    "animation", "animation-name", "animation-duration",
    "animation-delay", "animation-timing-function",
    "animation-iteration-count", "animation-direction",
    "animation-fill-mode", "animation-play-state",
    "perspective", "perspective-origin", "backface-visibility",
    "will-change", "scroll-behavior", "shape-outside",
  ];

  const TRANSPARENT = /^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/i;

  function isTransparent(color) {
    return !color || TRANSPARENT.test(color.trim());
  }

  function findBackgroundColor(element) {
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE) {
      const color = getComputedStyle(node).backgroundColor;
      if (!isTransparent(color)) {
        return color;
      }
      node = node.parentElement;
    }
    return "#ffffff";
  }

  function inlineStyles(cloneElement, sourceElement) {
    const style = cloneElement.style;
    const computed = getComputedStyle(sourceElement);
    const parent = sourceElement.parentElement;
    const parentComputed = parent && parent.nodeType === Node.ELEMENT_NODE
      ? getComputedStyle(parent)
      : null;
    for (const property of STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (!value) {
        continue;
      }
      if (parentComputed && parentComputed.getPropertyValue(property) === value) {
        continue;
      }
      style.setProperty(property, value, computed.getPropertyPriority(property));
    }
  }

  // The clone has had non-visual tags removed, so its children no longer line
  // up one-to-one with the source children. Pair each remaining clone child
  // with the next source child that was not stripped.
  function walk(cloneNode, sourceNode) {
    if (cloneNode.nodeType !== Node.ELEMENT_NODE || sourceNode.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    inlineStyles(cloneNode, sourceNode);
    const cloneChildren = Array.from(cloneNode.children);
    const sourceChildren = Array.from(sourceNode.children);
    let sourceIndex = 0;
    for (const cloneChild of cloneChildren) {
      while (sourceIndex < sourceChildren.length
        && STRIP_TAGS.has(sourceChildren[sourceIndex].tagName)) {
        sourceIndex += 1;
      }
      const sourceChild = sourceChildren[sourceIndex] ?? null;
      sourceIndex += 1;
      if (sourceChild) {
        walk(cloneChild, sourceChild);
      }
    }
  }

  function buildCaptureDocument(clone, metadata) {
    const attributeValues = [
      ["data-canvas-paste-source", encodeURIComponent(metadata.sourceUrl)],
      ["data-canvas-paste-title", encodeURIComponent(metadata.title)],
      ["data-canvas-paste-width", String(Math.round(metadata.width))],
      ["data-canvas-paste-height", String(Math.round(metadata.height))],
      ["data-canvas-paste-background", encodeURIComponent(metadata.background)],
    ];
    const htmlAttributes = attributeValues
      .map(([name, value]) => `${name}="${value}"`)
      .join(" ");
    return [
      "<!doctype html>",
      `<html lang="en" ${htmlAttributes}>`,
      "<head>",
      '<meta charset="utf-8">',
      "<style>html,body{margin:0;padding:0;}</style>",
      "</head>",
      `<body style="margin:0;padding:0;background:${metadata.background}">`,
      clone.outerHTML,
      "</body>",
      "</html>",
    ].join("");
  }

  function captureSection(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    if (STRIP_TAGS.has(element.tagName)) {
      return null;
    }
    if (element.closest("#canvas-capture-overlay")) {
      return null;
    }

    const clone = element.cloneNode(true);
    clone.querySelectorAll(Array.from(STRIP_TAGS).map((tag) => tag.toLowerCase()).join(","))
      .forEach((node) => node.remove());

    walk(clone, element);

    const rect = element.getBoundingClientRect();
    const metadata = {
      sourceUrl: window.location.href,
      title: document.title || "",
      width: rect.width,
      height: rect.height,
      background: findBackgroundColor(element),
    };

    return {
      html: buildCaptureDocument(clone, metadata),
      metadata,
    };
  }

  async function copyHtmlToClipboard(html) {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([html], { type: "text/plain" }),
        }),
      ]);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = html;
    textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px;";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  window.CanvasCapture = { captureSection, copyHtmlToClipboard };
})();
