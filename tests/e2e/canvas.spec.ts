import { expect, test, type Page } from "@playwright/test";

const surfaceSelector = '[data-testid="canvas-surface"]';
const worldSelector = '[data-testid="canvas-world"]';
const frameSelector = "[data-frame-id]";

async function openCanvas(page: Page) {
  await page.goto("/?demo=1");
  await expect(page.locator(surfaceSelector)).toBeVisible();
  await expect(page.locator(worldSelector)).toBeVisible();
}

async function worldTransform(page: Page) {
  return page.locator(worldSelector).evaluate((element) => getComputedStyle(element).transform);
}

async function findBackgroundPoint(page: Page) {
  const surface = page.locator(surfaceSelector);
  const box = await surface.boundingBox();

  if (!box) {
    throw new Error("Canvas surface has no viewport box");
  }

  const point = await page.evaluate(
    ({ x, y, width, height }) => {
      const surfaceElement = document.querySelector('[data-testid="canvas-surface"]');
      if (!surfaceElement) {
        return null;
      }

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
        candidates.find(({ x, y }) => {
          const target = document.elementFromPoint(x, y);
          return (
            target &&
            surfaceElement.contains(target) &&
            !target.closest("[data-frame-id]") &&
            !(target instanceof HTMLIFrameElement)
          );
        }) ?? null
      );
    },
    box,
  );

  if (!point) {
    throw new Error("Could not find an unobscured canvas background point");
  }

  return { box, point };
}

