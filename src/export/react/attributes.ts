/**
 * Attribute fidelity tables for DOM-to-JSX conversion: rename maps, the
 * boolean attribute set, the editor-attribute strip pattern, and the
 * `style="…"` parser that splits ordinary declarations from !important ones
 * (which cannot live in a React style object and are routed into the scoped
 * stylesheet by the caller).
 */
import { generate, parse, type CssTreeList, type CssTreeNode } from "css-tree";

import type { ConversionContext, JsxProp, StyleDecl } from "./jsx";

/** HTML attribute → JSX prop for names React spells differently. */
export const HTML_ATTR_RENAMES: Readonly<Record<string, string>> = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  readonly: "readOnly",
  maxlength: "maxLength",
  minlength: "minLength",
  colspan: "colSpan",
  rowspan: "rowSpan",
  cellpadding: "cellPadding",
  cellspacing: "cellSpacing",
  autocomplete: "autoComplete",
  autocorrect: "autoCorrect",
  autocapitalize: "autoCapitalize",
  autofocus: "autoFocus",
  enctype: "encType",
  formaction: "formAction",
  formenctype: "formEncType",
  formmethod: "formMethod",
  formnovalidate: "formNoValidate",
  formtarget: "formTarget",
  frameborder: "frameBorder",
  marginheight: "marginHeight",
  marginwidth: "marginWidth",
  novalidate: "noValidate",
  allowfullscreen: "allowFullScreen",
  srcdoc: "srcDoc",
  srclang: "srcLang",
  playsinline: "playsInline",
  crossorigin: "crossOrigin",
  usemap: "useMap",
  "accept-charset": "acceptCharset",
  "http-equiv": "httpEquiv",
  charset: "charSet",
  contenteditable: "contentEditable",
  spellcheck: "spellCheck",
  itemscope: "itemScope",
  itemprop: "itemProp",
  itemtype: "itemType",
  itemid: "itemId",
  itemref: "itemRef",
  datetime: "dateTime",
  accesskey: "accessKey",
  imagesrcset: "imageSrcSet",
  imagesizes: "imageSizes",
  fetchpriority: "fetchPriority",
  elementtiming: "elementTiming",
  attributionsrc: "attributionSrc",
};

/** SVG attribute → JSX prop. `viewBox`, `d`, `points`, `x`, `y`, `cx`, `cy`,
 *  `r` and friends already arrive in the right spelling and pass through. */
export const SVG_ATTR_RENAMES: Readonly<Record<string, string>> = {
  "xlink:href": "href",
  "xlink:title": "xlinkTitle",
  "xml:space": "xmlSpace",
  "xml:lang": "xmlLang",
  "accent-height": "accentHeight",
  "alignment-baseline": "alignmentBaseline",
  "arabic-form": "arabicForm",
  "baseline-shift": "baselineShift",
  "cap-height": "capHeight",
  "clip-path": "clipPath",
  "clip-rule": "clipRule",
  "clip-path-units": "clipPathUnits",
  "color-interpolation": "colorInterpolation",
  "color-interpolation-filters": "colorInterpolationFilters",
  "color-profile": "colorProfile",
  "color-rendering": "colorRendering",
  "dominant-baseline": "dominantBaseline",
  "enable-background": "enableBackground",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  "flood-color": "floodColor",
  "flood-opacity": "floodOpacity",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-size-adjust": "fontSizeAdjust",
  "font-stretch": "fontStretch",
  "font-style": "fontStyle",
  "font-variant": "fontVariant",
  "font-weight": "fontWeight",
  "glyph-name": "glyphName",
  "glyph-orientation-horizontal": "glyphOrientationHorizontal",
  "glyph-orientation-vertical": "glyphOrientationVertical",
  "horiz-adv-x": "horizAdvX",
  "horiz-origin-x": "horizOriginX",
  "image-rendering": "imageRendering",
  "letter-spacing": "letterSpacing",
  "lighting-color": "lightingColor",
  "marker-end": "markerEnd",
  "marker-mid": "markerMid",
  "marker-start": "markerStart",
  "marker-height": "markerHeight",
  "marker-units": "markerUnits",
  "marker-width": "markerWidth",
  "overline-position": "overlinePosition",
  "overline-thickness": "overlineThickness",
  "paint-order": "paintOrder",
  "pointer-events": "pointerEvents",
  "rendering-intent": "renderingIntent",
  "shape-rendering": "shapeRendering",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "strikethrough-position": "strikethroughPosition",
  "strikethrough-thickness": "strikethroughThickness",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-opacity": "strokeOpacity",
  "stroke-width": "strokeWidth",
  "text-anchor": "textAnchor",
  "text-decoration": "textDecoration",
  "text-rendering": "textRendering",
  "underline-position": "underlinePosition",
  "underline-thickness": "underlineThickness",
  "unicode-bidi": "unicodeBidi",
  "unicode-range": "unicodeRange",
  "units-per-em": "unitsPerEm",
  "v-alphabetic": "vAlphabetic",
  "v-hanging": "vHanging",
  "v-ideographic": "vIdeographic",
  "v-mathematical": "vMathematical",
  "vector-effect": "vectorEffect",
  "vert-adv-y": "vertAdvY",
  "vert-origin-x": "vertOriginX",
  "vert-origin-y": "vertOriginY",
  "word-spacing": "wordSpacing",
  "writing-mode": "writingMode",
  "x-height": "xHeight",
};

/** JSX prop names that serialize as bare attributes when the source value is
 *  empty or repeats the name (`disabled`, `disabled=""`, `disabled="disabled"`). */
