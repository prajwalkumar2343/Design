import { parse, walk, type CssTreeNode } from "css-tree";

import {
  HtmlAdmissionError,
  validateCompleteHtml,
  type HtmlValidationResult,
} from "./html-admission";

/**
 * The wireframe allowlist covers neutral layout, sizing, spacing, overflow,
 * alignment, and basic typography. Canvas-owned visual treatment is
 * intentionally absent: colors, surfaces, borders, effects, motion, and
 * transforms cannot enter the document through this mode.
 */
const ALLOWED_CSS_PROPERTIES = new Set([
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "box-sizing",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "gap",
  "row-gap",
  "column-gap",
  "flex",
  "flex-direction",
  "flex-wrap",
  "flex-flow",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-items",
  "align-content",
  "align-self",
  "justify-content",
  "justify-items",
  "justify-self",
  "place-items",
  "place-content",
  "place-self",
  "order",
  "grid-template-columns",
  "grid-template-rows",
  "grid-template-areas",
  "grid-column",
  "grid-column-start",
  "grid-column-end",
  "grid-row",
  "grid-row-start",
  "grid-row-end",
  "grid-auto-flow",
  "grid-auto-columns",
  "grid-auto-rows",
  "overflow",
  "overflow-x",
  "overflow-y",
  "z-index",
  "font-size",
  "line-height",
  "font-weight",
  "text-align",
  "white-space",
]);

const ALLOWED_CSS_FUNCTIONS = new Set(["calc", "min", "max", "clamp", "minmax", "repeat"]);
const ALLOWED_NESTED_AT_RULES = new Set(["media", "container", "supports"]);
const PRESENTATIONAL_ATTRIBUTES = new Set([
  "bgcolor",
  "color",
  "background",
  "border",
  "cellpadding",
  "cellspacing",
  "face",
  "size",
  "align",
  "valign",
  "width",
  "height",
]);
const LEGACY_PRESENTATIONAL_ELEMENTS = new Set(["font", "marquee", "blink"]);
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";

export type WireframeViolationCode =
  | "invalid-html"
  | "reserved-runtime-marker"
  | "reserved-wireframe-theme-marker"
  | "html-too-large"
  | "script"
  | "event-handler"
  | "embedded-content"
  | "external-resource"
  | "media"
  | "form-action"
  | "navigation"
  | "legacy-element"
  | "presentation-attribute"
  | "namespace"
  | "metadata"
  | "css-parse"
  | "css-at-rule"
  | "css-property"
  | "css-function"
  | "css-pseudo-content";

export interface WireframeViolation {
  code: WireframeViolationCode;
  message: string;
  path?: string;
  property?: string;
  atRule?: string;
}

export interface WireframeValidationResult extends HtmlValidationResult {
  mode: "wireframe";
}

export type WireframeAdmissionErrorCode = "wireframe-admission";

export class WireframeAdmissionError extends Error {
  readonly code: WireframeAdmissionErrorCode = "wireframe-admission";
  readonly violations: readonly WireframeViolation[];

  constructor(violations: readonly WireframeViolation[]) {
    super(violations.map((violation) => violation.message).join("; "));
    this.name = "WireframeAdmissionError";
    this.violations = violations;
  }
}

function isNode(value: unknown): value is CssTreeNode {
  return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}

function nodeChildren(node: CssTreeNode, key: string): CssTreeNode[] {
  const value = node[key];
  if (Array.isArray(value)) return value.filter(isNode);
  if (typeof value === "object" && value !== null && "toArray" in value) {
    const toArray = value.toArray;
    if (typeof toArray === "function") {
      const items = toArray.call(value) as unknown;
      return Array.isArray(items) ? items.filter(isNode) : [];
    }
  }
  return isNode(value) ? [value] : [];
}

function nodeString(node: CssTreeNode, key: string): string | null {
  return typeof node[key] === "string" ? node[key] : null;
}

function addViolation(
  violations: WireframeViolation[],
  violation: WireframeViolation,
): void {
  if (violations.some((item) => item.code === violation.code && item.path === violation.path && item.property === violation.property)) {
    return;
  }
  violations.push(violation);
}

function inspectValue(
  value: CssTreeNode,
  path: string,
  violations: WireframeViolation[],
): void {
  walk(value, (node) => {
    if (node.type === "Url") {
      addViolation(violations, {
        code: "css-function",
        message: `Wireframe CSS cannot load resources with url() at ${path}`,
        path,
      });
    }
    if (node.type === "Function") {
      const name = nodeString(node, "name")?.toLowerCase();
      if (!name || !ALLOWED_CSS_FUNCTIONS.has(name)) {
        addViolation(violations, {
          code: "css-function",
          message: `Wireframe CSS function ${name ?? "(unknown)"} is not allowed at ${path}`,
          path,
        });
      }
    }
    if (node.type === "Raw") {
      addViolation(violations, {
        code: "css-parse",
        message: `Wireframe CSS contains an unparsed value at ${path}`,
        path,
      });
    }
  });
}

