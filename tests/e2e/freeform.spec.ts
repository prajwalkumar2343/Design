import { expect, test, type Page } from "@playwright/test";

const surfaceSelector = '[data-testid="canvas-surface"]';
const frameSelector = "[data-frame-id]";
const freeformSelector = '[data-frame-id][data-freeform="true"]';

async function openDemo(page: Page) {
  await page.goto("/?demo=1");
  await expect(page.locator(surfaceSelector)).toBeVisible();
  await expect(page.locator('[data-testid="canvas-world"]')).toBeVisible();
}

/** A point on the canvas surface that is not inside any frame or control. */
async function findBackgroundPoint(page: Page) {
  const box = await page.locator(surfaceSelector).boundingBox();
  if (!box) throw new Error("Canvas surface has no viewport box");

  const point = await page.evaluate(
    ({ x, y, width, height }) => {
      const surfaceElement = document.querySelector('[data-testid="canvas-surface"]');
      if (!surfaceElement) return null;
      const candidates = [];
      for (let row = 1; row < 6; row += 1) {
        for (let column = 1; column < 8; column += 1) {
          candidates.push({
            x: x + (width * column) / 8,
            y: y + (height * row) / 6,
          });
        }
      }
      return (
        candidates.find(({ x: px, y: py }) => {
          const target = document.elementFromPoint(px, py);
          return (
            target &&
            surfaceElement.contains(target) &&
            !target.closest("[data-frame-id]") &&
            !target.closest("[data-brief-frame-id]") &&
            !(target instanceof HTMLIFrameElement) &&
            !target.closest("[data-canvas-control]")
          );
        }) ?? null
      );
    },
    box,
  );
  if (!point) throw new Error("Could not find an unobscured canvas background point");
  return point;
}

async function dragOnCanvas(page: Page, start: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 6 });
  await page.mouse.up();
}

