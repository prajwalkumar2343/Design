import { describe, expect, it } from "vitest";

import { prependTranslationTransform } from "./position";

describe("panel position transforms", () => {
  it("preserves an existing transform while adding the requested positional delta", () => {
    expect(prependTranslationTransform("translate(42px, 0px)", { x: 70, y: -3.5 })).toBe(
      "translate(70px, -3.5px) translate(42px, 0px)",
    );
  });

  it("returns no transform for an unchanged untransformed position", () => {
    expect(prependTranslationTransform("none", { x: 0, y: 0 })).toBeNull();
  });
});
