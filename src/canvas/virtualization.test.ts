import { describe, it, expect } from "vitest";
import type { Camera, Size } from "./types";
import { getVisibleWorldRect, mountEvictionCandidates, rectsIntersect } from "./virtualization";

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

describe("mountEvictionCandidates", () => {
  const distanceSq = (distances: Record<string, number>) => (id: string) => distances[id] ?? 0;

  it("orders unpinned mounts farthest-first", () => {
    const candidates = mountEvictionCandidates(
      ["a", "b", "c"],
      new Set<string>(),
      distanceSq({ a: 1, b: 9, c: 4 }),
    );
    expect(candidates.map((candidate) => candidate.id)).toEqual(["b", "c", "a"]);
  });

  it("excludes pinned mounts no matter how far they are", () => {
    const candidates = mountEvictionCandidates(
      ["a", "b", "c"],
      new Set(["b"]),
      distanceSq({ a: 1, b: 100, c: 4 }),
    );
    expect(candidates.map((candidate) => candidate.id)).toEqual(["c", "a"]);
  });

  it("returns an empty list when every mount is pinned", () => {
    expect(mountEvictionCandidates(["a", "b"], new Set(["a", "b"]), () => 5)).toEqual([]);
  });

  it("evicts from the front until the mount cap holds, keeping pins", () => {
    const mounted = new Set(["a", "b", "c", "d"]);
    const pinned = new Set(["d"]);
    const cap = 2;
    for (const { id } of mountEvictionCandidates(mounted, pinned, distanceSq({ a: 1, b: 9, c: 4 }))) {
      if (mounted.size <= cap) break;
      mounted.delete(id);
    }
    expect([...mounted].sort()).toEqual(["a", "d"]);
  });

  it("exposes the displacement target an at-cap scan mount must beat", () => {
    const [farthest] = mountEvictionCandidates(
      ["near", "far"],
      new Set<string>(),
      distanceSq({ near: 4, far: 25 }),
    );
    // A scan grant only displaces when strictly closer than this distance.
    expect(farthest.id).toBe("far");
    expect(farthest.distanceSq).toBe(25);
  });
});
