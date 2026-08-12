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
  return `translate(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px) scale(${camera.zoom})`;
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