test.describe("infinite canvas infrastructure", () => {
  test("renders visible initial frames as live iframes", async ({ page }) => {
    await openCanvas(page);

    const liveIframes = page.locator(`${frameSelector} iframe`);
    await expect.poll(() => liveIframes.count()).toBeGreaterThan(0);

    const visibleFrameIds = await page.locator(frameSelector).evaluateAll((frames) =>
      frames.flatMap((frame) => {
        const rect = frame.getBoundingClientRect();
        const isInViewport =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < window.innerWidth &&
          rect.top < window.innerHeight;

        return isInViewport && frame.getAttribute("data-frame-id")
          ? [frame.getAttribute("data-frame-id")!]
          : [];
      }),
    );

    expect(visibleFrameIds.length).toBeGreaterThan(0);
    for (const frameId of visibleFrameIds) {
      const frame = page.locator(`[data-frame-id="${frameId}"]`);
      await expect(frame.locator("iframe")).toHaveCount(1);
      await expect(frame.locator("iframe")).toBeVisible();
    }
  });

  test("ctrl-wheel zoom updates the world transform around the cursor", async ({ page }) => {
    await openCanvas(page);

    const { point } = await findBackgroundPoint(page);
    const before = await worldTransform(page);

    await page.mouse.move(point.x, point.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -240);
    await page.keyboard.up("Control");

    await expect.poll(() => worldTransform(page)).not.toBe(before);
  });

  test("dragging the canvas background updates the world transform", async ({ page }) => {
    await openCanvas(page);

    const { box, point } = await findBackgroundPoint(page);
    const before = await worldTransform(page);
    const deltaX = point.x < box.x + box.width / 2 ? 120 : -120;
    const deltaY = point.y < box.y + box.height / 2 ? 80 : -80;

    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + deltaX, point.y + deltaY, { steps: 5 });
    await page.mouse.up();

    await expect.poll(() => worldTransform(page)).not.toBe(before);
  });

  test("keeps document scrolling disabled while the canvas is infinite", async ({ page }) => {
    await openCanvas(page);

    const documentSize = await page.evaluate(() => ({
      clientHeight: document.documentElement.clientHeight,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(documentSize.scrollWidth).toBe(documentSize.clientWidth);
    expect(documentSize.scrollHeight).toBe(documentSize.clientHeight);
  });

  test("adds a responsive frame with a live HTML document", async ({ page }) => {
    await openCanvas(page);

    const frames = page.locator(frameSelector);
    const beforeCount = await frames.count();
    await page.getByTestId("add-frame-button").click();
    await expect(page.getByRole("menu", { name: "Frame presets" })).toBeVisible();
    await page.getByTestId("add-mobile-frame").click();

    await expect(frames).toHaveCount(beforeCount + 1);
    const newFrame = frames.last();
    await expect(newFrame).toHaveAttribute("data-selected", "true");
    await expect(newFrame.locator("iframe")).toHaveCount(1);
    await expect(newFrame.locator("iframe")).toHaveAttribute(
      "title",
      "Mobile · 390 × 844 preview",
    );
    await expect(
      newFrame
        .locator("iframe")
        .contentFrame()
        .getByRole("heading", { name: "Make room for better ideas." }),
    ).toBeVisible();

    const hasOverlap = await frames.evaluateAll((elements) => {
      const newest = elements.at(-1)?.getBoundingClientRect();
      if (!newest) {
        return true;
      }
      return elements.slice(0, -1).some((element) => {
        const existing = element.getBoundingClientRect();
        return !(
          newest.right <= existing.left ||
          newest.left >= existing.right ||
          newest.bottom <= existing.top ||
          newest.top >= existing.bottom
        );
      });
    });
    expect(hasOverlap).toBe(false);

    await expect(page.getByTestId("undo-button")).toBeEnabled();
    await page.getByTestId("undo-button").click();
    await expect(frames).toHaveCount(beforeCount);
    await page.getByTestId("redo-button").click();
    await expect(frames).toHaveCount(beforeCount + 1);
    await expect(frames.last()).toHaveAttribute("data-selected", "true");
  });

  test("selects and moves a frame using its title handle", async ({ page }) => {
    await openCanvas(page);

    const frame = page.locator('[data-frame-id="tablet"]');
    const handle = frame.getByRole("button", { name: /Move Tablet/ });
    const before = await frame.evaluate((element) => getComputedStyle(element).transform);
    const box = await handle.boundingBox();
    if (!box) {
      throw new Error("Frame move handle has no box");
    }

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 45, {
      steps: 6,
    });
    await page.mouse.up();

    await expect(frame).toHaveAttribute("data-selected", "true");
    await expect.poll(() =>
      frame.evaluate((element) => getComputedStyle(element).transform),
    ).not.toBe(before);
  });

  test("exposes professional zoom and fit controls", async ({ page }) => {
    await openCanvas(page);

    const before = await worldTransform(page);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(() => worldTransform(page)).not.toBe(before);

    await page.getByRole("button", { name: "Fit all frames" }).last().click();
    await expect(page.getByTestId("canvas-world")).toBeVisible();
  });

  test("activates registered tools from the keyboard and keeps shortcut conflicts explicit", async ({
    page,
  }) => {
    await openCanvas(page);

    const selectTool = page.getByTestId("tool-button-select");
    const handTool = page.getByTestId("tool-button-hand");
    const frameTool = page.getByTestId("tool-button-frame");

    await expect(selectTool).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("tool-button-rectangle")).toBeEnabled();
    await expect(page.getByTestId("tool-button-text")).toBeEnabled();
    await expect(page.getByTestId("tool-button-pen")).toBeEnabled();

    await page.keyboard.press("h");
    await expect(handTool).toHaveAttribute("aria-pressed", "true");
    await expect(selectTool).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.down(" ");
    await expect(handTool).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.up(" ");

    await page.keyboard.press("f");
    await expect(frameTool).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("menu", { name: "Frame presets" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "Frame presets" })).toBeHidden();
    await expect(selectTool).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("r");
    await expect(page.getByTestId("tool-button-rectangle")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("i");
    await expect(page.getByTestId("tool-button-image")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("tool-button-eyedropper").click();
    await expect(page.getByTestId("tool-button-eyedropper")).toHaveAttribute("aria-pressed", "true");
  });

  test("undoes and redoes a frame move through the editor shortcuts", async ({ page }) => {
    await openCanvas(page);

    const frame = page.locator('[data-frame-id="tablet"]');
    const handle = frame.getByRole("button", { name: /Move Tablet/ });
    const before = await frame.evaluate((element) => getComputedStyle(element).transform);
    const box = await handle.boundingBox();
    if (!box) {
      throw new Error("Frame move handle has no box");
    }

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 45, {
      steps: 6,
    });
    await page.mouse.up();
    const after = await frame.evaluate((element) => getComputedStyle(element).transform);
    expect(after).not.toBe(before);

    await page.keyboard.press("Control+z");
    await expect.poll(() =>
      frame.evaluate((element) => getComputedStyle(element).transform),
    ).toBe(before);

    await page.keyboard.press("Control+Shift+z");
    await expect.poll(() =>
      frame.evaluate((element) => getComputedStyle(element).transform),
    ).toBe(after);
  });

  test("keeps essential canvas controls usable on a mobile browser", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCanvas(page);

    await expect(page.getByLabel("Project header")).toBeVisible();
    await expect(page.getByLabel("Canvas controls")).toBeVisible();
    await expect(page.getByTestId("add-frame-button")).toBeVisible();
    await page.getByTestId("add-frame-button").click();
    await expect(page.getByRole("menu", { name: "Frame presets" })).toBeVisible();

    const documentSize = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(documentSize.scrollWidth).toBe(documentSize.clientWidth);
  });
});
