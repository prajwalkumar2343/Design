import { describe, expect, it } from "vitest";
import {
  buildDTCGDocument,
  buildThemeCssVariables,
  colorsEqual,
  createEmptyTokenStore,
  createSeedTokenStore,
  cssVariableName,
  cssVariableReferenceForProperty,
  dtcgTypeForTokenType,
  findTokenForCssValue,
  isCssVariableReference,
  isOffSystemValue,
  isTokenAlias,
  isUnresolvedCssReference,
  resolveActiveThemeToken,
  resolveActiveThemeTokens,
  rewriteTokenCssReference,
  tokenNameCandidatesForCssVariable,
  tokenScalarForCssProperty,
  tokenTypeForCssProperty,
  TokenValidationError,
  validateToken,
  validateTokenSet,
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

  it("rejects duplicate token names inside one set", () => {
    expect(() => validateTokenSet({
      id: "s",
      name: "S",
      tokens: {
        a: { id: "a", name: "color.accent", type: "color", value: "#ffffff" },
        b: { id: "b", name: "color.accent", type: "color", value: "#e5484d" },
      },
    }, "set")).toThrowError(expect.objectContaining({ code: "duplicate-token" }));
    // Distinct names still pass.
    expect(validateTokenSet({
      id: "s",
      name: "S",
      tokens: {
        a: { id: "a", name: "color.accent", type: "color", value: "#ffffff" },
        b: { id: "b", name: "color.muted", type: "color", value: "#e5484d" },
      },
    }, "set").tokens.b.name).toBe("color.muted");
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
    expect(tokenTypeForCssProperty("border-width")).toBe("spacing");
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
    expect(colorsEqual("red", "rgb(255, 0, 0)")).toBe(true);
    expect(colorsEqual("hsl(0, 100%, 50%)", "rgb(255, 0, 0)")).toBe(true);
    expect(colorsEqual("hsl(120, 100%, 25%)", "rgb(0, 128, 0)")).toBe(true);
    expect(colorsEqual("rgb(100%, 0%, 0%)", "rgb(255, 0, 0)")).toBe(true);
    expect(colorsEqual("transparent", "rgba(0, 0, 0, 0)")).toBe(true);
    expect(colorsEqual("rebeccapurple", "rgb(102, 51, 153)")).toBe(true);
    expect(colorsEqual("hsl(120, 100%, 50%)", "rgb(0, 0, 255)")).toBe(false);
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

describe("token aliases", () => {
  function storeWithAlias(overrides: Partial<DesignToken> = {}): TokenStoreState {
    return {
      sets: {
        s: {
          id: "s",
          name: "S",
          tokens: {
            base: { id: "base", name: "color.base", type: "color", value: "#3b74c2" },
            alias: { id: "alias", name: "color.brand", type: "color", value: "{color.base}", ...overrides },
          },
        },
      },
      themes: { t: { id: "t", name: "T", setIds: ["s"] } },
      activeThemeId: "t",
      revision: 0,
    };
  }

  it("recognises alias syntax and validates it for scalar types", () => {
    expect(isTokenAlias("{color.base}")).toBe(true);
    expect(isTokenAlias("{color.base")).toBe(false);
    expect(isTokenAlias("{color.base} solid")).toBe(false);
    expect(validateToken(colorToken({ value: "{color.base}" }), "t").value).toBe("{color.base}");
    expect(() => validateToken(colorToken({ value: "{Color.Bad Path}" }), "t")).toThrowError(
      expect.objectContaining({ code: "invalid-token-value" }),
    );
  });

  it("resolves aliases to concrete values through the active theme", () => {
    const store = storeWithAlias();
    const resolved = resolveActiveThemeTokens(store).find((item) => item.token.id === "alias");
    expect(resolved?.resolvedValue).toBe("#3b74c2");
    expect(resolved?.aliasOf).toBe("color.base");
    expect(resolved?.aliasStatus).toBeUndefined();
    expect(resolveActiveThemeToken(store, "color.brand")?.resolvedValue).toBe("#3b74c2");
  });

  it("flags dangling and cyclic aliases without throwing", () => {
    const dangling = storeWithAlias({ value: "{color.missing}" });
    expect(resolveActiveThemeTokens(dangling).find((item) => item.token.id === "alias")?.aliasStatus).toBe("dangling");

    const cyclic: TokenStoreState = {
      sets: {
        s: {
          id: "s",
          name: "S",
          tokens: {
            a: { id: "a", name: "color.a", type: "color", value: "{color.b}" },
            b: { id: "b", name: "color.b", type: "color", value: "{color.a}" },
          },
        },
      },
      themes: { t: { id: "t", name: "T", setIds: ["s"] } },
      activeThemeId: "t",
      revision: 0,
    };
    const entries = resolveActiveThemeTokens(cyclic);
    expect(entries.find((item) => item.token.id === "a")?.aliasStatus).toBe("cyclic");
    expect(entries.find((item) => item.token.id === "b")?.aliasStatus).toBe("cyclic");
  });

  it("matches live values against resolved alias values", () => {
    const store = storeWithAlias();
    expect(findTokenForCssValue(store, "background-color", "#3b74c2")).toBeTruthy();
    const css = buildThemeCssVariables(store);
    expect(css).toContain("--color-brand: var(--color-base);");
    const document = buildDTCGDocument(store);
    expect((document.color as Record<string, { $value: unknown }>).brand.$value).toBe("{color.base}");
  });
});

describe("css variable references", () => {
  it("detects and parses var() references", () => {
    expect(isCssVariableReference("var(--color-accent-primary)")).toBe(true);
    expect(isCssVariableReference("var(--x, #fff)")).toBe(true);
    expect(isCssVariableReference("#3b74c2")).toBe(false);
    expect(cssVariableReferenceForProperty("color.accent.primary", "background-color")).toBe("var(--color-accent-primary)");
    expect(cssVariableReferenceForProperty("typography.body", "font-size")).toBe("var(--typography-body-font-size)");
    expect(cssVariableReferenceForProperty("typography.body", "line-height")).toBe("var(--typography-body-line-height)");
    expect(cssVariableReferenceForProperty("motion.base", "transition-duration")).toBe("var(--motion-base-duration)");
  });

  it("maps var names back to token-name candidates", () => {
    expect(tokenNameCandidatesForCssVariable("var(--color-accent-primary)")).toEqual(["color.accent.primary"]);
    expect(tokenNameCandidatesForCssVariable("var(--typography-body-font-size)")).toEqual([
      "typography.body.font.size",
      "typography.body",
    ]);
    expect(tokenNameCandidatesForCssVariable("16px")).toEqual([]);
  });

  it("treats var(--token) styles as durable links", () => {
    const store = createSeedTokenStore();
    expect(findTokenForCssValue(store, "background-color", "var(--color-accent-primary)")).toMatchObject({
      tokenName: "color.accent.primary",
      via: "reference",
    });
    expect(findTokenForCssValue(store, "font-size", "var(--typography-body-font-size)")).toMatchObject({
      tokenName: "typography.body",
      via: "reference",
    });
    expect(findTokenForCssValue(store, "border-width", "var(--spacing-md)")).toMatchObject({
      tokenName: "spacing.md",
      via: "reference",
    });
  });

  it("keeps var() styles out of the off-system flag", () => {
    const store = createSeedTokenStore();
    expect(isOffSystemValue(store, "background-color", "var(--color-accent-primary)")).toBe(false);
    expect(isOffSystemValue(store, "background-color", "var(--doc-own-var)")).toBe(false);
    expect(isUnresolvedCssReference(store, "var(--doc-own-var)")).toBe(true);
    expect(isUnresolvedCssReference(store, "var(--color-accent-primary)")).toBe(false);
    expect(isUnresolvedCssReference(store, "#3b74c2")).toBe(false);
  });

  it("extracts per-property scalars for detach", () => {
    expect(tokenScalarForCssProperty("color", "#3b74c2", "background-color")).toBe("#3b74c2");
    expect(tokenScalarForCssProperty("opacity", 0.5, "opacity")).toBe("0.5");
    expect(
      tokenScalarForCssProperty("typography", { fontFamily: "Inter", fontSize: "16px", fontWeight: "650" }, "font-weight"),
    ).toBe("650");
    expect(
      tokenScalarForCssProperty("motion", { duration: "200ms", easing: "ease-out" }, "transition-timing-function"),
    ).toBe("ease-out");
  });

  it("rewrites var() references on rename without touching lookalikes", () => {
    const html = '<div style="color: var(--color-accent-primary); background: var(--color-accent-primary-2); border-radius: var(--radius-md)"></div><style>:root{--color-accent-primary:#000;}</style>';
    const next = rewriteTokenCssReference(html, "color.accent.primary", "color.accent.main");
    expect(next).toContain("var(--color-accent-main)");
    expect(next).toContain("var(--color-accent-primary-2)");
    expect(next).toContain("--color-accent-main:#000;");
    expect(rewriteTokenCssReference("x", "color.a", "color.b")).toBe("x");
    // Composite suffixes follow the rename too.
    expect(rewriteTokenCssReference("font-size: var(--typography-body-font-size)", "typography.body", "type.body"))
      .toBe("font-size: var(--type-body-font-size)");
  });
});