function inspectDeclarationList(
  node: CssTreeNode,
  path: string,
  violations: WireframeViolation[],
): void {
  for (const declaration of nodeChildren(node, "children")) {
    if (declaration.type === "Comment") continue;
    if (declaration.type !== "Declaration") {
      addViolation(violations, {
        code: "css-parse",
        message: `Wireframe CSS contains an unsupported declaration node at ${path}`,
        path,
      });
      continue;
    }
    const property = nodeString(declaration, "property")?.toLowerCase();
    if (!property || !ALLOWED_CSS_PROPERTIES.has(property)) {
      addViolation(violations, {
        code: "css-property",
        message: `Wireframe CSS property ${property ?? "(unknown)"} is not allowed at ${path}`,
        path,
        property: property ?? undefined,
      });
    }
    const value = nodeChildren(declaration, "value")[0];
    if (value) inspectValue(value, `${path}.${property ?? "property"}`, violations);
  }
}

function inspectRule(
  node: CssTreeNode,
  path: string,
  violations: WireframeViolation[],
): void {
  const prelude = nodeChildren(node, "prelude")[0];
  if (prelude) {
    walk(prelude, (selectorNode) => {
      if (selectorNode.type === "PseudoElementSelector") {
        addViolation(violations, {
          code: "css-pseudo-content",
          message: `Wireframe CSS cannot use decorative pseudo-elements at ${path}`,
          path,
        });
      }
    });
  }
  const block = nodeChildren(node, "block")[0];
  if (!block) {
    addViolation(violations, {
      code: "css-parse",
      message: `Wireframe CSS rule has no declaration block at ${path}`,
      path,
    });
    return;
  }
  inspectBlock(block, path, violations);
}

function inspectAtRule(
  node: CssTreeNode,
  path: string,
  violations: WireframeViolation[],
): void {
  const atRule = nodeString(node, "name")?.toLowerCase();
  if (!atRule || !ALLOWED_NESTED_AT_RULES.has(atRule)) {
    addViolation(violations, {
      code: "css-at-rule",
      message: `Wireframe CSS at-rule @${atRule ?? "(unknown)"} is not allowed at ${path}`,
      path,
      atRule: atRule ?? undefined,
    });
    return;
  }
  const prelude = nodeChildren(node, "prelude")[0];
  if (prelude) {
    inspectValue(prelude, `${path}.prelude`, violations);
  }
  const block = nodeChildren(node, "block")[0];
  if (!block) {
    addViolation(violations, {
      code: "css-parse",
      message: `Wireframe CSS at-rule @${atRule} has no block at ${path}`,
      path,
      atRule,
    });
    return;
  }
  inspectBlock(block, path, violations);
}

function inspectBlock(
  block: CssTreeNode,
  path: string,
  violations: WireframeViolation[],
): void {
  for (const [index, child] of nodeChildren(block, "children").entries()) {
    const childPath = `${path}.${index}`;
    if (child.type === "Comment") continue;
    if (child.type === "Declaration") {
      inspectDeclarationList({ type: "DeclarationList", children: [child] }, childPath, violations);
    } else if (child.type === "Rule") {
      inspectRule(child, childPath, violations);
    } else if (child.type === "Atrule") {
      inspectAtRule(child, childPath, violations);
    } else {
      addViolation(violations, {
        code: "css-parse",
        message: `Wireframe CSS contains unsupported node ${child.type} at ${childPath}`,
        path: childPath,
      });
    }
  }
}

function inspectStylesheet(source: string, path: string, violations: WireframeViolation[]): void {
  try {
    const stylesheet = parse(source, { context: "stylesheet" });
    for (const [index, child] of nodeChildren(stylesheet, "children").entries()) {
      const childPath = `${path}.${index}`;
      if (child.type === "Comment") continue;
      if (child.type === "Rule") inspectRule(child, childPath, violations);
      else if (child.type === "Atrule") inspectAtRule(child, childPath, violations);
      else {
        addViolation(violations, {
          code: "css-parse",
          message: `Wireframe CSS contains unsupported node ${child.type} at ${childPath}`,
          path: childPath,
        });
      }
    }
  } catch (error) {
    addViolation(violations, {
      code: "css-parse",
      message: `Wireframe CSS could not be parsed at ${path}: ${error instanceof Error ? error.message : "invalid CSS"}`,
      path,
    });
  }
}

function inspectDeclarationAttribute(
  source: string,
  path: string,
  violations: WireframeViolation[],
): void {
  try {
    const declarations = parse(source, { context: "declarationList" });
    inspectDeclarationList(declarations, path, violations);
  } catch (error) {
    addViolation(violations, {
      code: "css-parse",
      message: `Wireframe inline CSS could not be parsed at ${path}: ${error instanceof Error ? error.message : "invalid CSS"}`,
      path,
    });
  }
}

