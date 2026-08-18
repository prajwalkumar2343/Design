import { describe, expect, it } from "vitest";

import {
  getToolForShortcut,
  isToolAvailable,
  normalizeActiveTool,
  TOOL_REGISTRY,
} from "./tools";

describe("editor tool registry", () => {
  it("registers the complete professional tool surface", () => {
    expect(TOOL_REGISTRY.map((tool) => tool.id)).toEqual([
      "select",
      "hand",
      "frame",
      "rectangle",
      "text",
      "image",
      "comment",
    ]);
  });

  it("enables the registered creation tools", () => {
    expect(TOOL_REGISTRY.filter(isToolAvailable).map((tool) => tool.id)).toEqual([
      "select",
      "hand",
      "frame",
      "rectangle",
      "text",
      "image",
      "comment",
    ]);
  });

  it("resolves unique keyboard shortcuts without exposing duplicate bindings", () => {
    expect(getToolForShortcut("v")?.id).toBe("select");
    expect(getToolForShortcut("H")?.id).toBe("hand");
    expect(getToolForShortcut("f")?.id).toBe("frame");
    expect(getToolForShortcut("i")?.id).toBe("image");
    expect(getToolForShortcut(" ")).toBeUndefined();
  });

  it("normalizes the legacy pan state to the hand capability", () => {
    expect(normalizeActiveTool("pan")).toBe("hand");
    expect(normalizeActiveTool("select")).toBe("select");
  });
});
