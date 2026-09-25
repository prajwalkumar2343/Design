import { describe, expect, it } from "vitest";
import {
  cssReferenceForTokenProperty,
  findTokenForCssValue,
  normalizeCssValue,
  resolveActiveThemeToken,
  tokenScalarForCssProperty,
} from "./resolve";
import { createSeedTokenStore } from "./seeds";
import type { DesignToken } from "./model";

describe("normalizeCssValue", () => {
  it("trims and collapses internal whitespace runs", () => {
    expect(normalizeCssValue("  0   4px   rgba(0,  0, 0, .5) ")).toBe("0 4px rgba(0, 0, 0, .5)");
    expect(normalizeCssValue("16px")).toBe("16px");
  });
});

describe("cssReferenceForTokenProperty", () => {
  it("emits the var() that links a token to a CSS property", () => {
    const typography: DesignToken = {
      id: "t",
      name: "typography.body",
      type: "typography",
      value: { fontFamily: "Inter", fontSize: "16px" },
    };
    expect(cssReferenceForTokenProperty(typography, "font-size")).toBe(
      "var(--typography-body-font-size)",
    );
    expect(cssReferenceForTokenProperty(typography, "font-family")).toBe(
      "var(--typography-body-font-family)",
    );
    const color: DesignToken = { id: "c", name: "color.accent", type: "color", value: "#ffffff" };
    expect(cssReferenceForTokenProperty(color, "background-color")).toBe("var(--color-accent)");
  });
});

describe("findTokenForCssValue edges", () => {
  it("ignores blank values and resolves var() links on unmapped properties", () => {
    const store = createSeedTokenStore();
    expect(findTokenForCssValue(store, "color", "   ")).toBeNull();
    expect(findTokenForCssValue(store, "width", "var(--spacing-md)")).toMatchObject({
      tokenName: "spacing.md",
      via: "reference",
    });
  });
});

describe("resolveActiveThemeToken", () => {
  it("returns null for names outside the active theme", () => {
    const store = createSeedTokenStore();
    expect(resolveActiveThemeToken(store, "color.accent.primary")?.token.id).toBe(
      "light-accent-primary",
    );
    expect(resolveActiveThemeToken(store, "color.nope")).toBeNull();
  });
});

describe("tokenScalarForCssProperty", () => {
  it("returns null when a composite token has no field for the property", () => {
    expect(
      tokenScalarForCssProperty(
        "typography",
        { fontFamily: "Inter", fontSize: "16px" },
        "color",
      ),
    ).toBeNull();
    expect(
      tokenScalarForCssProperty(
        "motion",
        { duration: "200ms", easing: "ease-out" },
        "font-size",
      ),
    ).toBeNull();
    expect(
      tokenScalarForCssProperty(
        "typography",
        { fontFamily: "Inter", fontSize: "16px" },
        "font-weight",
      ),
    ).toBeNull();
  });
});
