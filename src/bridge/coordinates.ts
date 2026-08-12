import { screenToWorld } from "../canvas/camera";
import type { Camera, Point, Rect } from "../canvas/types";
import type { BridgePoint, BridgeRect } from "./protocol";

export interface IframeCoordinateContext {
  iframeRect: Rect;
  surfaceRect: Rect;
  camera: Camera;
}

export interface MappedIframePoint {
  /** Coordinates relative to the canvas surface in CSS pixels. */
  screen: Point;
  /** Coordinates in the unscaled infinite-canvas world. */
  world: Point;
}

/**
 * Maps a point reported by the sandboxed document's viewport into both parent
 * coordinate spaces. `iframeRect` is the parent DOMRect, while `localPoint`
 * is the child viewport point from the bridge runtime.
 */
export function mapIframePointToCanvas(
  localPoint: BridgePoint,
  context: IframeCoordinateContext,
): MappedIframePoint {
  const screen = {
    x: context.iframeRect.x - context.surfaceRect.x + localPoint.x,
    y: context.iframeRect.y - context.surfaceRect.y + localPoint.y,
  };
  return { screen, world: screenToWorld(screen, context.camera) };
}

export function mapIframeRectToCanvas(
  localRect: BridgeRect,
  context: IframeCoordinateContext,
): Rect {
  const topLeft = mapIframePointToCanvas(localRect, context);
  return {
    x: topLeft.world.x,
    y: topLeft.world.y,
    width: localRect.width / context.camera.zoom,
    height: localRect.height / context.camera.zoom,
  };
}

