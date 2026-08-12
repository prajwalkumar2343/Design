import { describe, expect, it } from "vitest";
import { BRIDGE_RUNTIME_MARKER, createBridgeRuntimeSource } from "./runtime";
import { injectBridgeRuntime } from "./inject";

const config = {
  channel: "frame-desktop-channel",
  frameId: "desktop",
  parentOrigin: "http://127.0.0.1:4173",
};

describe("iframe bridge runtime injection", () => {
  it("injects before existing document content and preserves arbitrary source", () => {
    const source = "<!doctype html><html><head><title>Demo</title></head><body><main>Hello</main></body></html>";
    const injected = injectBridgeRuntime(source, config);

    expect(injected).toContain(`${BRIDGE_RUNTIME_MARKER}="1"`);
    expect(injected).toContain("<main>Hello</main>");
    expect(injected.indexOf(BRIDGE_RUNTIME_MARKER)).toBeLessThan(injected.indexOf("<title>Demo</title>"));
    expect(injected).not.toContain("allow-same-origin");
    expect(injectBridgeRuntime(injected, config)).toBe(injected);
  });

  it("escapes script-breaking configuration characters", () => {
    const source = createBridgeRuntimeSource({
      ...config,
      frameId: "frame</script><script>bad",
    });

    expect(source).not.toContain("</script>");
    expect(source).toContain("\\u003C");
  });
});

