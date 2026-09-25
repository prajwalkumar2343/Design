import type { Camera, Rect, Size } from "./types";
import { OVERSCAN_SCREEN_PX } from "./constants";

export function getVisibleWorldRect(
  camera: Camera,
  viewport: Size,
  overscanScreenPx: number = OVERSCAN_SCREEN_PX,
): Rect {
  const overscanWorld = overscanScreenPx / camera.zoom;
  const left = camera.x - overscanWorld;
  const top = camera.y - overscanWorld;
  const right = camera.x + viewport.width / camera.zoom + overscanWorld;
  const bottom = camera.y + viewport.height / camera.zoom + overscanWorld;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export interface MountEvictionCandidate {
  id: string;
  distanceSq: number;
}

/**
 * Unpinned mounts ordered farthest-from-viewport first. Past the mount cap
 * this is the eviction order (evict from the front until the cap holds), and
 * the head entry is the displacement check for an at-cap scan mount, which
 * may only proceed when it is strictly closer.
 */
export function mountEvictionCandidates(
  mountedIds: Iterable<string>,
  pinnedIds: ReadonlySet<string>,
  distanceSq: (id: string) => number,
): MountEvictionCandidate[] {
  const candidates: MountEvictionCandidate[] = [];
  for (const id of mountedIds) {
    if (pinnedIds.has(id)) continue;
    candidates.push({ id, distanceSq: distanceSq(id) });
  }
  candidates.sort((a, b) => b.distanceSq - a.distanceSq);
  return candidates;
}
