import { describe, expect, it } from "vitest";
import {
  CUSTOM_SHADER_IDS,
  PAPER_SHADER_IDS,
  SHADER_IDS,
  UnsupportedPaperShaderError,
  detectPaperShaderSupport,
  getPaperShaderDefinition,
  getShaderDefinition,
  isCustomShaderId,
  isShaderId,
  loadPaperShader,
} from "./registry";

describe("Paper Shader registry", () => {
  it("resolves every registered shader to its upstream component and presets", async () => {
    const upstream = await import("@paper-design/shaders-react");

    for (const shaderId of PAPER_SHADER_IDS) {
      const loaded = await loadPaperShader(shaderId);

      expect(loaded.Component).toBe(
        upstream[loaded.definition.componentExport],
      );
      expect(loaded.presets).toBe(upstream[loaded.definition.presetsExport]);
      expect(loaded.presets.length).toBeGreaterThan(0);
    }
  });

  it("rejects unsupported shader identifiers at the boundary", () => {
    expect(() => getPaperShaderDefinition("unknown-effect")).toThrowError(
      new UnsupportedPaperShaderError("unknown-effect"),
    );
  });

  it("rejects an unsupported identifier before attempting to load it", async () => {
    await expect(
      loadPaperShader("unknown-effect" as never),
    ).rejects.toBeInstanceOf(UnsupportedPaperShaderError);
  });
});

describe("detectPaperShaderSupport", () => {
  it("reports support when WebGL2 is available and releases the probe context", () => {
    let contextWasReleased = false;
    const canvas = {
      getContext: () => ({
        getExtension: () => ({
          loseContext: () => {
            contextWasReleased = true;
          },
        }),
      }),
    } as unknown as HTMLCanvasElement;

    expect(detectPaperShaderSupport({ createCanvas: () => canvas })).toEqual({
      supported: true,
    });
    expect(contextWasReleased).toBe(true);
  });

  it("reports an unavailable WebGL2 context without loading a shader", () => {
    const canvas = {
      getContext: () => null,
    } as unknown as HTMLCanvasElement;

    expect(detectPaperShaderSupport({ createCanvas: () => canvas })).toEqual({
      supported: false,
      reason: "webgl2-unavailable",
    });
  });
});

describe("custom shaders", () => {
  it("registers Ferro Tide alongside the Paper catalog", () => {
    expect(CUSTOM_SHADER_IDS).toEqual(["ferro-tide"]);
    expect(SHADER_IDS).toContain("ferro-tide");
    expect(SHADER_IDS.length).toBe(PAPER_SHADER_IDS.length + CUSTOM_SHADER_IDS.length);
    expect(isCustomShaderId("ferro-tide")).toBe(true);
    expect(isCustomShaderId("mesh-gradient")).toBe(false);
    expect(isShaderId("ferro-tide")).toBe(true);
    expect(isShaderId("mesh-gradient")).toBe(true);
    expect(isShaderId("unknown-effect")).toBe(false);
    expect(getShaderDefinition("ferro-tide")).toEqual({ label: "Ferro Tide" });
  });

  it("loads the local component with the shared mount contract", async () => {
    const loaded = await loadPaperShader("ferro-tide");
    expect(loaded.id).toBe("ferro-tide");
    expect(loaded.definition.label).toBe("Ferro Tide");
    expect(typeof loaded.Component).toBe("function");
  });
});