function inspectHtmlStructure(html: string, violations: WireframeViolation[]): void {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const blockedTags: Record<string, WireframeViolationCode> = {
    script: "script",
    iframe: "embedded-content",
    object: "embedded-content",
    embed: "embedded-content",
    applet: "embedded-content",
    portal: "embedded-content",
    template: "embedded-content",
    img: "media",
    picture: "media",
    svg: "media",
    canvas: "media",
    video: "media",
    audio: "media",
    source: "media",
    track: "media",
    map: "media",
    area: "media",
  };

  for (const [index, element] of Array.from(parsed.querySelectorAll("*")).entries()) {
    const path = `${element.tagName.toLowerCase()}[${index}]`;
    const tagName = element.tagName.toLowerCase();
    if (element.namespaceURI === MATHML_NAMESPACE || tagName === "math") {
      addViolation(violations, {
        code: "namespace",
        message: "Wireframe HTML cannot contain MathML content",
        path,
      });
    }
    if (LEGACY_PRESENTATIONAL_ELEMENTS.has(tagName)) {
      addViolation(violations, {
        code: "legacy-element",
        message: `Wireframe HTML legacy element <${tagName}> is not allowed`,
        path,
      });
    }
    const blockedCode = blockedTags[tagName];
    if (blockedCode) {
      addViolation(violations, {
        code: blockedCode,
        message: `Wireframe HTML element <${tagName}> is not allowed`,
        path,
      });
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.includes(":")) {
        addViolation(violations, {
          code: "namespace",
          message: `Wireframe HTML namespaced attribute ${attribute.name} is not allowed`,
          path,
        });
      } else if (PRESENTATIONAL_ATTRIBUTES.has(name)) {
        addViolation(violations, {
          code: "presentation-attribute",
          message: `Wireframe HTML presentational attribute ${attribute.name} is not allowed`,
          path,
        });
      } else if (name.startsWith("on")) {
        addViolation(violations, {
          code: "event-handler",
          message: `Wireframe HTML event-handler attribute ${attribute.name} is not allowed`,
          path,
        });
      } else if (name === "style") {
        inspectDeclarationAttribute(value, `${path}.style`, violations);
      } else if (["src", "srcset", "poster", "data", "code", "srcdoc"].includes(name)) {
        addViolation(violations, {
          code: name === "srcdoc" ? "embedded-content" : "external-resource",
          message: `Wireframe HTML resource attribute ${attribute.name} is not allowed`,
          path,
        });
      } else if (name === "href") {
        if (tagName === "a") {
          if (!value.startsWith("#")) {
            addViolation(violations, {
              code: "navigation",
              message: "Wireframe links may only use inert # anchors",
              path,
            });
          }
        } else {
          addViolation(violations, {
            code: "external-resource",
            message: `Wireframe HTML href on <${tagName}> is not allowed`,
            path,
          });
        }
      } else if (name === "action" && tagName === "form" && value !== "#") {
        addViolation(violations, {
          code: "form-action",
          message: "Wireframe forms may only use an inert # action",
          path,
        });
      } else if (name === "formaction" && value !== "#") {
        addViolation(violations, {
          code: "form-action",
          message: "Wireframe form controls may only use an inert # action",
          path,
        });
      } else if (["cite", "longdesc", "manifest", "ping", "usemap"].includes(name)) {
        addViolation(violations, {
          code: "external-resource",
          message: `Wireframe HTML URL attribute ${attribute.name} is not allowed`,
          path,
        });
      }
    }

    if (tagName === "base") {
      addViolation(violations, {
        code: "metadata",
        message: "Wireframe HTML cannot change the document base URL",
        path,
      });
    }
    if (tagName === "link") {
      addViolation(violations, {
        code: "external-resource",
        message: "Wireframe HTML cannot load external link resources",
        path,
      });
    }
    if (tagName === "meta" && element.hasAttribute("http-equiv")) {
      addViolation(violations, {
        code: "metadata",
        message: "Wireframe HTML cannot use meta http-equiv directives",
        path,
      });
    }
    if (tagName === "style") inspectStylesheet(element.textContent ?? "", `${path}.style`, violations);
  }
}

function mapHtmlAdmissionError(error: HtmlAdmissionError): WireframeAdmissionError {
  return new WireframeAdmissionError([{
    code: error.code,
    message: error.message,
  }]);
}

export function validateWireframeHtml(html: string): WireframeValidationResult {
  let base: HtmlValidationResult;
  try {
    base = validateCompleteHtml(html);
  } catch (error) {
    if (error instanceof HtmlAdmissionError) throw mapHtmlAdmissionError(error);
    throw error;
  }

  const violations: WireframeViolation[] = [];
  inspectHtmlStructure(html, violations);
  if (violations.length > 0) throw new WireframeAdmissionError(violations);
  return { ...base, mode: "wireframe" };
}
