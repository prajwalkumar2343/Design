import { describe, expect, it } from "vitest";
import {
  TokenValidationError,
  validateTokenId,
  validateTokenName,
  validateTokenRevision,
  validateTokenTheme,
  validateTokenType,
  validateTokenValue,
} from "./validation";

describe("TokenValidationError", () => {
  it("carries the stable code, the path, and a path-prefixed message", () => {
    try {
      validateTokenId("", "tokens.sets.x");
      throw new Error("unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(TokenValidationError);
      const typed = error as TokenValidationError;
      expect(typed.code).toBe("invalid-token-id");
      expect(typed.path).toBe("tokens.sets.x");
      expect(typed.message).toMatch(/^tokens\.sets\.x: /);
      expect(typed.name).toBe("TokenValidationError");
    }
  });
});

describe("validateTokenId", () => {
  it("accepts kebab-ish ids and rejects malformed ones", () => {
    expect(validateTokenId("core-neutral_0", "p")).toBe("core-neutral_0");
    for (const bad of ["", "has space", "a".repeat(129), 7, null]) {
      expect(() => validateTokenId(bad, "p")).toThrowError(
        expect.objectContaining({ code: "invalid-token-id" }),
      );
    }
  });
});

describe("validateTokenName", () => {
  it("accepts 1-4 kebab segments and rejects deeper or malformed paths", () => {
    expect(validateTokenName("color.accent-2.9.d", "p")).toBe("color.accent-2.9.d");
    for (const bad of ["a.b.c.d.e", "A.b", "a..b", "", "a" + ".b".repeat(80), 12]) {
      expect(() => validateTokenName(bad, "p")).toThrowError(
        expect.objectContaining({ code: "invalid-token-name" }),
      );
    }
  });
});

describe("validateTokenType", () => {
  it("accepts registered types and rejects unknown ones", () => {
    expect(validateTokenType("color", "p")).toBe("color");
    expect(validateTokenType("motion", "p")).toBe("motion");
    expect(() => validateTokenType("gradient", "p")).toThrowError(
      expect.objectContaining({ code: "invalid-token-type" }),
    );
  });
});

describe("validateTokenValue", () => {
  it("rejects angle brackets anywhere inside a token value", () => {
    expect(() =>
      validateTokenValue("typography", { fontFamily: "Inter<x>", fontSize: "16px" }, "v"),
    ).toThrowError(expect.objectContaining({ code: "invalid-token-value" }));
    expect(() => validateTokenValue("shadow", "0 0 0 </style><script>", "v")).toThrowError(
      expect.objectContaining({ code: "invalid-token-value" }),
    );
  });

  it("allows auto only for spacing, never for radius", () => {
    expect(validateTokenValue("spacing", "auto", "v")).toBe("auto");
    expect(() => validateTokenValue("radius", "auto", "v")).toThrowError(
      expect.objectContaining({ code: "invalid-token-value" }),
    );
  });

  it("keeps opacity strictly numeric and motion well-formed", () => {
    expect(() => validateTokenValue("opacity", "0.5", "v")).toThrowError(
      expect.objectContaining({ code: "invalid-token-value" }),
    );
    expect(
      validateTokenValue("motion", { duration: "0.3s", easing: "cubic-bezier(0,0,1,1)" }, "v"),
    ).toEqual({ duration: "0.3s", easing: "cubic-bezier(0,0,1,1)" });
    expect(() =>
      validateTokenValue("motion", { duration: "200ms", easing: "ease-out", extra: 1 }, "v"),
    ).toThrowError(expect.objectContaining({ code: "invalid-token-value" }));
  });
});

describe("validateTokenTheme", () => {
  it("returns a normalized theme for valid input", () => {
    expect(
      validateTokenTheme({ id: "t", name: "T", setIds: ["core", "dark"] }, "p"),
    ).toEqual({ id: "t", name: "T", setIds: ["core", "dark"] });
  });

  it("rejects duplicate, empty, and unknown set references", () => {
    expect(() =>
      validateTokenTheme({ id: "t", name: "T", setIds: ["core", "core"] }, "p"),
    ).toThrowError(expect.objectContaining({ code: "invalid-theme-sets" }));
    expect(() => validateTokenTheme({ id: "t", name: "T", setIds: [] }, "p")).toThrowError(
      expect.objectContaining({ code: "invalid-theme-sets" }),
    );
    expect(() =>
      validateTokenTheme({ id: "t", name: "T", setIds: ["ghost"] }, "p", new Set(["core"])),
    ).toThrowError(expect.objectContaining({ code: "unknown-set" }));
    expect(() => validateTokenTheme({ id: "t", name: " ", setIds: ["core"] }, "p")).toThrowError(
      expect.objectContaining({ code: "invalid-theme-name" }),
    );
  });
});

describe("validateTokenRevision", () => {
  it("accepts safe non-negative integers only", () => {
    expect(validateTokenRevision(0, "p")).toBe(0);
    expect(validateTokenRevision(41, "p")).toBe(41);
    for (const bad of [-1, 1.5, NaN, "3", Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => validateTokenRevision(bad, "p")).toThrowError(
        expect.objectContaining({ code: "invalid-revision" }),
      );
    }
  });
});
