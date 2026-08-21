import { describe, expect, it } from 'vitest';

import { MAX_ZOOM, MIN_ZOOM } from './constants';
import {
  cameraAtZoomProgress,
  cameraTransform,
  easeOutCubic,
  fitRect,
  panCamera,
  revealCamera,
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
      'translate3d(24px, -16px, 0) scale(2)',
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

describe('eased zoom transitions', () => {
  it('eases progress so zoom decelerates toward the target', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 3);
    const early = easeOutCubic(0.5) - easeOutCubic(0.25);
    const late = easeOutCubic(0.75) - easeOutCubic(0.5);
    expect(early).toBeGreaterThan(late);
  });

  it('keeps the anchor world point fixed at every eased step', () => {
    const from = { x: -120, y: 80, zoom: 0.75 };
    const anchor = { x: 315, y: 240 };
    const to = zoomCameraAtPoint(from, 2.5, anchor);
    const worldBefore = screenToWorld(anchor, from);

    for (let step = 1; step <= 6; step++) {
      const camera = cameraAtZoomProgress(from, to, anchor, step / 6);
      expect(screenToWorld(anchor, camera)).toEqual(worldBefore);
    }
  });

  it('reaches the exact target camera at full progress', () => {
    const from = { x: -120, y: 80, zoom: 0.75 };
    const anchor = { x: 315, y: 240 };
    const to = zoomCameraAtPoint(from, 2.5, anchor);

    const end = cameraAtZoomProgress(from, to, anchor, 1);

    expect(end.zoom).toBeCloseTo(to.zoom, 6);
    expect(end.x).toBeCloseTo(to.x, 6);
    expect(end.y).toBeCloseTo(to.y, 6);
  });

  it('interpolates zoom smoothly between clamped bounds', () => {
    const from = { x: 30, y: -45, zoom: 1 };
    const anchor = { x: 200, y: 125 };
    const to = zoomCameraAtPoint(from, 100, anchor);

    const half = cameraAtZoomProgress(from, to, anchor, 0.5);
    expect(half.zoom).toBeGreaterThan(from.zoom);
    expect(half.zoom).toBeLessThan(to.zoom);
    expect(to.zoom).toBe(MAX_ZOOM);
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

describe('revealCamera', () => {
  const viewport = { width: 800, height: 600 };

  it('keeps the camera when the rect is already fully visible', () => {
    const camera = { x: -50, y: -50, zoom: 1 };
    const rect = { x: 0, y: 0, width: 400, height: 300 };

    expect(revealCamera(camera, viewport, rect)).toBeNull();
  });

  it('returns a camera that frames an off-screen rect', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const rect = { x: 2000, y: 1500, width: 400, height: 300 };

    const next = revealCamera(camera, viewport, rect);

    expect(next).not.toBeNull();
    const revealed = worldToScreen({ x: rect.x + rect.width, y: rect.y + rect.height }, next!);
    expect(revealed.x).toBeLessThanOrEqual(viewport.width);
    expect(revealed.y).toBeLessThanOrEqual(viewport.height);
    expect(worldToScreen({ x: rect.x, y: rect.y }, next!).x).toBeGreaterThanOrEqual(0);
  });

  it('reframes when only part of the rect is visible', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    // Right edge (x 900) sits beyond the 800px visible width.
    const rect = { x: 700, y: 100, width: 200, height: 200 };

    expect(revealCamera(camera, viewport, rect)).not.toBeNull();
  });

  it('accounts for zoom when deciding visibility', () => {
    // At zoom 2 the visible world region is 400x300, so the rect overflows.
    const zoomed = revealCamera({ x: 0, y: 0, zoom: 2 }, viewport, { x: 350, y: 0, width: 100, height: 100 });
    expect(zoomed).not.toBeNull();
    // At zoom 0.5 the visible region is 1600x1200, so it fits comfortably.
    const panned = revealCamera({ x: 0, y: 0, zoom: 0.5 }, viewport, { x: 350, y: 0, width: 100, height: 100 });
    expect(panned).toBeNull();
  });

  it('applies padding to the fitted result', () => {
    const rect = { x: 5000, y: 5000, width: 800, height: 600 };

    const padded = revealCamera({ x: 0, y: 0, zoom: 1 }, viewport, rect, 100)!;
    const unpadded = revealCamera({ x: 0, y: 0, zoom: 1 }, viewport, rect)!;

    expect(padded.zoom).toBeLessThan(unpadded.zoom);
  });
});
