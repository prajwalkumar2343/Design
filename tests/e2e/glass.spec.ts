import { expect, test, type Page } from "@playwright/test";

const surfaceSelector = '[data-testid="canvas-surface"]';

async function openCanvas(page: Page) {
  await page.goto("/?demo=1");
  await expect(page.locator(surfaceSelector)).toBeVisible();
}

interface ShapeState {
  glassAttr: string | null;
  childFill: string | null;
  gradientCount: number;
}

function shapeState(page: Page) {
  return page.locator('[data-frame-id="desktop"] iframe')
    .contentFrame()
    .locator('[data-design-tool-kind="rectangle"]')
    .evaluate((element): ShapeState => ({
      glassAttr: element.getAttribute("data-design-tool-glass"),
      childFill: element.querySelector("rect")?.getAttribute("fill") ?? null,
      gradientCount: element.querySelectorAll("linearGradient").length,
    }));
}

/** Draws a rectangle in the desktop frame and leaves the select tool active. */
async function drawRectangle(page: Page) {
  const frame = page.locator('[data-frame-id="desktop"]');
  const preview = frame.locator("iframe").contentFrame();
  await page.getByTestId("tool-button-rectangle").click();
  const creationLayer = frame.getByTestId("frame-creation-layer");
  const box = await creationLayer.boundingBox();
  if (!box) throw new Error("The active frame creation layer is unavailable");
  const start = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 160, start.y + 110, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => preview!.locator('[data-design-tool-kind="rectangle"]').count()).toBe(1);
  return preview!;
}

async function selectRectangle(page: Page) {
  const rectangle = page.locator('[data-frame-id="desktop"] iframe')
    .contentFrame()
    .locator('[data-design-tool-kind="rectangle"]');
  const rect = (await rectangle.boundingBox())!;
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await expect(page.getByTestId("glass-level-increment")).toBeVisible();
}

test.describe("glass effect asset", () => {
  test("applies frosted glass to a drawn shape through the step control", async ({ page }) => {
    await drawRectangle(page);
    await selectRectangle(page);

    await page.getByTestId("glass-level-increment").click();
    await expect.poll(() => shapeState(page)).toEqual({
      glassAttr: "10",
      childFill: expect.stringContaining("url(#"),
      gradientCount: 1,
    });
  });

  test("tracks the applied level on a created text layer so the slider reads back", async ({ page }) => {
    await openCanvas(page);
    const frame = page.locator('[data-frame-id="desktop"]');
    const preview = frame.locator("iframe").contentFrame();

    await page.getByTestId("tool-button-text").click();
    const creationLayer = frame.getByTestId("frame-creation-layer");
    const box = await creationLayer.boundingBox();
    if (!box) throw new Error("The active frame creation layer is unavailable");
    const start = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.4 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.up();
    const textLayer = preview!.locator('[data-design-tool-kind="text"]').last();
    await expect(textLayer).toHaveCount(1);
    await page.keyboard.type("Glass");

    const textBox = (await textLayer.boundingBox())!;
    await page.mouse.click(textBox.x + textBox.width / 2, textBox.y + textBox.height / 2);
    await expect(page.getByTestId("glass-level-increment")).toBeVisible();
    await page.getByTestId("glass-level-increment").click();

    const iframe = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
    const tracked = await Promise.all(
      (await iframe.locator('[data-design-tool-kind="text"]').all()).map((layer) =>
        layer.evaluate((element) => element.getAttribute("data-design-tool-glass")),
      ),
    );
    expect(tracked).toContain("10");
  });

  test("keeps glass across undo and redo", async ({ page }) => {
    await drawRectangle(page);
    await selectRectangle(page);
    await page.getByTestId("glass-level-increment").click();
    await expect.poll(() => shapeState(page)).toEqual({
      glassAttr: "10",
      childFill: expect.stringContaining("url(#"),
      gradientCount: 1,
    });

    await page.keyboard.press("Control+z");
    await expect.poll(() => shapeState(page)).toEqual({ glassAttr: null, childFill: "#d9d9d9", gradientCount: 0 });

    await page.keyboard.press("Control+Shift+z");
    await expect.poll(() => shapeState(page).then((state) => state.childFill)).toContain("url(#");
  });

  test("carries glass into duplicates and delete-undo restores", async ({ page }) => {
    await drawRectangle(page);
    await selectRectangle(page);
    await page.getByTestId("glass-level-increment").click();
    await expect.poll(() => shapeState(page)).toEqual({
      glassAttr: "10",
      childFill: expect.stringContaining("url(#"),
      gradientCount: 1,
    });

    // Duplicate carries the gradient over.
    await page.keyboard.press("Control+d");
    const iframe = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
    await expect.poll(() => iframe.locator('[data-design-tool-kind="rectangle"]').count()).toBe(2);
    const fills = await Promise.all(
      (await iframe.locator('[data-design-tool-kind="rectangle"]').all()).map((shape) =>
        shape.evaluate((element) => ({
          glass: element.getAttribute("data-design-tool-glass"),
          fill: element.querySelector("rect")?.getAttribute("fill") ?? null,
        })),
      ),
    );
    for (const entry of fills) {
      expect(entry.glass).toBe("10");
      expect(entry.fill).toContain("url(#");
    }

    // Deleting and undoing restores the glassy appearance from the snapshot.
    await page.keyboard.press("Delete");
    await expect.poll(() => iframe.locator('[data-design-tool-kind="rectangle"]').count()).toBe(0);
    await page.keyboard.press("Control+z");
    await expect.poll(() => iframe.locator('[data-design-tool-kind="rectangle"]').count()).toBe(2);
    const restored = await Promise.all(
      (await iframe.locator('[data-design-tool-kind="rectangle"]').all()).map((shape) =>
        shape.evaluate((element) => element.querySelector("rect")?.getAttribute("fill") ?? null),
      ),
    );
    for (const fill of restored) {
      expect(fill).toContain("#d9d9d9");
    }
  });
});