export const BOOLEAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  "allowFullScreen",
  "async",
  "autoFocus",
  "autoPlay",
  "controls",
  "default",
  "defaultChecked",
  "defer",
  "disabled",
  "formNoValidate",
  "hidden",
  "inert",
  "isMap",
  "itemScope",
  "loop",
  "multiple",
  "muted",
  "noModule",
  "noValidate",
  "open",
  "playsInline",
  "readOnly",
  "required",
  "reversed",
]);

/** Editor bookkeeping baked into stored documents; stripped at the boundary. */
export const EDITOR_ATTRIBUTE_PATTERN = /^data-(?:design-|figma-|canvas-paste-)/;

function camelizeVendorFree(name: string): string {
  return name.replace(/-([a-zA-Z])/g, (_match, letter: string) => letter.toUpperCase());
}

/** `margin-top` → `marginTop`; `-webkit-x` → `WebkitX`; `-ms-x` → `msX`;
 *  `--custom` stays verbatim (React supports custom properties in style objects). */
export function stylePropertyName(property: string): string {
  if (property.startsWith("--")) return property;
  if (property.startsWith("-ms-")) {
    return `ms${camelizeVendorFree(property.slice(4)).replace(/^./, (c) => c.toUpperCase())}`;
  }
  if (property.startsWith("-")) {
    return camelizeVendorFree(property.slice(1)).replace(/^./, (c) => c.toUpperCase());
  }
  return camelizeVendorFree(property);
}

function listChildren(node: CssTreeNode, key: string): CssTreeNode[] {
  const value = node[key];
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is CssTreeNode =>
        typeof item === "object" && item !== null && typeof item.type === "string",
    );
  }
  if (typeof value === "object" && value !== null) {
    const toArray = (value as CssTreeList).toArray;
    if (typeof toArray === "function") return toArray.call(value);
  }
  return [];
}

/**
 * Parses a `style="…"` string into ordered declarations for the React style
 * object plus the !important subset routed into generated `dc-i{n}` rules.
 * `importantDecls` keep kebab-case property names (they go into a stylesheet);
 * `styleDecls` carry React-style names. css-tree tolerates broken input, so a
 * parse failure only surfaces as an empty list for genuinely empty styles.
 */
export function parseStyleAttribute(style: string): {
  styleDecls: StyleDecl[];
  importantDecls: StyleDecl[];
} {
  const styleDecls: StyleDecl[] = [];
  const importantDecls: StyleDecl[] = [];
  let list: CssTreeNode;
  try {
    list = parse(style, { context: "declarationList" });
  } catch {
    return { styleDecls, importantDecls };
  }
  for (const child of listChildren(list, "children")) {
    if (child.type !== "Declaration") continue;
    const property = typeof child.property === "string" ? child.property : null;
    if (!property) continue;
    const valueNode = child.value;
    if (typeof valueNode !== "object" || valueNode === null) continue;
    const value = generate(valueNode as CssTreeNode).trim();
    if (!value) continue;
    // css-tree stores the raw keyword ("IMPORTANT", "! important") for
    // non-canonical spellings — truthy covers every variant.
    if (child.important) {
      importantDecls.push({ property: property.toLowerCase(), value });
    } else {
      styleDecls.push({ property: stylePropertyName(property), value });
    }
  }
  return { styleDecls, importantDecls };
}

/**
 * Resolves one source attribute to a JsxProp. `null` means drop the attribute;
 * the reason (editor attr, `on*` handler) is recorded on `ctx.notes` — the
 * `event-handler-omitted` note fires here so every caller gets it for free.
 * `style` is handled too: normal declarations become a `style` prop while
 * !important declarations are diverted into `ctx.extractedRules` as a
 * generated `dc-i{n}` class (callers merge that class onto the element).
 */
export function attributeToProp(
  name: string,
  value: string,
  namespace: "html" | "svg",
  ctx: ConversionContext,
): JsxProp | null {
  const lower = name.toLowerCase();
  if (EDITOR_ATTRIBUTE_PATTERN.test(lower)) return null;

  if (lower.startsWith("on") && lower.length > 2) {
    ctx.notes.push({
      code: "event-handler-omitted",
      severity: "warning",
      message: `Event handler attribute "${lower}" was dropped; inline handlers do not survive React conversion.`,
      componentName: ctx.componentName,
      detail: lower,
    });
    return null;
  }

  if (lower === "style") {
    const { styleDecls, importantDecls } = parseStyleAttribute(value);
    if (importantDecls.length > 0) {
      const className = `dc-i${ctx.extractedRules.length}`;
      ctx.extractedRules.push({
        className,
        declarations: importantDecls.map((decl) => ({
          property: decl.property,
          value: `${decl.value} !important`,
        })),
      });
      ctx.notes.push({
        code: "important-style-extracted",
        severity: "info",
        message: `Inline !important declarations moved to the scoped stylesheet as .${className}.`,
        componentName: ctx.componentName,
        detail: importantDecls.map((decl) => decl.property).join(", "),
      });
    }
    return styleDecls.length > 0 ? { kind: "style", declarations: styleDecls } : null;
  }

  const renamed =
    namespace === "svg"
      ? (SVG_ATTR_RENAMES[lower] ?? name)
      : (HTML_ATTR_RENAMES[lower] ?? name);

  // Bare-attribute spelling only for canonical boolean usage; a real value
  // like hidden="until-found" keeps its value.
  if (BOOLEAN_ATTRIBUTES.has(renamed) && (value === "" || value.toLowerCase() === lower)) {
    return { kind: "bool", name: renamed };
  }
  return { kind: "attr", name: renamed, value };
}