test.describe("drawing outside frames", () => {
  test("dragging a shape on empty canvas creates a chromeless freeform frame", async ({ page }) => {
    await openDemo(page);
    const framesBefore = await page.locator(frameSelector).count();

    await page.keyboard.press("r");
    await expect(page.getByTestId("creation-mode-status")).toContainText("Rectangle mode");

    const start = await findBackgroundPoint(page);
    await dragOnCanvas(page, start, 180, 120);

    const freeform = page.locator(freeformSelector);
    await expect(freeform).toHaveCount(1);
    expect(await page.locator(frameSelector).count()).toBe(framesBefore + 1);

    // The shape lives inside the new frame's document as a real tool element.
    const doc = freeform.locator("iframe").contentFrame();
    await expect
      .poll(() => doc.locator('[data-design-tool-kind="rectangle"]').count())
      .toBe(1);
    await expect(doc.locator("svg rect")).toBeVisible();

    // Shape creation returns to the select tool.
    await expect(page.getByTestId("tool-button-select")).toHaveAttribute("aria-pressed", "true");
  });

  test("a click on empty canvas mints nothing with the shape tool", async ({ page }) => {
    await openDemo(page);
    const framesBefore = await page.locator(frameSelector).count();

    await page.keyboard.press("r");
    const start = await findBackgroundPoint(page);
    await dragOnCanvas(page, start, 2, 1);

    await expect(page.locator(freeformSelector)).toHaveCount(0);
    expect(await page.locator(frameSelector).count()).toBe(framesBefore);
  });

  test("draws inside a frame that was never selected", async ({ page }) => {
    await openDemo(page);
    await page.keyboard.press("r");

    // With a creation tool active every live frame exposes a creation layer,
    // not only the selected one. Pin the frame by id: drawing into it selects
    // it, and a `:not([data-selected])` locator would re-resolve mid-assertion.
    const unselected = page.locator(`${frameSelector}:not([data-selected="true"])`).first();
    const frameId = await unselected.getAttribute("data-frame-id");
    if (!frameId) throw new Error("The unselected frame has no id");
    const target = page.locator(`${frameSelector}[data-frame-id="${frameId}"]`);
    const creationLayer = target.getByTestId("frame-creation-layer");
    await expect(creationLayer).toBeAttached();
    const box = await creationLayer.boundingBox();
    if (!box) throw new Error("The unselected frame's creation layer is unavailable");

    const start = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.25 };
    await dragOnCanvas(page, start, 120, 80);

    const doc = target.locator("iframe").contentFrame();
    await expect
      .poll(() => doc.locator('[data-design-tool-kind="rectangle"]').count())
      .toBe(1);
    await expect(page.locator(freeformSelector)).toHaveCount(0);
  });

  test("places text on the canvas without a frame and edits it", async ({ page }) => {
    await openDemo(page);
    await page.keyboard.press("t");

    const start = await findBackgroundPoint(page);
    await page.mouse.click(start.x, start.y);

    const freeform = page.locator(freeformSelector);
    await expect(freeform).toHaveCount(1);

    const doc = freeform.locator("iframe").contentFrame();
    const text = doc.locator('[data-design-tool-kind="text"]');
    await expect(text).toHaveCount(1);
    // Baked text enters editing once the frame's bridge reports in.
    await expect(text).toHaveAttribute("data-design-tool-editing", "true", { timeout: 10000 });
    await page.keyboard.type("Hello", { delay: 20 });
    await expect(text).toHaveText("Hello");
  });

  test("draws on a project with zero frames", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("project-lake")).toBeVisible();
    await page.getByTestId("create-kind-blank").click();
    await page.getByTestId("blank-choose-website").click();
    await page.waitForURL(/\/design\//);
    await expect(page.locator(surfaceSelector)).toBeVisible();
    await expect(page.locator(frameSelector)).toHaveCount(0);

    // The brief frame materializes on a ~30ms timer after project creation
    // and the camera re-fits to it — wait for it before probing for a
    // background point, or the drag can land on the panel mid-layout.
    await expect(page.locator("[data-brief-frame-id]")).toBeVisible();

    // A brief field can hold focus on a fresh project — blur it so the "r"
    // shortcut reaches the canvas instead of typing into the field.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("r");
    await expect(page.getByTestId("creation-mode-status")).toContainText("Rectangle mode");

    const start = await findBackgroundPoint(page);
    await dragOnCanvas(page, start, 160, 110);

    await expect(page.locator(freeformSelector)).toHaveCount(1);
    const doc = page.locator(freeformSelector).locator("iframe").contentFrame();
    await expect
      .poll(() => doc.locator('[data-design-tool-kind="rectangle"]').count())
      .toBe(1);
  });

  test("keeps a dragged shape visible after it leaves the frame's original bounds", async ({ page }) => {
    await openDemo(page);
    await page.keyboard.press("r");
    const start = await findBackgroundPoint(page);
    await dragOnCanvas(page, start, 150, 100);

    const freeform = page.locator(freeformSelector);
    await expect(freeform).toHaveCount(1);
    await expect(freeform).toHaveAttribute("data-bridge-status", "ready");
    const doc = freeform.locator("iframe").contentFrame();
    const shape = doc.locator('[data-design-tool-kind="rectangle"]');
    await expect(shape).toHaveCount(1);

    const frameBoxBefore = await freeform.boundingBox();
    if (!frameBoxBefore) throw new Error("The freeform frame is unavailable");

    // Select the shape node, then drag it well past the frame's right edge —
    // the iframe viewport must not clip it, so the frame has to follow.
    const shapeBox = await shape.boundingBox();
    if (!shapeBox) throw new Error("The drawn shape is unavailable");
    await page.mouse.click(shapeBox.x + shapeBox.width / 2, shapeBox.y + shapeBox.height / 2);
    await expect(page.getByTestId("node-selection-box")).toBeVisible();

    const selectionBox = page.getByTestId("node-selection-box");
    const selectionBounds = await selectionBox.boundingBox();
    if (!selectionBounds) throw new Error("The node selection box is unavailable");
    const dragStart = { x: selectionBounds.x + selectionBounds.width / 2, y: selectionBounds.y + selectionBounds.height / 2 };
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragStart.x + 320, dragStart.y + 40, { steps: 8 });
    await page.mouse.up();

    const zoom = await page.evaluate(() => {
      const world = document.querySelector('[data-testid="canvas-world"]');
      return new DOMMatrixReadOnly(getComputedStyle(world!).transform).a;
    });

    // The shape's doc-space rect must still land inside the frame viewport —
    // before the fix it translated beyond the iframe and disappeared.
    await expect
      .poll(async () => {
        const [shapeRect, iframeBox] = await Promise.all([
          shape.evaluate((element) => element.getBoundingClientRect().toJSON()),
          freeform.locator("iframe").boundingBox(),
        ]);
        if (!iframeBox) return -1;
        const frameWidth = iframeBox.width / zoom;
        return shapeRect.x >= -1 && shapeRect.x + shapeRect.width <= frameWidth + 1 ? 1 : -1;
      })
      .toBe(1);

    // Undo restores both the shape position and the frame's original rect.
    await page.keyboard.press("Control+z");
    await expect
      .poll(async () => (await freeform.boundingBox())?.x ?? 0)
      .toBeCloseTo(frameBoxBefore.x, 0);
  });

  test("keeps the frame hugging a rotated shape when it moves", async ({ page }) => {
    await openDemo(page);
    await page.keyboard.press("r");
    const start = await findBackgroundPoint(page);
    await dragOnCanvas(page, start, 120, 70);

    const freeform = page.locator(freeformSelector);
    await expect(freeform).toHaveCount(1);
    await expect(freeform).toHaveAttribute("data-bridge-status", "ready");
    const doc = freeform.locator("iframe").contentFrame();
    const shape = doc.locator('[data-design-tool-kind="rectangle"]');
    await expect(shape).toHaveCount(1);

    const shapeBox = await shape.boundingBox();
    if (!shapeBox) throw new Error("The drawn shape is unavailable");
    await page.mouse.click(shapeBox.x + shapeBox.width / 2, shapeBox.y + shapeBox.height / 2);
    const rotationHandle = page.getByTestId("node-rotation-handle");
    await expect(rotationHandle).toBeVisible();

    // Rotate ~45°: the handle starts straight above the selection center, so
    // dragging it to the -45° point on the same circle rotates the shape.
    const handleBox = await rotationHandle.boundingBox();
    if (!handleBox) throw new Error("The rotation handle is unavailable");
    const center = { x: shapeBox.x + shapeBox.width / 2, y: shapeBox.y + shapeBox.height / 2 };
    const handleStart = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
    const radius = center.y - handleStart.y;
    const handleEnd = {
      x: center.x + radius * Math.SQRT1_2,
      y: center.y - radius * Math.SQRT1_2,
    };
    await page.mouse.move(handleStart.x, handleStart.y);
    await page.mouse.down();
    await page.mouse.move(handleEnd.x, handleEnd.y, { steps: 8 });
    await page.mouse.up();

    // Then nudge the shape — the regression double-rotated the already
    // axis-aligned bounds, inflating the frame far past content + pad.
    const selectionBox = page.getByTestId("node-selection-box");
    const selectionBounds = await selectionBox.boundingBox();
    if (!selectionBounds) throw new Error("The node selection box is unavailable");
    const dragStart = { x: selectionBounds.x + selectionBounds.width / 2, y: selectionBounds.y + selectionBounds.height / 2 };
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragStart.x + 24, dragStart.y + 12, { steps: 6 });
    await page.mouse.up();

    const zoom = await page.evaluate(() => {
      const world = document.querySelector('[data-testid="canvas-world"]');
      return new DOMMatrixReadOnly(getComputedStyle(world!).transform).a;
    });

    // The frame must track the shape's true (rotated) footprint within pad —
    // not the AABB of the already-rotated AABB (which for ~45° inflates the
    // frame by ~50%: the regression this guards against).
    await expect
      .poll(async () => {
        const [shapeRect, iframeBox] = await Promise.all([
          shape.evaluate((element) => element.getBoundingClientRect().toJSON()),
          freeform.locator("iframe").boundingBox(),
        ]);
        if (!iframeBox) return null;
        const frameDocWidth = iframeBox.width / zoom;
        return frameDocWidth - shapeRect.width;
      })
      .toBeGreaterThanOrEqual(8); // contains the shape: pad minus rounding slack
    await expect
      .poll(async () => {
        const [shapeRect, iframeBox] = await Promise.all([
          shape.evaluate((element) => element.getBoundingClientRect().toJSON()),
          freeform.locator("iframe").boundingBox(),
        ]);
        if (!iframeBox) return null;
        const frameDocWidth = iframeBox.width / zoom;
        return frameDocWidth - shapeRect.width;
      })
      .toBeLessThan(30); // pad*2 + slack — double-rotated bounds land ~70 over
  });

  test("keeps a dragged shape's freeform frame across a reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("project-lake")).toBeVisible();
    await page.getByTestId("create-kind-blank").click();
    await page.getByTestId("blank-choose-website").click();
    await page.waitForURL(/\/design\//);
    await expect(page.locator(surfaceSelector)).toBeVisible();
    await expect(page.locator("[data-brief-frame-id]")).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("r");
    await expect(page.getByTestId("creation-mode-status")).toContainText("Rectangle mode");
    const start = await findBackgroundPoint(page);
    await dragOnCanvas(page, start, 160, 110);

    const freeform = page.locator(freeformSelector);
    await expect(freeform).toHaveCount(1);
    const doc = freeform.locator("iframe").contentFrame();
    const shape = doc.locator('[data-design-tool-kind="rectangle"]');
    await expect(shape).toHaveCount(1);

    const shapeBox = await shape.boundingBox();
    if (!shapeBox) throw new Error("The drawn shape is unavailable");
    await page.mouse.click(shapeBox.x + shapeBox.width / 2, shapeBox.y + shapeBox.height / 2);
    const selectionBox = page.getByTestId("node-selection-box");
    const selectionBounds = await selectionBox.boundingBox();
    if (!selectionBounds) throw new Error("The node selection box is unavailable");
    const dragStart = { x: selectionBounds.x + selectionBounds.width / 2, y: selectionBounds.y + selectionBounds.height / 2 };
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragStart.x - 140, dragStart.y - 100, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () => page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.includes("project-data"));
        const blob = key ? localStorage.getItem(key) ?? "" : "";
        return blob.includes("translate(");
      }))
      .toBe(true);

    await page.reload();
    await expect(page.locator(surfaceSelector)).toBeVisible();

    const restored = page.locator(freeformSelector);
    await expect(restored).toHaveCount(1);
    const doc2 = restored.locator("iframe").contentFrame();
    const shape2 = doc2.locator('[data-design-tool-kind="rectangle"]');
    await expect(shape2).toHaveCount(1);

    const shapeBox2 = await shape2.boundingBox();
    if (!shapeBox2) throw new Error("The restored shape is unavailable");
    await page.mouse.click(shapeBox2.x + shapeBox2.width / 2, shapeBox2.y + shapeBox2.height / 2);
    const boxBounds = await page.getByTestId("node-selection-box").boundingBox();
    if (!boxBounds) throw new Error("The selection box is unavailable after reload");
    expect(Math.abs(boxBounds.x - shapeBox2.x)).toBeLessThan(6);
    expect(Math.abs(boxBounds.y - shapeBox2.y)).toBeLessThan(6);

    const dragStart2 = { x: boxBounds.x + boxBounds.width / 2, y: boxBounds.y + boxBounds.height / 2 };
    await page.mouse.move(dragStart2.x, dragStart2.y);
    await page.mouse.down();
    await page.mouse.move(dragStart2.x - 120, dragStart2.y - 90, { steps: 8 });
    await page.mouse.up();

    const zoom = await page.evaluate(() => {
      const world = document.querySelector('[data-testid="canvas-world"]');
      return new DOMMatrixReadOnly(getComputedStyle(world!).transform).a;
    });
    await expect
      .poll(async () => {
        const [shapeRect, iframeBox] = await Promise.all([
          shape2.evaluate((element) => element.getBoundingClientRect().toJSON()),
          restored.locator("iframe").boundingBox(),
        ]);
        if (!iframeBox) return -1;
        const w = iframeBox.width / zoom;
        const h = iframeBox.height / zoom;
        const inside = shapeRect.x >= -1 && shapeRect.y >= -1
          && shapeRect.x + shapeRect.width <= w + 1 && shapeRect.y + shapeRect.height <= h + 1;
        return inside ? 1 : -1;
      })
      .toBe(1);
  });

  test("deletes a canvas-drawn shape and restores it on undo", async ({ page }) => {
    await openDemo(page);
    await page.keyboard.press("r");
    const start = await findBackgroundPoint(page);
    await dragOnCanvas(page, start, 150, 100);
    await expect(page.locator(freeformSelector)).toHaveCount(1);

    // The new shape is selected — Delete removes the freeform frame.
    await page.keyboard.press("Delete");
    await expect(page.locator(freeformSelector)).toHaveCount(0);

    await page.keyboard.press("Control+z");
    await expect(page.locator(freeformSelector)).toHaveCount(1);
    const doc = page.locator(freeformSelector).locator("iframe").contentFrame();
    await expect
      .poll(() => doc.locator('[data-design-tool-kind="rectangle"]').count())
      .toBe(1);
  });
});
