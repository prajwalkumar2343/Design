export interface WireframeOutlineEntry {
  index: number;
  depth: number;
  tag: string;
  id: string | null;
  classes: string[];
  role: string | null;
  textPreview: string;
}

const TEXT_PREVIEW_CHARS = 64;

function parseDocument(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function documentElements(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll("*"));
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function directTextPreview(element: Element): string {
  let text = "";
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
  }
  return collapseWhitespace(text).slice(0, TEXT_PREVIEW_CHARS);
}

export function buildWireframeOutline(
  html: string,
  maxEntries = 160,
): WireframeOutlineEntry[] {
  const doc = parseDocument(html);
  const elements = documentElements(doc);
  const bodyIndex = Math.max(0, elements.findIndex((element) => element.tagName.toLowerCase() === "body"));
  const entries: WireframeOutlineEntry[] = [];
  for (let index = bodyIndex; index < elements.length && entries.length < maxEntries; index += 1) {
    const element = elements[index];
    if (element.tagName.toLowerCase() === "head") continue;
    const parentChain: Element[] = [];
    let parent = element.parentElement;
    while (parent) {
      parentChain.push(parent);
      parent = parent.parentElement;
    }
    const depth = Math.max(0, parentChain.length - 2);
    entries.push({
      index,
      depth,
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: element.className.trim() ? element.className.trim().split(/\s+/) : [],
      role: element.getAttribute("role"),
      textPreview: directTextPreview(element),
    });
  }
  return entries;
}

export function renderWireframeOutline(entries: WireframeOutlineEntry[]): string {
  return entries
    .map((entry) => {
      const indent = "  ".repeat(entry.depth);
      const classes = entry.classes.length ? `.${entry.classes.join(".")}` : "";
      const id = entry.id ? `#${entry.id}` : "";
      const role = entry.role ? ` [role=${entry.role}]` : "";
      const text = entry.textPreview ? ` "${entry.textPreview}"` : "";
      return `[${entry.index}]${indent} <${entry.tag}${id}${classes}>${role}${text}`;
    })
    .join("\n");
}

export function getWireframeElementHtml(html: string, elementIndex: number): string | null {
  if (!Number.isSafeInteger(elementIndex) || elementIndex < 0) return null;
  const doc = parseDocument(html);
  const target = documentElements(doc)[elementIndex];
  return target ? target.outerHTML : null;
}

export function serializeWireframeDocument(doc: Document): string {
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

export interface SpliceResult {
  html: string;
  replacedTag: string;
}

export function spliceWireframeElement(
  html: string,
  elementIndex: number,
  replacementFragmentHtml: string,
): SpliceResult | null {
  if (!Number.isSafeInteger(elementIndex) || elementIndex < 0) return null;
  const doc = parseDocument(html);
  const target = documentElements(doc)[elementIndex];
  if (!target) return null;

  const fragmentDoc = parseDocument(replacementFragmentHtml);
  const fragmentBody = fragmentDoc.body ?? fragmentDoc.documentElement;
  const replacementNodes = Array.from(fragmentBody.childNodes).filter(
    (node) => node.nodeType === Node.ELEMENT_NODE,
  );
  if (replacementNodes.length === 0) return null;

  const adopted = replacementNodes.map((node) => doc.importNode(node, true));
  const replacedTag = target.tagName.toLowerCase();
  target.replaceWith(...adopted);
  return { html: serializeWireframeDocument(doc), replacedTag };
}

export function alignReplacementToOriginal(
  originalHtml: string,
  elementIndex: number,
  generatedHtml: string,
): string | null {
  const originalDoc = parseDocument(originalHtml);
  const target = documentElements(originalDoc)[elementIndex];
  if (!target) return null;

  const generatedDoc = parseDocument(generatedHtml);
  const generatedElements = documentElements(generatedDoc);

  let replacement: Element | null = null;
  const sameSlot = generatedElements[elementIndex];
  if (sameSlot && sameSlot.tagName === target.tagName) {
    replacement = sameSlot;
  } else {
    let bestDistance = Number.POSITIVE_INFINITY;
    generatedElements.forEach((element, index) => {
      if (element.tagName !== target.tagName) return;
      const distance = Math.abs(index - elementIndex);
      if (distance < bestDistance) {
        bestDistance = distance;
        replacement = element;
      }
    });
  }
  if (!replacement) return null;

  const adopted = originalDoc.importNode(replacement, true);
  target.replaceWith(adopted);
  return serializeWireframeDocument(originalDoc);
}
