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
    // not only the selected one.
    const unselected = page.locator(`${frameSelector}:not([data-selected="true"])`).first();
    const creationLayer = unselected.getByTestId("frame-creation-layer");
    await expect(creationLayer).toBeAttached();
    const box = await creationLayer.boundingBox();
    if (!box) throw new Error("The unselected frame's creation layer is unavailable");

    const start = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.25 };
    await dragOnCanvas(page, start, 120, 80);

    const doc = unselected.locator("iframe").contentFrame();
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

    await page.keyboard.press("r");
    const start = await findBackgroundPoint(page);
    await dragOnCanvas(page, start, 160, 110);

    await expect(page.locator(freeformSelector)).toHaveCount(1);
    const doc = page.locator(freeformSelector).locator("iframe").contentFrame();
    await expect
      .poll(() => doc.locator('[data-design-tool-kind="rectangle"]').count())
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
