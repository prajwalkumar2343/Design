import { expect, test, type Page } from "@playwright/test";

const surfaceSelector = '[data-testid="canvas-surface"]';
const worldSelector = '[data-testid="canvas-world"]';
const frameSelector = "[data-frame-id]";

async function openCanvas(page: Page) {
  await page.goto("/?demo=1");
  await expect(page.locator(surfaceSelector)).toBeVisible();
  await expect(page.locator(worldSelector)).toBeVisible();
}

/** Current canvas zoom, for converting measured pixels into design units. */
async function readZoom(page: Page) {
  return page.evaluate(() => {
    const world = document.querySelector('[data-testid="canvas-world"]');
    const matrix = new DOMMatrixReadOnly(getComputedStyle(world!).transform);
    return matrix.a;
  });
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
            !(target instanceof HTMLIFrameElement) &&
            // Floating panels and docks overlay the canvas but are not
            // canvas: gestures over them scroll the panel instead of
            // moving the world.
            !target.closest("[data-canvas-control]")
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

  test("horizontal wheel gestures pan the canvas instead of zooming", async ({ page }) => {
    await openCanvas(page);

    const { point } = await findBackgroundPoint(page);
    await page.mouse.move(point.x, point.y);

    const readTransform = () => page.locator(worldSelector).evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { scale: matrix.a, tx: matrix.e, ty: matrix.f };
    });

    const before = await readTransform();
    await page.mouse.wheel(160, 0);
    await page.mouse.wheel(160, 0);
    const after = await readTransform();

    expect(after.scale).toBe(before.scale);
    expect(after.tx).not.toBe(before.tx);
    expect(after.ty).toBe(before.ty);
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
    await page.getByTestId("frame-category-mobile").click();
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

    await page.keyboard.press("Control+z");
    await expect(frames).toHaveCount(beforeCount);
    await page.keyboard.press("Control+Shift+z");
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

  test("zooms with ctrl-wheel and fits all frames from the keyboard", async ({ page }) => {
    await openCanvas(page);

    const { point } = await findBackgroundPoint(page);
    const before = await worldTransform(page);
    await page.mouse.move(point.x, point.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -240);
    await page.keyboard.up("Control");
    await expect.poll(() => worldTransform(page)).not.toBe(before);

    await page.keyboard.press("0");
    await expect(page.getByTestId("canvas-world")).toBeVisible();
  });

  test("activates registered tools from the keyboard and keeps shortcut conflicts explicit", async ({
    page,
  }) => {
    await openCanvas(page);

    const selectTool = page.getByTestId("tool-button-select");
    const handTool = page.getByTestId("tool-button-hand");

    await expect(selectTool).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("tool-button-text")).toBeEnabled();

    await page.keyboard.press("h");
    await expect(handTool).toHaveAttribute("aria-pressed", "true");
    await expect(selectTool).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.down(" ");
    await expect(handTool).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.up(" ");

    await page.keyboard.press("f");
    await expect(page.getByRole("menu", { name: "Frame presets" })).toBeVisible();
    await expect(page.getByTestId("add-frame-button")).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "Frame presets" })).toBeHidden();
    await expect(selectTool).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("r");
    await expect(page.getByTestId("creation-mode-status")).toContainText("Rectangle mode");
    await page.keyboard.press("i");
    await expect(page.getByTestId("tool-button-image")).toHaveAttribute("aria-pressed", "true");
  });

  test("toggles a tool back to select when its button is clicked again", async ({ page }) => {
    await openCanvas(page);

    const selectTool = page.getByTestId("tool-button-select");
    const textTool = page.getByTestId("tool-button-text");
    const handTool = page.getByTestId("tool-button-hand");

    await expect(selectTool).toHaveAttribute("aria-pressed", "true");
    await textTool.click();
    await expect(textTool).toHaveAttribute("aria-pressed", "true");
    await textTool.click();
    await expect(textTool).toHaveAttribute("aria-pressed", "false");
    await expect(selectTool).toHaveAttribute("aria-pressed", "true");

    await handTool.click();
    await expect(handTool).toHaveAttribute("aria-pressed", "true");
    await handTool.click();
    await expect(handTool).toHaveAttribute("aria-pressed", "false");
    await expect(selectTool).toHaveAttribute("aria-pressed", "true");
  });

  test("closing the frame menu with its button again returns to select", async ({ page }) => {
    await openCanvas(page);

    const addFrameButton = page.getByTestId("add-frame-button");
    await addFrameButton.click();
    await expect(addFrameButton).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("menu", { name: "Frame presets" })).toBeVisible();
    await addFrameButton.click();
    await expect(addFrameButton).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("tool-button-select")).toHaveAttribute("aria-pressed", "true");
  });

  test("auto-deselects a shape tool after drawing and returns to select", async ({ page }) => {
    await openCanvas(page);
    const frame = page.locator('[data-frame-id="desktop"]');
    const preview = frame.locator("iframe").contentFrame();

    const selectTool = page.getByTestId("tool-button-select");
    await page.keyboard.press("r");
    await expect(page.getByTestId("creation-mode-status")).toContainText("Rectangle mode");

    const creationLayer = frame.getByTestId("frame-creation-layer");
    const box = await creationLayer.boundingBox();
    if (!box || !preview) throw new Error("The active frame creation layer is unavailable");

    const start = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.25 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 120, start.y + 80, { steps: 4 });
    await page.mouse.up();

    await expect.poll(() => preview.locator('[data-design-tool-kind="rectangle"]').count()).toBe(1);
    await expect(selectTool).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("creation-mode-status")).toHaveCount(0);
  });

  test("keeps the text tool selected after creating a text layer", async ({ page }) => {
    await openCanvas(page);
    const frame = page.locator('[data-frame-id="desktop"]');

    const textTool = page.getByTestId("tool-button-text");
    await textTool.click();
    await expect(textTool).toHaveAttribute("aria-pressed", "true");

    const creationLayer = frame.getByTestId("frame-creation-layer");
    const box = await creationLayer.boundingBox();
    if (!box) throw new Error("The active frame creation layer is unavailable");

    const start = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 60, start.y + 24, { steps: 3 });
    await page.mouse.up();

    await expect(textTool).toHaveAttribute("aria-pressed", "true");
  });

  test("types straight into a fresh text layer with character-level backspace", async ({ page }) => {
    await openCanvas(page);
    const frame = page.locator('[data-frame-id="desktop"]');
    const preview = frame.locator("iframe").contentFrame();

    const textTool = page.getByTestId("tool-button-text");
    await textTool.click();
    const creationLayer = frame.getByTestId("frame-creation-layer");
    const box = await creationLayer.boundingBox();
    if (!box) throw new Error("The active frame creation layer is unavailable");

    const start = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.4 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 180, start.y + 30, { steps: 4 });
    await page.mouse.up();

    // The fresh layer enters editing immediately, so keystrokes reach the
    // text instead of triggering tool shortcuts.
    const textLayer = preview.locator('[data-design-tool-kind="text"]').last();
    await expect(textLayer).toHaveAttribute("data-design-tool-editing", "true");
    await page.keyboard.type("Hello", { delay: 25 });
    await expect(textLayer).toHaveText("Hello");

    // No focus ring and no selection chrome while the caret is active.
    await expect(textLayer).toHaveCSS("outline-style", "none");
    await expect(page.getByTestId("node-selection-box")).toHaveCount(0);

    // Backspace edits a character; it must never delete the whole layer.
    await page.keyboard.press("Backspace");
    await expect(textLayer).toHaveText("Hell");
    await expect(preview.locator('[data-design-tool-kind="text"]')).toHaveCount(1);

    // Enter commits; editing chrome clears for the committed layer.
    await page.keyboard.press("Enter");
    await expect(textLayer).not.toHaveAttribute("data-design-tool-editing", "true");

    // Deleting the committed selection still removes the layer itself.
    await page.getByTestId("tool-button-select").click();
    await expect(page.getByTestId("node-selection-box")).toBeVisible();
    await page.keyboard.press("Delete");
    await expect(preview.locator('[data-design-tool-kind="text"]')).toHaveCount(0);
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

  test("keeps the dragged frame tracking the pointer without snapping back to its origin", async ({ page }) => {
    await openCanvas(page);

    const frame = page.locator('[data-frame-id="tablet"]');
    const handle = frame.getByRole("button", { name: /Move Tablet/ });
    const box = await handle.boundingBox();
    if (!box) {
      throw new Error("Frame move handle has no box");
    }
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    await page.evaluate(() => {
      (window as Record<string, unknown>).__frameDragSamples = [];
      const sample = () => {
        const element = document.querySelector('[data-frame-id="tablet"]');
        const rect = element?.getBoundingClientRect();
        if (rect) {
          (window as Record<string, unknown>).__frameDragSamples = [
            ...((window as Record<string, unknown>).__frameDragSamples as unknown[]),
            { x: rect.x, y: rect.y },
          ];
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(start.x + step * 14, start.y + step * 9, { steps: 2 });
    }
    await page.mouse.up();

    const samples = await page.evaluate(() =>
      (window as Record<string, unknown>).__frameDragSamples as Array<{ x: number; y: number }>,
    );
    const originX = samples[0]?.x ?? 0;
    const finalX = samples.at(-1)?.x ?? 0;
    expect(finalX).toBeGreaterThan(originX + 60);

    let furthestX = -Infinity;
    for (const sample of samples) {
      if (sample.x > furthestX) {
        furthestX = sample.x;
        continue;
      }
      const snapBack = furthestX - sample.x;
      expect(snapBack).toBeLessThan(14);
    }
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

  test("previews a shape live while dragging and commits a crisp SVG rectangle", async ({ page }) => {
    await openCanvas(page);
    const frame = page.locator('[data-frame-id="desktop"]');
    const preview = frame.locator("iframe").contentFrame();

    await page.keyboard.press("r");
    const creationLayer = frame.getByTestId("frame-creation-layer");
    const box = await creationLayer.boundingBox();
    if (!box || !preview) throw new Error("The active frame creation layer is unavailable");

    const start = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 60, start.y + 40, { steps: 3 });

    const shapePreview = frame.getByTestId("shape-preview");
    await expect(shapePreview).toBeVisible();
    const midBox = await shapePreview.boundingBox();

    await page.mouse.move(start.x + 160, start.y + 110, { steps: 5 });
    await expect(shapePreview).toBeVisible();
    const grownBox = await shapePreview.boundingBox();
    expect(grownBox && midBox && grownBox.width > midBox.width).toBe(true);

    await page.mouse.up();
    await expect(shapePreview).toHaveCount(0);
    await expect.poll(() => preview.locator('[data-design-tool-kind="rectangle"]').count()).toBe(1);
    const rectangle = preview.locator('[data-design-tool-kind="rectangle"]');
    await expect(rectangle).toHaveAttribute("shape-rendering", "geometricPrecision");
    await expect(rectangle.locator("rect")).toHaveCount(1);
  });

  test("draws an arrow from the shape menu with a live preview and a refined arrowhead", async ({ page }) => {
    await openCanvas(page);
    const frame = page.locator('[data-frame-id="desktop"]');
    const preview = frame.locator("iframe").contentFrame();

    await page.getByTestId("shape-menu-button").click();
    await page.getByTestId("shape-menu-arrow").click();

    const creationLayer = frame.getByTestId("frame-creation-layer");
    const box = await creationLayer.boundingBox();
    if (!box || !preview) throw new Error("The active frame creation layer is unavailable");

    const start = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.45 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 140, start.y + 60, { steps: 6 });
    await expect(frame.getByTestId("shape-preview")).toBeVisible();
    await page.mouse.up();

    await expect.poll(() => preview.locator('[data-design-tool-kind="arrow"]').count()).toBe(1);
    const arrow = preview.locator('[data-design-tool-kind="arrow"]');
    await expect(arrow.locator("marker")).toHaveCount(1);
    await expect(arrow.locator("line")).toHaveAttribute("stroke-linecap", "round");
  });

  test("keeps lines and arrows following the drag direction in either direction", async ({ page }) => {
    await openCanvas(page);
    const frame = page.locator('[data-frame-id="desktop"]');
    const preview = frame.locator("iframe").contentFrame();

    await page.getByTestId("shape-menu-button").click();
    await page.getByTestId("shape-menu-arrow").click();

    const creationLayer = frame.getByTestId("frame-creation-layer");
    const box = await creationLayer.boundingBox();
    if (!box || !preview) throw new Error("The active frame creation layer is unavailable");

    const start = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.6 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 180, start.y - 90, { steps: 6 });
    await page.mouse.up();

    await expect.poll(() => preview.locator('[data-design-tool-kind="arrow"]').count()).toBe(1);
    const points = JSON.parse((await preview.locator('[data-design-tool-kind="arrow"]').getAttribute("data-design-tool-points")) || "[]") as Array<{ x: number; y: number }>;
    expect(points).toHaveLength(2);
    expect(points[1].x).toBeLessThan(points[0].x);
    expect(points[1].y).toBeLessThan(points[0].y);
  });

  test("creates text that reads horizontally with a proper wrapping width", async ({ page }) => {
    await openCanvas(page);
    const frame = page.locator('[data-frame-id="desktop"]');
    const preview = frame.locator("iframe").contentFrame();

    await page.getByTestId("tool-button-text").click();
    const creationLayer = frame.getByTestId("frame-creation-layer");
    const box = await creationLayer.boundingBox();
    if (!box || !preview) throw new Error("The active frame creation layer is unavailable");

    const start = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.4 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.up();

    const textLayer = preview.locator('[data-design-tool-kind="text"]');
    await expect(textLayer).toHaveAttribute("contenteditable", "true");
    // Wrapping width is authored in design units — measure through the camera.
    const zoom = await readZoom(page);
    const bounds = await textLayer.boundingBox();
    expect(bounds && bounds.width / zoom).toBeGreaterThan(150);
    expect(bounds && bounds.height / zoom).toBeLessThan(100);
    await expect(textLayer).toHaveCSS("white-space", "pre-wrap");
    await expect(textLayer).toHaveCSS("line-height", "24px");
  });

  test("adjusts the corner radius with the slider on draw and on a selected rectangle", async ({ page }) => {
    await openCanvas(page);
    const frame = page.locator('[data-frame-id="desktop"]');
    const preview = frame.locator("iframe").contentFrame();

    await page.keyboard.press("r");
    const radiusSlider = page.getByTestId("shape-radius-slider");
    await expect(radiusSlider).toBeVisible();
    await radiusSlider.fill("16");

    const creationLayer = frame.getByTestId("frame-creation-layer");
    const box = await creationLayer.boundingBox();
    if (!box || !preview) throw new Error("The active frame creation layer is unavailable");

    const start = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 160, start.y + 100, { steps: 4 });
    await page.mouse.up();

    const rectangle = preview.locator('[data-design-tool-kind="rectangle"]');
    await expect.poll(() => rectangle.count()).toBe(1);
    await expect(rectangle).toHaveAttribute("data-design-tool-radius", "16");
    await expect(rectangle.locator("rect")).toHaveAttribute("rx", "16");

    await expect(radiusSlider).toBeVisible();
    await expect(radiusSlider).toHaveValue("16");
    await radiusSlider.fill("24");
    await expect(rectangle.locator("rect")).toHaveAttribute("rx", "24");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Control+z");
    await expect.poll(() => rectangle.locator("rect").getAttribute("rx")).toBe("16");
  });
});
