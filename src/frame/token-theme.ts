/**
 * Canvas-owned design-token theme injection (design mode only).
 *
 * Mirrors `src/frame/wireframe-theme.ts`: Canvas injects one idempotent
 * `<style>` block carrying the active theme's CSS variables at render time.
 * The canonical `DocumentEntity.srcDoc` stays byte-for-byte unchanged, and
 * wireframe frames never receive token CSS — they keep the neutral grayscale
 * theme. Agent HTML must not define this marker; both admission paths reject
 * it as a reserved marker.
 */
/** Reserved marker for the single Canvas-owned token theme style block. */
export const TOKEN_THEME_MARKER = "data-design-tool-token-theme";

/** Upper bound for injected theme CSS; oversized input renders unthemed. */
export const TOKEN_CSS_BYTE_LIMIT = 256 * 1024;

function serializeDocument(document: Document): string {
  const doctype = document.doctype ? `<!doctype ${document.doctype.name}>` : "";
  return `${doctype}${document.documentElement.outerHTML}`;
}

/**
 * Adds the active theme's `:root` variables to a render-only HTML copy.
 * Idempotent: documents already carrying the marker are returned unchanged.
 */
export function injectTokenTheme(srcDoc: string, cssText: string): string {
  if (!cssText || cssText.trim().length === 0) return srcDoc;
  if (cssText.length > TOKEN_CSS_BYTE_LIMIT) return srcDoc;
  const document = new DOMParser().parseFromString(srcDoc, "text/html");
  if (document.querySelector(`[${TOKEN_THEME_MARKER}]`)) return srcDoc;

  const style = document.createElement("style");
  style.setAttribute(TOKEN_THEME_MARKER, "1");
  // Defense in depth: the HTML parser ends a raw-text style block at the
  // literal bytes `</style`, which serialization (outerHTML) would otherwise
  // preserve from hostile input. Validation already rejects angle brackets,
  // but the sink must be safe on its own.
  style.textContent = cssText.replace(/<\/style/gi, "<\\/style");

  const root = document.documentElement;
  if (!root) return srcDoc;
  const head = document.head ?? document.createElement("head");
  if (!head.parentElement) root.insertBefore(head, root.firstChild);
  head.append(style);

  return serializeDocument(document);
}
