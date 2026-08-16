/** Reserved marker for the single Canvas-owned wireframe theme style block. */
export const WIREFRAME_THEME_MARKER = "data-design-tool-wireframe-theme";

export const WIREFRAME_THEME_CSS = `
:root {
  color-scheme: light !important;
  color: #252525 !important;
  background-color: #ffffff !important;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
}

html,
body {
  color: #252525 !important;
  background-color: #ffffff !important;
}

:where(main, header, nav, section, article, aside, footer) {
  outline: 1px dashed #b5b5b5 !important;
  outline-offset: -1px !important;
}

:where(form, fieldset, table) {
  outline: 1px solid #c8c8c8 !important;
  outline-offset: -1px !important;
}

:where(h1, h2, h3, h4, h5, h6, p, li, dt, dd) {
  color: #252525 !important;
}

:where(button, input, select, textarea) {
  color: #252525 !important;
  background-color: #f5f5f5 !important;
  outline: 1px solid #858585 !important;
  font-family: inherit !important;
}

:where(a) {
  color: #3f3f3f !important;
  text-decoration: underline !important;
  text-decoration-color: #858585 !important;
}

:where(table, th, td) {
  color: #252525 !important;
  background-color: #fafafa !important;
}

:where(th, td) {
  outline: 1px solid #d0d0d0 !important;
}

*,
*::before,
*::after {
  animation: none !important;
  transition: none !important;
  box-shadow: none !important;
  filter: none !important;
  transform: none !important;
}
`;

function serializeDocument(document: Document): string {
  const doctype = document.doctype ? `<!doctype ${document.doctype.name}>` : "";
  return `${doctype}${document.documentElement.outerHTML}`;
}

/** Adds Canvas-owned presentation to a render-only HTML copy. */
export function injectWireframeTheme(srcDoc: string): string {
  const document = new DOMParser().parseFromString(srcDoc, "text/html");
  if (document.querySelector(`[${WIREFRAME_THEME_MARKER}]`)) return srcDoc;

  const style = document.createElement("style");
  style.setAttribute(WIREFRAME_THEME_MARKER, "1");
  style.textContent = WIREFRAME_THEME_CSS;

  const root = document.documentElement;
  if (!root) return srcDoc;
  const head = document.head ?? document.createElement("head");
  if (!head.parentElement) root.insertBefore(head, root.firstChild);
  head.append(style);

  return serializeDocument(document);
}
