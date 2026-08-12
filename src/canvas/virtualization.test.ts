import { describe, it, expect } from "vitest";
import type { Camera, CanvasFrame, Size } from "./types";
import {
  getVisibleWorldRect,
  rectsIntersect,
  rankVisibleFrames,
} from "./virtualization";

function frame(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): CanvasFrame {
  return {
    id,
    x,
    y,
    width,
    height,
    name: id,
    documentId: "doc1",
    srcDoc: "",
    background: "#fff",
  };
}

const viewport: Size = { width: 800, height: 600 };

describe("getVisibleWorldRect", () => {
  it("returns a rect centered on the camera at zoom 1", () => {
    const camera: Camera = { x: 0, y: 0, zoom: 1 };
    const r = getVisibleWorldRect(camera, viewport, 0);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBe(800);
    expect(r.height).toBe(600);
  });

  it("adds overscan in world units inversely scaled by zoom", () => {
    const camera: Camera = { x: 0, y: 0, zoom: 2 };
    const r = getVisibleWorldRect(camera, viewport, 400);
    expect(r.x).toBe(-200);
    expect(r.y).toBe(-200);
    expect(r.width).toBe(800);
    expect(r.height).toBe(700);
  });

  it("handles negative camera coordinates", () => {
    const camera: Camera = { x: -100, y: -50, zoom: 1 };
    const r = getVisibleWorldRect(camera, viewport, 0);
    expect(r.x).toBe(-100);
    expect(r.y).toBe(-50);
    expect(r.width).toBe(800);
    expect(r.height).toBe(600);
  });

  it("scales overscan correctly at different zoom levels", () => {
    const camera: Camera = { x: 0, y: 0, zoom: 0.5 };
    const r = getVisibleWorldRect(camera, viewport, 560);
    expect(r.x).toBe(-1120);
    expect(r.y).toBe(-1120);
    expect(r.width).toBe(3840);
    expect(r.height).toBe(3440);
  });

  it("uses default OVERSCAN_SCREEN_PX when argument omitted", () => {
    const camera: Camera = { x: 0, y: 0, zoom: 1 };
    const r = getVisibleWorldRect(camera, viewport);
    expect(r.x).toBe(-560);
    expect(r.y).toBe(-560);
    expect(r.width).toBe(1920);
    expect(r.height).toBe(1720);
  });
});

describe("rectsIntersect", () => {
  it("returns true for overlapping rects", () => {
    expect(
      rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }),
    ).toBe(true);
  });

  it("returns false for separated rects", () => {
    expect(
      rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 10, height: 10 }),
    ).toBe(false);
  });

  it("returns false when rects just touch on the right edge", () => {
    expect(
      rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }),
    ).toBe(false);
  });

  it("returns false when rects just touch on the bottom edge", () => {
    expect(
      rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 10, width: 10, height: 10 }),
    ).toBe(false);
  });

  it("returns true when one rect contains the other", () => {
    expect(
      rectsIntersect({ x: 0, y: 0, width: 100, height: 100 }, { x: 25, y: 25, width: 10, height: 10 }),
    ).toBe(true);
  });

  it("returns true when rects share a negative coordinate overlap", () => {
    expect(
      rectsIntersect({ x: -20, y: -20, width: 30, height: 30 }, { x: -10, y: -10, width: 30, height: 30 }),
    ).toBe(true);
  });

  it("returns false when both rects are in negative space and separated", () => {
    expect(
      rectsIntersect({ x: -50, y: -50, width: 10, height: 10 }, { x: -10, y: -10, width: 10, height: 10 }),
    ).toBe(false);
  });
});

