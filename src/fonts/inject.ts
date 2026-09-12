/**
 * Bundled-font delivery for canvas documents.
 *
 * Mirrors `src/frame/token-theme.ts`: Canvas injects one idempotent
 * `<style>` block carrying @font-face rules at render time. The canonical
 * `DocumentEntity.srcDoc` stays byte-for-byte unchanged.
 *
 * Frame documents render inside `sandbox="allow-scripts"` srcDoc iframes,
 * whose opaque origin cannot fetch app-origin font files (font loading is
 * CORS-mode), so faces embed woff2 payloads as `data:` URIs. Only catalog
 * families actually named in the document are injected, keeping the render
 * copy small.
 */
import { FONT_CATALOG, type FontOption } from "./catalog";

/** Reserved marker for the single Canvas-owned font-face style block. */
export const FONT_FACES_MARKER = "data-design-tool-font-faces";

/** Serializes a catalog entry into @font-face rules (one per face file). */
export function buildFontFaceCss(options: FontOption[]): string {
  return options
    .flatMap((option) =>
      option.faces.map(
        (face) =>
          `@font-face{font-family:"${option.name}";font-style:${face.style};font-weight:${face.weight};font-display:swap;src:url("${face.src}") format("woff2")}`,
      ),
    )
    .join("");
}

/** Matches `font-family: …` declarations inside `<style>` blocks plus any
 *  `*font*` custom property (token themes expose families as `--x-font-*`). */
const FONT_FAMILY_DECLARATION = /(?:font-family|--[\w-]*font[\w-]*)\s*:\s*([^;}]+)/gi;

function addFamilyList(declared: Set<string>, value: string | null | undefined): void {
  for (const part of (value ?? "").split(",")) {
    const name = part.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase();
    if (name) declared.add(name);
  }
}

/**
 * Every family name the document declares: inline `style` attributes, SVG
 * `font-family` presentation attributes, and `<style>` block rules
 * (including token theme variables). Declaration-level matching keeps
 * "Geist" from matching "Geist Mono" and body copy like "Sora wins" from
 * pulling in an unused face.
 */
function declaredFamilies(document: Document): Set<string> {
  const declared = new Set<string>();
  document.querySelectorAll("[style]").forEach((element) => {
    addFamilyList(declared, (element as HTMLElement).style?.fontFamily);
  });
  document.querySelectorAll("[font-family]").forEach((element) => {
    addFamilyList(declared, element.getAttribute("font-family"));
  });
  document.querySelectorAll("style").forEach((style) => {
    for (const match of (style.textContent ?? "").matchAll(FONT_FAMILY_DECLARATION)) {
      addFamilyList(declared, match[1]);
    }
  });
  return declared;
}

function optionsFor(declared: Set<string>): FontOption[] {
  return FONT_CATALOG.filter((option) => declared.has(option.name.toLowerCase()));
}

/** Catalog families referenced by font-family declarations in the document. */
export function usedFontOptions(srcDoc: string): FontOption[] {
  if (!srcDoc.includes("font")) return [];
  return optionsFor(declaredFamilies(new DOMParser().parseFromString(srcDoc, "text/html")));
}

/**
 * @font-face CSS for catalog families named in a committed font-family value
 * — null when the stack uses no bundled font. Sent over the bridge so a font
 * picked mid-session loads inside the already-rendered frame document.
 */
export function fontFacesCssForFamilyValue(fontFamily: string | null | undefined): string | null {
  if (!fontFamily) return null;
  const names = new Set<string>();
  addFamilyList(names, fontFamily);
  const matches = optionsFor(names);
  return matches.length > 0 ? buildFontFaceCss(matches) : null;
}

function serializeDocument(document: Document): string {
  const doctype = document.doctype ? `<!doctype ${document.doctype.name}>` : "";
  return `${doctype}${document.documentElement.outerHTML}`;
}

/**
 * Adds @font-face rules for the catalog families a render-only document copy
 * uses. Idempotent: documents already carrying the marker are unchanged, and
 * documents using no catalog fonts pass through untouched.
 */
export function injectCanvasFonts(srcDoc: string): string {
  if (srcDoc.includes(FONT_FACES_MARKER) || !srcDoc.includes("font")) return srcDoc;

  const document = new DOMParser().parseFromString(srcDoc, "text/html");
  if (document.querySelector(`[${FONT_FACES_MARKER}]`)) return srcDoc;
  const used = optionsFor(declaredFamilies(document));
  if (used.length === 0) return srcDoc;

  const style = document.createElement("style");
  style.setAttribute(FONT_FACES_MARKER, "1");
  // Catalog CSS is generated from bundled data URIs, but the sink stays safe
  // on its own: a literal `</style` would end the raw-text block early.
  style.textContent = buildFontFaceCss(used).replace(/<\/style/gi, "<\\/style");

  const root = document.documentElement;
  if (!root) return srcDoc;
  const head = document.head ?? document.createElement("head");
  if (!head.parentElement) root.insertBefore(head, root.firstChild);
  head.append(style);

  return serializeDocument(document);
}

/**
 * Loads every catalog face into a live document once, so UI (the font
 * picker preview, token panel) renders real typefaces. No-op on repeat calls
 * or documents without a head.
 */
export function ensureCanvasFonts(target: Document): void {
  if (target.querySelector(`style[${FONT_FACES_MARKER}]`)) return;
  const style = target.createElement("style");
  style.setAttribute(FONT_FACES_MARKER, "1");
  style.textContent = buildFontFaceCss(FONT_CATALOG);
  target.head?.append(style);
}
