import { describe, expect, it } from "vitest";
import {
  buildDTCGDocument,
  buildThemeCssVariables,
  colorsEqual,
  createEmptyTokenStore,
  createSeedTokenStore,
  cssVariableName,
  dtcgTypeForTokenType,
  findTokenForCssValue,
  isOffSystemValue,
  resolveActiveThemeTokens,
  tokenTypeForCssProperty,
  TokenValidationError,
  validateToken,
  validateTokenStore,
  type DesignToken,
  type TokenStoreState,
} from "./index";

function colorToken(overrides: Partial<DesignToken> = {}): DesignToken {
  return {
    id: "test-accent",
    name: "color.accent.primary",
    type: "color",
    value: "#3b74c2",
    ...overrides,
  };
}

describe("token model", () => {
  it("starts empty at revision 0", () => {
    expect(createEmptyTokenStore()).toEqual({ sets: {}, themes: {}, activeThemeId: null, revision: 0 });
  });

  it("seeds light, dark, and brand themes with light active", () => {
    const store = createSeedTokenStore();
    expect(Object.keys(store.themes).sort()).toEqual(["brand", "dark", "light"]);
    expect(store.activeThemeId).toBe("light");
    expect(Object.keys(store.sets).sort()).toEqual(["brand", "core", "dark", "light"]);
  });

  it("maps token types to DTCG $type names", () => {
    expect(dtcgTypeForTokenType("color")).toBe("color");
    expect(dtcgTypeForTokenType("spacing")).toBe("dimension");
    expect(dtcgTypeForTokenType("typography")).toBe("typography");
    expect(dtcgTypeForTokenType("motion")).toBe("transition");
  });

  it("builds CSS variable names from dot paths", () => {
    expect(cssVariableName("color.accent.primary")).toBe("--color-accent-primary");
    expect(cssVariableName("typography.body", "font-size")).toBe("--typography-body-font-size");
  });
});

describe("token validation", () => {
  it("accepts a well-formed token of every type", () => {
    expect(validateToken(colorToken(), "token")).toEqual(colorToken());
    expect(validateToken({ id: "t", name: "spacing.md", type: "spacing", value: "16px" }, "t").type).toBe("spacing");
    expect(validateToken({ id: "t", name: "radius.md", type: "radius", value: "8px" }, "t").type).toBe("radius");
    expect(validateToken({ id: "t", name: "shadow.md", type: "shadow", value: "0 4px 12px rgba(0,0,0,0.12)" }, "t").type).toBe("shadow");
    expect(validateToken({ id: "t", name: "opacity.dim", type: "opacity", value: 0.5 }, "t").type).toBe("opacity");
    expect(validateToken({
      id: "t",
      name: "typography.body",
      type: "typography",
      value: { fontFamily: "Inter", fontSize: "16px" },
    }, "t").type).toBe("typography");
    expect(validateToken({
      id: "t",
      name: "motion.base",
      type: "motion",
      value: { duration: "200ms", easing: "ease-out" },
    }, "t").type).toBe("motion");
  });

  it("rejects bad ids, names, and types with typed codes", () => {
    expect(() => validateToken(colorToken({ id: "" }), "t")).toThrowError(
      expect.objectContaining({ code: "invalid-token-id" }),
    );
    expect(() => validateToken(colorToken({ name: "Color.Bad Name" }), "t")).toThrowError(
      expect.objectContaining({ code: "invalid-token-name" }),
    );
    expect(() => validateToken(colorToken({ type: "gradient" as never }), "t")).toThrowError(
      expect.objectContaining({ code: "invalid-token-type" }),
    );
  });

  it("rejects bad values per type", () => {
    expect(() => validateToken(colorToken({ value: "not a color!!" }), "t")).toThrowError(
      expect.objectContaining({ code: "invalid-token-value" }),
    );
    expect(() => validateToken(colorToken({ type: "opacity", value: 2 }), "t")).toThrowError(
      expect.objectContaining({ code: "invalid-token-value" }),
    );
    expect(() => validateToken(colorToken({ type: "spacing", value: "huge" }), "t")).toThrowError(
      expect.objectContaining({ code: "invalid-token-value" }),
    );
    expect(() => validateToken({
      id: "t",
      name: "typography.bad",
      type: "typography",
      value: { fontFamily: "Inter" },
    }, "t")).toThrowError(expect.objectContaining({ code: "invalid-token-value" }));
    expect(() => validateToken(colorToken({
      type: "motion",
      value: { duration: "soon", easing: "smoothly" },
    }), "t")).toThrowError(expect.objectContaining({ code: "invalid-token-value" }));
  });

  it("blocks executable content in shadows", () => {
    expect(() => validateToken(colorToken({ type: "shadow", value: "url(evil.png)" }), "t")).toThrowError(
      expect.objectContaining({ code: "invalid-token-value" }),
    );
  });

  it("revalidates whole stores fail-closed", () => {
    const store = createSeedTokenStore();
    expect(validateTokenStore(JSON.parse(JSON.stringify(store)), "tokens")).toEqual(store);
    expect(() => validateTokenStore({ sets: {}, themes: {}, activeThemeId: "nope", revision: 0 }, "t"))
      .toThrowError(expect.objectContaining({ code: "unknown-theme" }));
    expect(() => validateTokenStore({ sets: {}, themes: {}, activeThemeId: null, revision: -1 }, "t"))
      .toThrowError(expect.objectContaining({ code: "invalid-revision" }));
    expect(() => validateTokenStore(null, "t")).toThrowError(TokenValidationError);
  });
});

