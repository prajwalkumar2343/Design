import { describe, expect, it } from 'vitest';

import { MAX_ZOOM, MIN_ZOOM } from './constants';
import {
  cameraTransform,
  fitRect,
  panCamera,
  screenToWorld,
  worldToScreen,
  zoomCameraAtPoint,
} from './camera';

describe('camera coordinates', () => {
  it('round-trips points with negative world and camera coordinates', () => {
    const camera = { x: -320, y: 180, zoom: 1.75 };
    const worldPoint = { x: -740.5, y: -95.25 };

    const screenPoint = worldToScreen(worldPoint, camera);

    expect(screenPoint).toEqual({ x: -735.875, y: -481.6875 });
    expect(screenToWorld(screenPoint, camera)).toEqual(worldPoint);
  });

  it('creates the CSS transform for the world layer', () => {
    expect(cameraTransform({ x: -12, y: 8, zoom: 2 })).toBe(
      'translate(24px, -16px) scale(2)',
    );
  });
});

describe('camera movement', () => {
  it('converts a pointer pan from screen space to world space', () => {
    expect(
      panCamera({ x: -20, y: 40, zoom: 2 }, { x: 30, y: -10 }),
    ).toEqual({ x: -35, y: 45, zoom: 2 });
  });

  it('keeps the cursor world point fixed while zooming', () => {
    const camera = { x: -120, y: 80, zoom: 0.75 };
    const cursor = { x: 315, y: 240 };
    const worldBefore = screenToWorld(cursor, camera);

    const zoomed = zoomCameraAtPoint(camera, 2.5, cursor);

    expect(screenToWorld(cursor, zoomed)).toEqual(worldBefore);
    expect(zoomed.zoom).toBe(2.5);
  });

  it('clamps point-centered zoom to both bounds', () => {
    const camera = { x: 30, y: -45, zoom: 1 };
    const cursor = { x: 200, y: 125 };
    const worldBefore = screenToWorld(cursor, camera);

    const belowMinimum = zoomCameraAtPoint(camera, 0, cursor);
    const aboveMaximum = zoomCameraAtPoint(camera, 100, cursor);

    expect(belowMinimum.zoom).toBe(MIN_ZOOM);
    expect(aboveMaximum.zoom).toBe(MAX_ZOOM);
    expect(screenToWorld(cursor, belowMinimum)).toEqual(worldBefore);
    expect(screenToWorld(cursor, aboveMaximum)).toEqual(worldBefore);
  });
});

describe('fitRect', () => {
  it('centers a negative-coordinate rect and fits it with padding', () => {
    const rect = { x: -900, y: -300, width: 400, height: 200 };
    const viewport = { width: 1000, height: 700 };

    const camera = fitRect(rect, viewport, 100);

    expect(camera.zoom).toBe(2);
    expect(worldToScreen({ x: -700, y: -200 }, camera)).toEqual({
      x: 500,
      y: 350,
    });
    expect(worldToScreen({ x: rect.x, y: rect.y }, camera)).toEqual({
      x: 100,
      y: 150,
    });
  });

  it('respects the zoom bounds when fitting very small and large rects', () => {
    const viewport = { width: 800, height: 600 };

    expect(fitRect({ x: 0, y: 0, width: 1, height: 1 }, viewport).zoom).toBe(
      MAX_ZOOM,
    );
    expect(
      fitRect({ x: 0, y: 0, width: 100_000, height: 100_000 }, viewport)
        .zoom,
    ).toBe(MIN_ZOOM);
  });
});
