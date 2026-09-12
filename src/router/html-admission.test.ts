import { describe, expect, it } from "vitest";
import { BRIDGE_RUNTIME_MARKER } from "../bridge/runtime";
import { TOKEN_THEME_MARKER } from "../frame/token-theme";
import { WIREFRAME_THEME_MARKER } from "../frame/wireframe-theme";
import {
  HtmlAdmissionError,
  MAX_ROUTER_HTML_BYTES,
  validateCompleteHtml,
} from "./html-admission";

const VALID_DOC = "<!doctype html><html><head><title>Hi</title></head><body><p>x</p></body></html>";

function expectAdmissionError(html: string, code: string) {
  try {
    validateCompleteHtml(html);
  } catch (error) {
    expect(error).toBeInstanceOf(HtmlAdmissionError);
    expect((error as HtmlAdmissionError).code).toBe(code);
    return;
  }
  throw new Error(`Expected HtmlAdmissionError(${code}) for ${JSON.stringify(html.slice(0, 60))}`);
}

describe("validateCompleteHtml", () => {
  it("accepts a complete document and reports bytes, title, and language", () => {
    const result = validateCompleteHtml(
      '<!doctype html><html lang="en"><head><title>Hello</title></head><body></body></html>',
    );
    expect(result.title).toBe("Hello");
    expect(result.language).toBe("en");
    expect(result.htmlBytes).toBeGreaterThan(0);
  });

  it("rejects empty, whitespace-only, and null-byte documents", () => {
    expectAdmissionError("", "invalid-html");
    expectAdmissionError("   \n\t  ", "invalid-html");
    expectAdmissionError(`<!doctype html><html><body>\0</body></html>`, "invalid-html");
  });

  it("rejects fragments and documents without an html doctype", () => {
    expectAdmissionError("<p>just a fragment</p>", "invalid-html");
    expectAdmissionError("<html><body>no doctype</body></html>", "invalid-html");
    expectAdmissionError("<!doctype svg><svg/>", "invalid-html");
    // doctype must survive the actual parse — a comment that looks like one doesn't count
    expectAdmissionError("<!-- <!doctype html> --><html><body>x</body></html>", "invalid-html");
  });

  it("rejects documents over the 2MB byte cap using real byte length", () => {
    // Multibyte characters must count by bytes, not string length.
    const padding = "界".repeat(Math.ceil(MAX_ROUTER_HTML_BYTES / 3));
    expectAdmissionError(`<!doctype html><html><body>${padding}</body></html>`, "html-too-large");
  });

  it("rejects documents carrying the reserved bridge runtime marker", () => {
    expectAdmissionError(
      `<!doctype html><html><body><div ${BRIDGE_RUNTIME_MARKER}></div></body></html>`,
      "reserved-runtime-marker",
    );
  });

  it("rejects documents carrying reserved theme markers", () => {
    expectAdmissionError(
      `<!doctype html><html><head><style ${WIREFRAME_THEME_MARKER}></style></head><body></body></html>`,
      "reserved-wireframe-theme-marker",
    );
    expectAdmissionError(
      `<!doctype html><html><head><style ${TOKEN_THEME_MARKER}></style></head><body></body></html>`,
      "reserved-token-theme-marker",
    );
  });

  it("does not confuse marker-like text content with a real marker attribute", () => {
    const result = validateCompleteHtml(
      `<!doctype html><html><body><p>mentions ${BRIDGE_RUNTIME_MARKER} in prose</p></body></html>`,
    );
    expect(result.htmlBytes).toBeGreaterThan(0);
  });

  it("counts a minimal valid document under the cap", () => {
    const result = validateCompleteHtml(VALID_DOC);
    expect(result.htmlBytes).toBe(new TextEncoder().encode(VALID_DOC).byteLength);
  });
});
