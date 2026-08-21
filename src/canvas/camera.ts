import { MAX_ZOOM, MIN_ZOOM } from './constants';
import type { Camera, Point, Rect, Size } from './types';

export function worldToScreen(point: Point, camera: Camera): Point {
  return {
    x: (point.x - camera.x) * camera.zoom,
    y: (point.y - camera.y) * camera.zoom,
  };
}

export function screenToWorld(point: Point, camera: Camera): Point {
  return {
    x: point.x / camera.zoom + camera.x,
    y: point.y / camera.zoom + camera.y,
  };
}

export function cameraTransform(camera: Camera): string {
  return `translate3d(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px, 0) scale(${camera.zoom})`;
}

/** Moves the canvas by a screen-space pointer delta. */
export function panCamera(camera: Camera, deltaScreen: Point): Camera {
  return {
    ...camera,
    x: camera.x - deltaScreen.x / camera.zoom,
    y: camera.y - deltaScreen.y / camera.zoom,
  };
}

/** Changes zoom while keeping the world point beneath the cursor stationary. */
export function zoomCameraAtPoint(
  camera: Camera,
  nextZoom: number,
  screenPoint: Point,
): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
  const worldPoint = screenToWorld(screenPoint, camera);

  return {
    x: worldPoint.x - screenPoint.x / zoom,
    y: worldPoint.y - screenPoint.y / zoom,
    zoom,
  };
}

/** Number of eased animation steps used to smooth a zoom transition. */
export const ZOOM_SMOOTH_STEPS = 6;

/** Eases a normalized progress value so zoom decelerates toward its target. */
export function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

/**
 * Returns the camera at `progress` (0..1) along an eased zoom transition from
 * `from` to `to`, keeping the world point beneath `anchor` stationary so the
 * motion reads as pure zoom rather than a pan.
 */
export function cameraAtZoomProgress(
  from: Camera,
  to: Camera,
  anchor: Point,
  progress: number,
): Camera {
  const eased = easeOutCubic(progress);
  const zoom = from.zoom + (to.zoom - from.zoom) * eased;
  const worldPoint = screenToWorld(anchor, from);
  return {
    x: worldPoint.x - anchor.x / zoom,
    y: worldPoint.y - anchor.y / zoom,
    zoom,
  };
}

export function fitRect(rect: Rect, viewport: Size, padding = 0): Camera {
  const availableWidth = Math.max(0, viewport.width - padding * 2);
  const availableHeight = Math.max(0, viewport.height - padding * 2);
  const widthZoom = rect.width > 0 ? availableWidth / rect.width : MAX_ZOOM;
  const heightZoom = rect.height > 0 ? availableHeight / rect.height : MAX_ZOOM;
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.min(widthZoom, heightZoom)),
  );

  return {
    x: rect.x + rect.width / 2 - viewport.width / (2 * zoom),
    y: rect.y + rect.height / 2 - viewport.height / (2 * zoom),
    zoom,
  };
}

/**
 * Camera that brings `focusRect` fully into view, or `null` when every corner
 * of the rect is already visible so the camera can stay where it is.
 */
export function revealCamera(
  current: Camera,
  viewport: Size,
  focusRect: Rect,
  padding = 0,
): Camera | null {
  const visibleWidth = viewport.width / current.zoom;
  const visibleHeight = viewport.height / current.zoom;
  const fullyVisible =
    focusRect.x >= current.x &&
    focusRect.y >= current.y &&
    focusRect.x + focusRect.width <= current.x + visibleWidth &&
    focusRect.y + focusRect.height <= current.y + visibleHeight;
  if (fullyVisible) return null;
  return fitRect(focusRect, viewport, padding);
}
