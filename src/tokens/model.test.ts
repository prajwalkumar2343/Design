import { describe, expect, it } from "vitest";
import {
  TOKEN_TYPE_LABELS,
  TOKEN_TYPES,
  cssVariableReference,
  cssVariableReferenceName,
  cssVariableSuffixForProperty,
  tokenAliasReference,
  tokenAliasTarget,
} from "./model";

describe("token alias helpers", () => {
  it("extracts the target dot path only from a whole-string alias", () => {
    expect(tokenAliasTarget("{color.neutral.0}")).toBe("color.neutral.0");
    expect(tokenAliasTarget(" {color.base} ")).toBe("color.base");
    expect(tokenAliasTarget("{color.base} extra")).toBeNull();
    expect(tokenAliasTarget("color.base")).toBeNull();
    expect(tokenAliasTarget("{Color.Bad}")).toBeNull();
    expect(tokenAliasTarget(42)).toBeNull();
    expect(tokenAliasTarget(null)).toBeNull();
  });

  it("builds the alias string for a token name", () => {
    expect(tokenAliasReference("color.neutral.0")).toBe("{color.neutral.0}");
  });
});

describe("css variable reference helpers", () => {
  it("formats var(--x) references with an optional composite suffix", () => {
    expect(cssVariableReference("color.accent.primary")).toBe("var(--color-accent-primary)");
    expect(cssVariableReference("typography.body", "font-size")).toBe(
      "var(--typography-body-font-size)",
    );
    expect(cssVariableReference("motion.base", "easing")).toBe("var(--motion-base-easing)");
  });

  it("reads the variable name back out of var() strings", () => {
    expect(cssVariableReferenceName("var(--color-accent-primary)")).toBe("color-accent-primary");
    expect(cssVariableReferenceName("var( --X , #fff)")).toBe("x");
    expect(cssVariableReferenceName("var(--a, var(--b))")).toBeNull();
    expect(cssVariableReferenceName("#fff")).toBeNull();
    expect(cssVariableReferenceName(7)).toBeNull();
  });

  it("maps composite CSS properties to variable suffixes", () => {
    expect(cssVariableSuffixForProperty("font-size")).toBe("font-size");
    expect(cssVariableSuffixForProperty("letter-spacing")).toBe("letter-spacing");
    expect(cssVariableSuffixForProperty("transition-duration")).toBe("duration");
    expect(cssVariableSuffixForProperty("animation-timing-function")).toBe("easing");
    expect(cssVariableSuffixForProperty("color")).toBeNull();
    expect(cssVariableSuffixForProperty("font")).toBeNull();
  });
});

describe("TOKEN_TYPE_LABELS", () => {
  it("labels every registered token type", () => {
    expect(Object.keys(TOKEN_TYPE_LABELS).sort()).toEqual([...TOKEN_TYPES].sort());
    expect(TOKEN_TYPE_LABELS.motion).toBe("Motion");
  });
});
