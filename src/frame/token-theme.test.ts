import { describe, expect, it } from "vitest";
import { createSeedTokenStore } from "../tokens";
import { buildThemeCssVariables } from "../tokens";
import { injectTokenTheme, TOKEN_THEME_MARKER } from "./token-theme";

const designHtml = "<!doctype html><html><head><title>T</title></head><body><main>Hi</main></body></html>";

describe("injectTokenTheme", () => {
  it("adds one marked style block with the theme variables", () => {
    const css = buildThemeCssVariables(createSeedTokenStore());
    const injected = injectTokenTheme(designHtml, css);
    expect(injected).toContain(`${TOKEN_THEME_MARKER}="1"`);
    expect(injected).toContain("--color-accent-primary: #3b74c2;");
    // Canonical source stays unchanged; injection is render-only.
    expect(designHtml).not.toContain(TOKEN_THEME_MARKER);
  });

  it("is idempotent", () => {
    const css = buildThemeCssVariables(createSeedTokenStore());
    const once = injectTokenTheme(designHtml, css);
    expect(injectTokenTheme(once, css)).toBe(once);
  });

  it("renders unthemed when there is no theme CSS", () => {
    expect(injectTokenTheme(designHtml, "")).toBe(designHtml);
  });
});

describe("injectTokenTheme limits", () => {
  it("renders unthemed when theme CSS exceeds the byte limit", async () => {
    const { TOKEN_CSS_BYTE_LIMIT } = await import("./token-theme");
    const oversized = `:root{--x:${"a".repeat(TOKEN_CSS_BYTE_LIMIT)}}`;
    expect(oversized.length).toBeGreaterThan(TOKEN_CSS_BYTE_LIMIT);
    expect(injectTokenTheme(designHtml, oversized)).toBe(designHtml);
  });
});

describe("injectTokenTheme safety", () => {
  it("cannot break out of the style element with hostile CSS text", () => {
    const hostile = ":root{--x: a;}</style><script>alert(1)</script><style>";
    const injected = injectTokenTheme(designHtml, hostile);
    const parsed = new DOMParser().parseFromString(injected, "text/html");
    expect(parsed.querySelector("script")).toBeNull();
    expect(parsed.querySelectorAll(`[${TOKEN_THEME_MARKER}]`)).toHaveLength(1);
  });

  it("rejects markup in token values at the validation boundary", async () => {
    const { validateToken, TokenValidationError } = await import("../tokens/validation");
    for (const token of [
      { id: "t1", name: "typography.bad", type: "typography", value: { fontFamily: "x", fontSize: "y</style>" } },
      { id: "t2", name: "shadow.bad", type: "shadow", value: "0 1px <b>2px</b>" },
      { id: "t3", name: "spacing.bad", type: "spacing", value: "8px>" },
    ]) {
      let error: unknown = null;
      try {
        validateToken(token, "t");
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(TokenValidationError);
      expect((error as { code: string }).code).toBe("invalid-token-value");
    }
  });
});