describe("theme resolution", () => {
  it("merges sets in order with later sets winning", () => {
    const resolved = resolveActiveThemeTokens(createSeedTokenStore());
    const accent = resolved.find((item) => item.token.name === "color.accent.primary");
    expect(accent?.token.value).toBe("#3b74c2");
    expect(accent?.setId).toBe("light");
  });

  it("resolves nothing without an active theme", () => {
    expect(resolveActiveThemeTokens(createEmptyTokenStore())).toEqual([]);
  });

  it("maps CSS properties to token types", () => {
    expect(tokenTypeForCssProperty("background-color")).toBe("color");
    expect(tokenTypeForCssProperty("margin-top")).toBe("spacing");
    expect(tokenTypeForCssProperty("border-radius")).toBe("radius");
    expect(tokenTypeForCssProperty("box-shadow")).toBe("shadow");
    expect(tokenTypeForCssProperty("opacity")).toBe("opacity");
    expect(tokenTypeForCssProperty("font-size")).toBe("typography");
    expect(tokenTypeForCssProperty("transition-duration")).toBe("motion");
    expect(tokenTypeForCssProperty("width")).toBeNull();
  });

  it("finds the token behind a live value", () => {
    const store = createSeedTokenStore();
    expect(findTokenForCssValue(store, "background-color", "#3b74c2")).toMatchObject({
      tokenName: "color.accent.primary",
      setId: "light",
    });
    expect(findTokenForCssValue(store, "font-size", "16px")).toMatchObject({
      tokenName: "typography.body",
    });
    expect(findTokenForCssValue(store, "background-color", "#123456")).toBeNull();
    expect(findTokenForCssValue(store, "width", "16px")).toBeNull();
  });

  it("matches colors across hex and rgb() spellings", () => {
    expect(colorsEqual("#3b74c2", "#3b74c2")).toBe(true);
    expect(colorsEqual("#3b74c2", "rgb(59, 116, 194)")).toBe(true);
    expect(colorsEqual("#fff", "rgb(255,255,255)")).toBe(true);
    expect(colorsEqual("#3b74c2", "rgba(59, 116, 194, 0.5)")).toBe(false);
    expect(colorsEqual("#3b74c2", "#e5484d")).toBe(false);
    expect(colorsEqual("red", "rgb(255, 0, 0)")).toBe(false);
  });

  it("finds hex tokens behind computed rgb() values", () => {
    const store = createSeedTokenStore();
    expect(findTokenForCssValue(store, "background-color", "rgb(59, 116, 194)")).toMatchObject({
      tokenName: "color.accent.primary",
    });
  });

  it("flags off-system values only for mappable properties", () => {
    const store = createSeedTokenStore();
    expect(isOffSystemValue(store, "background-color", "#123456")).toBe(true);
    expect(isOffSystemValue(store, "background-color", "#3b74c2")).toBe(false);
    expect(isOffSystemValue(store, "width", "123px")).toBe(false);
    expect(isOffSystemValue(store, "color", "")).toBe(false);
  });
});

describe("token exporters", () => {
  it("emits :root variables for the active theme", () => {
    const css = buildThemeCssVariables(createSeedTokenStore());
    expect(css).toContain(":root {");
    expect(css).toContain("--color-accent-primary: #3b74c2;");
    expect(css).toContain("--typography-body-font-size: 16px;");
    expect(css).toContain("--motion-base-duration: 200ms;");
    expect(buildThemeCssVariables(createEmptyTokenStore())).toBe("");
  });

  it("emits DTCG-shaped JSON grouped by name path", () => {
    const document = buildDTCGDocument(createSeedTokenStore());
    const color = document.color as Record<string, Record<string, Record<string, { $value: unknown; $type: string }>>>;
    expect(color.accent.primary.$value).toBe("#3b74c2");
    expect(color.accent.primary.$type).toBe("color");
    const spacing = document.spacing as Record<string, { $value: unknown; $type: string }>;
    expect(spacing.md).toMatchObject({ $value: "16px", $type: "dimension" });
  });

  it("keeps a token whose name is a path prefix of another token", () => {
    const store: TokenStoreState = {
      sets: {
        s: {
          id: "s",
          name: "S",
          tokens: {
            a: { id: "a", name: "color", type: "color", value: "#ffffff" },
            b: { id: "b", name: "color.accent", type: "color", value: "#e5484d" },
          },
        },
      },
      themes: { t: { id: "t", name: "T", setIds: ["s"] } },
      activeThemeId: "t",
      revision: 0,
    };
    const document = buildDTCGDocument(store);
    const color = document.color as { $value?: unknown; accent?: { $value?: unknown } };
    expect(color.$value).toBe("#ffffff");
    expect(color.accent?.$value).toBe("#e5484d");
  });
});
