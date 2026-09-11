import { BRIDGE_RUNTIME_MARKER } from "../bridge/runtime";
import { TOKEN_THEME_MARKER } from "../frame/token-theme";
import { WIREFRAME_THEME_MARKER } from "../frame/wireframe-theme";

export const MAX_ROUTER_HTML_BYTES = 2 * 1024 * 1024;

export type HtmlAdmissionErrorCode =
  | "invalid-html"
  | "reserved-runtime-marker"
  | "reserved-wireframe-theme-marker"
  | "reserved-token-theme-marker"
  | "html-too-large";

export interface HtmlValidationResult {
  htmlBytes: number;
  title: string;
  language: string | null;
}

export class HtmlAdmissionError extends Error {
  readonly code: HtmlAdmissionErrorCode;

  constructor(code: HtmlAdmissionErrorCode, message: string) {
    super(message);
    this.name = "HtmlAdmissionError";
    this.code = code;
  }
}

function htmlByteLength(html: string): number {
  return new TextEncoder().encode(html).byteLength;
}

/** Shared complete-document checks used by both design and wireframe modes. */
export function validateCompleteHtml(html: string): HtmlValidationResult {
  if (typeof html !== "string" || html.trim().length === 0 || html.includes("\0")) {
    throw new HtmlAdmissionError(
      "invalid-html",
      "Codex must supply a non-empty HTML document without null bytes",
    );
  }

  const htmlBytes = htmlByteLength(html);
  if (htmlBytes > MAX_ROUTER_HTML_BYTES) {
    throw new HtmlAdmissionError(
      "html-too-large",
      `HTML document is ${htmlBytes} bytes; the limit is ${MAX_ROUTER_HTML_BYTES}`,
    );
  }

  const parsed = new DOMParser().parseFromString(html, "text/html");
  if (!parsed.doctype || parsed.doctype.name.toLowerCase() !== "html") {
    throw new HtmlAdmissionError(
      "invalid-html",
      "Codex must supply a complete HTML document with an HTML doctype",
    );
  }
  if (parsed.querySelector(`[${BRIDGE_RUNTIME_MARKER}]`)) {
    throw new HtmlAdmissionError(
      "reserved-runtime-marker",
      `HTML cannot define the reserved ${BRIDGE_RUNTIME_MARKER} runtime marker`,
    );
  }
  if (parsed.querySelector(`[${WIREFRAME_THEME_MARKER}]`)) {
    throw new HtmlAdmissionError(
      "reserved-wireframe-theme-marker",
      `HTML cannot define the reserved ${WIREFRAME_THEME_MARKER} theme marker`,
    );
  }
  if (parsed.querySelector(`[${TOKEN_THEME_MARKER}]`)) {
    throw new HtmlAdmissionError(
      "reserved-token-theme-marker",
      `HTML cannot define the reserved ${TOKEN_THEME_MARKER} theme marker`,
    );
  }

  return {
    htmlBytes,
    title: parsed.title,
    language: parsed.documentElement.getAttribute("lang"),
  };
}