describe("rankVisibleFrames", () => {
  const camera: Camera = { x: 0, y: 0, zoom: 1 };

  it("returns live frames in the visible area and cold frames outside", () => {
    const frames = [
      frame("a", 100, 100, 50, 50),
      frame("b", 1000, 1000, 50, 50),
    ];
    const result = rankVisibleFrames({
      frames,
      camera,
      viewport,
      overscanScreenPx: 0,
      maxLiveFrames: 12,
    });
    expect(result.liveFrameIds).toContain("a");
    expect(result.liveFrameIds).not.toContain("b");
    expect(result.coldFrameIds).toContain("b");
  });

  it("ranks visible frames closest to viewport center first", () => {
    const frames = [
      frame("far", 500, 0, 50, 50),
      frame("near", 200, 150, 50, 50),
    ];
    const result = rankVisibleFrames({
      frames,
      camera,
      viewport,
      overscanScreenPx: 0,
      maxLiveFrames: 12,
    });
    expect(result.liveFrameIds[0]).toBe("near");
    expect(result.liveFrameIds[1]).toBe("far");
  });

  it("breaks ties deterministically by id", () => {
    const frames = [
      frame("b", 100, 100, 50, 50),
      frame("a", 100, 100, 50, 50),
    ];
    const result = rankVisibleFrames({
      frames,
      camera,
      viewport,
      overscanScreenPx: 0,
      maxLiveFrames: 12,
    });
    expect(result.liveFrameIds[0]).toBe("a");
    expect(result.liveFrameIds[1]).toBe("b");
  });

  it("caps live frames at maxLiveFrames", () => {
    const frames = Array.from({ length: 20 }, (_, i) =>
      frame(`f${i}`, i * 30, i * 30, 20, 20),
    );
    const result = rankVisibleFrames({
      frames,
      camera,
      viewport,
      overscanScreenPx: 0,
      maxLiveFrames: 5,
    });
    expect(result.liveFrameIds.length).toBe(5);
    expect(result.coldFrameIds.length).toBe(15);
  });

  it("includes pinned frame as live even when offscreen", () => {
    const frames = [frame("pinned", 9999, 9999, 10, 10)];
    const result = rankVisibleFrames({
      frames,
      camera,
      viewport,
      overscanScreenPx: 0,
      maxLiveFrames: 12,
      pinnedFrameId: "pinned",
    });
    expect(result.liveFrameIds).toContain("pinned");
    expect(result.coldFrameIds).not.toContain("pinned");
  });

  it("does not duplicate pinned frame when pinned is also visible", () => {
    const frames = [
      frame("pinned", 100, 100, 50, 50),
      frame("a", 200, 200, 50, 50),
    ];
    const result = rankVisibleFrames({
      frames,
      camera,
      viewport,
      overscanScreenPx: 0,
      maxLiveFrames: 12,
      pinnedFrameId: "pinned",
    });
    expect(result.liveFrameIds.filter((id) => id === "pinned").length).toBe(1);
  });

  it("ranks pinned frame first when visible", () => {
    const frames = [
      frame("near", 100, 100, 50, 50),
      frame("pinned", 400, 0, 50, 50),
    ];
    const result = rankVisibleFrames({
      frames,
      camera,
      viewport,
      overscanScreenPx: 0,
      maxLiveFrames: 12,
      pinnedFrameId: "pinned",
    });
    expect(result.liveFrameIds[0]).toBe("pinned");
    expect(result.liveFrameIds[1]).toBe("near");
  });

  it("includes pinned frame even when it would exceed maxLiveFrames", () => {
    const frames = [
      frame("pinned", 100, 100, 50, 50),
      frame("a", 200, 200, 50, 50),
      frame("b", 300, 300, 50, 50),
    ];
    const result = rankVisibleFrames({
      frames,
      camera,
      viewport,
      overscanScreenPx: 0,
      maxLiveFrames: 2,
      pinnedFrameId: "pinned",
    });
    expect(result.liveFrameIds).toContain("pinned");
    expect(result.liveFrameIds.length).toBe(3);
  });

  it("handles frames with negative world coordinates", () => {
    const frames = [frame("neg", -80, -80, 50, 50)];
    const cameraNeg: Camera = { x: -100, y: -100, zoom: 1 };
    const result = rankVisibleFrames({
      frames,
      camera: cameraNeg,
      viewport,
      overscanScreenPx: 0,
      maxLiveFrames: 12,
    });
    expect(result.liveFrameIds).toContain("neg");
  });

  it("coldFrameIds contains both visible-not-live and non-visible frames", () => {
    const frames = [
      frame("visible-close", 350, 250, 50, 50),
      frame("visible-far", 500, 500, 50, 50),
      frame("offscreen", 9999, 9999, 50, 50),
    ];
    const result = rankVisibleFrames({
      frames,
      camera,
      viewport,
      overscanScreenPx: 0,
      maxLiveFrames: 1,
    });
    expect(result.liveFrameIds).toEqual(["visible-close"]);
    expect(result.coldFrameIds).toEqual(
      expect.arrayContaining(["visible-far", "offscreen"]),
    );
    expect(result.coldFrameIds.length).toBe(2);
  });
});