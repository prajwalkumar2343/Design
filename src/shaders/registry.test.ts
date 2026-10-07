import { describe, expect, it, vi } from "vitest";
import {
  CUSTOM_SHADER_IDS,
  PAPER_SHADER_IDS,
  SHADER_IDS,
  UnsupportedPaperShaderError,
  detectPaperShaderSupport,
  getPaperShaderDefinition,
  getShaderDefinition,
  importShaderModule,
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

  it("shares one in-flight load across concurrent callers", async () => {
    const [first, second] = await Promise.all([
      loadPaperShader("waves"),
      loadPaperShader("waves"),
    ]);
    expect(first).toBe(second);
  });
});

describe("importShaderModule", () => {
  const entryModule = {
    FerroTide: () => null,
    FERRO_TIDE_MOODS: [{ name: "Abyss", params: {} }],
  };
  const isEntryModule = (module: unknown): module is typeof entryModule =>
    !!module &&
    (typeof module === "object" || typeof module === "function") &&
    "FerroTide" in module &&
    "FERRO_TIDE_MOODS" in module;

  it("recovers by re-importing the failed entry URL", async () => {
    const entryUrl = "https://app.example.test/assets/ferro-tide-abc.js";
    const load = vi.fn<() => Promise<typeof entryModule>>().mockRejectedValueOnce(
      new Error(`Failed to fetch dynamically imported module: ${entryUrl}`),
    );
    const importUrl = vi.fn<(url: string) => Promise<unknown>>(async () => entryModule);

    const result = await importShaderModule(load, { importUrl, isEntryModule });

    expect(result).toBe(entryModule);
    expect(load).toHaveBeenCalledTimes(1);
    expect(importUrl).toHaveBeenCalledTimes(1);
    const retried = importUrl.mock.calls[0]![0];
    expect(retried).toContain(entryUrl);
    expect(retried).not.toBe(entryUrl);
  });

  it("rejects with the entry error when the failure names a nested dependency", async () => {
    // FerroTide imports `ogl` — when that nested fetch fails, the error
    // names the dependency URL. Importing it succeeds with ogl's exports,
    // which must never be returned as the entry module.
    const nestedUrl = "https://app.example.test/assets/ogl-dep-xyz.js";
    const entryError = new Error(`Failed to fetch dynamically imported module: ${nestedUrl}`);
    const load = vi.fn<() => Promise<typeof entryModule>>().mockRejectedValue(entryError);
    const importUrl = vi.fn<(url: string) => Promise<unknown>>(async () => ({ createGeometry: () => ({}) }));

    await expect(importShaderModule(load, { importUrl, isEntryModule })).rejects.toBe(entryError);
    expect(load).toHaveBeenCalledTimes(1);
    for (const [url] of importUrl.mock.calls) {
      expect(url).toContain(nestedUrl);
    }
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

  it("probes the real canvas only once after support is confirmed", async () => {
    vi.resetModules();
    const { detectPaperShaderSupport: detect } = await import("./registry");
    const getContext = vi.fn(() => ({
      getExtension: () => ({ loseContext: () => undefined }),
    }));
    const createElement = vi
      .spyOn(document, "createElement")
      .mockReturnValue({ getContext } as unknown as HTMLCanvasElement);
    try {
      expect(detect()).toEqual({ supported: true });
      expect(detect()).toEqual({ supported: true });
      expect(getContext).toHaveBeenCalledTimes(1);
    } finally {
      createElement.mockRestore();
    }
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
