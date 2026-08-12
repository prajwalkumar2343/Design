import type { Camera, CanvasFrame, Rect, Size } from "./types";
import { OVERSCAN_SCREEN_PX, MAX_LIVE_FRAMES } from "./constants";

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

function squaredDistanceToViewportCenter(
  frame: CanvasFrame,
  camera: Camera,
  viewport: Size,
): number {
  const cx = camera.x + viewport.width / (2 * camera.zoom);
  const cy = camera.y + viewport.height / (2 * camera.zoom);
  const dx = frame.x + frame.width / 2 - cx;
  const dy = frame.y + frame.height / 2 - cy;
  return dx * dx + dy * dy;
}

export interface RankVisibleFramesInput {
  frames: CanvasFrame[];
  camera: Camera;
  viewport: Size;
  overscanScreenPx?: number;
  maxLiveFrames?: number;
  pinnedFrameId?: string;
}

export interface RankVisibleFramesOutput {
  liveFrameIds: string[];
  coldFrameIds: string[];
}

export function rankVisibleFrames(
  input: RankVisibleFramesInput,
): RankVisibleFramesOutput {
  const {
    frames,
    camera,
    viewport,
    overscanScreenPx = OVERSCAN_SCREEN_PX,
    maxLiveFrames = MAX_LIVE_FRAMES,
    pinnedFrameId,
  } = input;

  const visibleRect = getVisibleWorldRect(camera, viewport, overscanScreenPx);

  const visible = frames.filter((f) => rectsIntersect(f, visibleRect));

  const pinned =
    pinnedFrameId !== undefined
      ? frames.find((f) => f.id === pinnedFrameId)
      : undefined;

  const others = pinned
    ? visible.filter((f) => f.id !== pinnedFrameId)
    : [...visible];

  others.sort((a, b) => {
    const da = squaredDistanceToViewportCenter(a, camera, viewport);
    const db = squaredDistanceToViewportCenter(b, camera, viewport);
    return da !== db ? da - db : a.id < b.id ? -1 : 1;
  });

  const liveFrameIds: string[] = [];
  if (pinned) {
    liveFrameIds.push(pinned.id);
  }
  for (const f of others) {
    if (liveFrameIds.length >= maxLiveFrames + (pinned ? 1 : 0)) break;
    liveFrameIds.push(f.id);
  }

  const liveSet = new Set(liveFrameIds);
  const coldFrameIds = frames
    .filter((f) => !liveSet.has(f.id))
    .map((f) => f.id);

  return { liveFrameIds, coldFrameIds };
}