import { describe, expect, it } from "vitest";
import { createBridgeRuntimeSource } from "./runtime";

describe("createBridgeRuntimeSource", () => {
  it("emits a runtime script that parses as valid JavaScript", () => {
    const source = createBridgeRuntimeSource({
      parentOrigin: "http://localhost:5173",
      channel: "test-channel",
      frameId: "frame-1",
    });
    expect(() => new Function(source)).not.toThrow();
  });

  it("keeps regex escapes intact inside the template literal", () => {
    const source = createBridgeRuntimeSource({
      parentOrigin: "http://localhost:5173",
      channel: "test-channel",
      frameId: "frame-1",
    });
    expect(source).toContain("/^rgba?\\(\\s*(\\d+)[\\s,]+(\\d+)[\\s,]+(\\d+)");
    expect(source).toContain("url\\s*\\(");
  });

  it("carries glass through snapshots, replays, and restores", () => {
    const source = createBridgeRuntimeSource({
      parentOrigin: "http://localhost:5173",
      channel: "test-channel",
      frameId: "frame-1",
    });
    expect(source).toContain("data-design-tool-glass");
    expect(source).toContain("glass: (() => {");
    expect(source).toContain("applyVectorGlass(element, specGlass)");
    expect(source).toContain("applySurfaceGlass(element, specGlass)");
  });
});
