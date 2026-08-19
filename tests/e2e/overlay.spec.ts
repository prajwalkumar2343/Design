import { expect, test, type Locator, type Page } from "@playwright/test";

async function openDesktop(page: Page) {
  await page.goto("/?demo=1");
  const frame = page.locator('[data-frame-id="desktop"]');
  const preview = frame.locator("iframe").contentFrame();
  const heading = preview.getByRole("heading", { name: "Make room for better ideas." });
  await expect(frame).toHaveAttribute("data-bridge-status", "ready");
  await heading.click();
  await expect(page.getByTestId("node-selection-box")).toBeVisible();
  return { frame, preview, heading };
}

async function drag(page: Page, locator: Locator, dx: number, dy: number) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Gesture target has no bounding box");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
  await page.mouse.up();
}

test.describe("iframe node overlays", () => {
  test("shows a subtle hover outline and selected handles", async ({ page }) => {
    await page.goto("/?demo=1");
    const frame = page.locator('[data-frame-id="desktop"]');
    const preview = frame.locator("iframe").contentFrame();
    const heading = preview.getByRole("heading", { name: "Make room for better ideas." });

    await expect(frame).toHaveAttribute("data-bridge-status", "ready");
    await heading.hover();
    await expect(page.getByTestId("node-hover-outline")).toBeVisible();

    await heading.click();
    await expect(page.getByTestId("node-hover-outline")).toHaveCount(0);
    await expect(page.getByTestId("node-selection-box")).toBeVisible();
    await expect(page.getByRole("button", { name: "Resize selection from nw" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rotate selection" })).toBeVisible();
  });

  test("shift-clicks a second iframe node for multi-selection", async ({ page }) => {
    const { preview } = await openDesktop(page);
    const paragraph = preview.getByText(/A quiet place for teams/);
    await paragraph.click({ modifiers: ["Shift"] });

    await expect(page.locator(".node-selection-outline")).toHaveCount(2);
    await expect(page.getByTestId("node-selection-box")).toBeVisible();
  });

  test("moves a selected node through one undoable bridge gesture", async ({ page }) => {
    const { heading } = await openDesktop(page);
    const before = await heading.evaluate((element) => element.getAttribute("style") ?? "");
    await drag(page, page.getByTestId("node-selection-box"), 42, 24);
    await expect.poll(() => heading.evaluate((element) => element.getAttribute("style") ?? "")).not.toBe(before);
    await expect(page.getByTestId("node-selection-box")).toBeVisible();
    await expect(page.locator('[data-testid="canvas-surface"]')).toHaveAttribute("data-interaction", "idle");
    const moved = await heading.evaluate((element) => element.style.transform);
    expect(moved).toContain("translate(");

    await page.keyboard.press("Control+z");
    await expect.poll(() => heading.evaluate((element) => element.getAttribute("style") ?? "")).toBe(before);
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(() => heading.evaluate((element) => element.style.transform)).toBe(moved);
  });

  test("selects the topmost layer when clicking inside a selected container", async ({ page }) => {
    const { frame, preview } = await openDesktop(page);
    const section = preview.locator("main > section");
    const heading = preview.locator("main h1");

    await section.dispatchEvent("click", { bubbles: true, clientX: 300, clientY: 500 });
    await expect.poll(() => frame.getAttribute("data-bridge-selected-element-id")).toContain("section[1]");
    await expect(page.getByTestId("node-selection-box")).toBeVisible();

    const headingBox = await heading.boundingBox();
    if (!headingBox) throw new Error("The nested heading is unavailable");
    await page.mouse.click(headingBox.x + headingBox.width / 2, headingBox.y + headingBox.height / 2);

    await expect.poll(() => frame.getAttribute("data-bridge-selected-element-id")).toContain("h1[1]");
    await expect(page.getByTestId("node-selection-box")).toBeVisible();

    const before = await heading.evaluate((element) => element.getAttribute("style") ?? "");
    const box = await page.getByTestId("node-selection-box").boundingBox();
    if (!box) throw new Error("The selection box is unavailable");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 48, box.y + box.height / 2 + 26, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => heading.evaluate((element) => element.getAttribute("style") ?? "")).not.toBe(before);
  });

  test("enters inline text editing from the selected overlay and commits one undoable edit", async ({ page }) => {
    const { preview, heading } = await openDesktop(page);
    await page.getByTestId("node-selection-box").dblclick();

    const editableHeading = preview.locator("h1");
    await expect(editableHeading).toHaveAttribute("contenteditable", "true");
    await editableHeading.fill("Make room for quieter ideas.");
    await editableHeading.press("Enter");
    await expect.poll(() => editableHeading.innerText()).toBe("Make room for quieter ideas.");
    await expect(editableHeading).not.toHaveAttribute("data-design-tool-editing", "true");
    await expect(page.getByTestId("node-selection-box")).toBeVisible();

    await page.getByTestId("undo-button").click();
    await expect.poll(() => editableHeading.innerText()).toBe("Make room for better ideas.");
    await expect(page.getByTestId("node-selection-box")).toBeVisible();
  });

  test("starts text editing with Enter and Escape restores the original text", async ({ page }) => {
    const { preview, heading } = await openDesktop(page);
    await heading.press("Enter");
    const editableHeading = preview.locator("h1");
    await expect(editableHeading).toHaveAttribute("contenteditable", "true");
    await editableHeading.fill("Discard this text");
    await editableHeading.press("Escape");
    await expect.poll(() => editableHeading.innerText()).toBe("Make room for better ideas.");
    await expect(editableHeading).not.toHaveAttribute("data-design-tool-editing", "true");
    await expect(page.getByTestId("node-selection-box")).toBeVisible();
    await expect(page.getByTestId("undo-button")).toBeDisabled();
  });

  test("commits property edits on Enter and keeps the overlay synchronized", async ({ page }) => {
    const { preview } = await openDesktop(page);
    const property = page.getByTestId("property-node-width");
    await property.fill("760px");
    await property.press("Enter");

    const heading = preview.locator("h1");
    await expect.poll(() => heading.evaluate((element) => element.getBoundingClientRect().width)).toBe(760);
    await expect.poll(async () => {
      const box = await page.getByTestId("node-selection-box").boundingBox();
      return box?.width ?? 0;
    }).toBeGreaterThan(0);
    await expect(page.getByTestId("node-selection-box")).toBeVisible();
    await expect(page.getByTestId("undo-button")).toBeEnabled();
  });

  test("resizes from an edge while enforcing a usable minimum", async ({ page }) => {
    const { heading } = await openDesktop(page);
    const beforeWidth = await heading.evaluate((element) => element.getBoundingClientRect().width);
    await drag(page, page.getByTestId("node-resize-handle-e"), -600, 0);
    await expect.poll(() => heading.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(beforeWidth);
    const inlineWidth = await heading.evaluate((element) => element.style.width);
    expect(Number.parseFloat(inlineWidth)).toBeGreaterThanOrEqual(24);
  });

  test("reshapes a constrained content-box image instead of preserving accidental CSS constraints", async ({ page }) => {
    const { preview } = await openDesktop(page);
    const image = preview.locator("#resize-image-fixture");
    await preview.locator("body").evaluate((body) => {
      const fixture = document.createElement("img");
      fixture.id = "resize-image-fixture";
      fixture.alt = "Resize image fixture";
      fixture.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      fixture.style.cssText = [
        "position: fixed",
        "left: 260px",
        "top: 220px",
        "width: 180px",
        "height: 120px",
        "max-width: 180px",
        "padding: 8px",
        "border: 4px solid black",
        "box-sizing: content-box",
        "object-fit: cover",
      ].join(";");
      body.appendChild(fixture);
    });
    await image.click();
    await expect(page.getByTestId("node-selection-box")).toBeVisible();

    const before = await image.evaluate((element) => element.getBoundingClientRect().toJSON());
    await drag(page, page.getByTestId("node-resize-handle-e"), 70, 0);
    await expect.poll(() => image.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(before.width + 50);
    const after = await image.evaluate((element) => ({
      rect: element.getBoundingClientRect().toJSON(),
      styleWidth: element.style.width,
      styleHeight: element.style.height,
      boxSizing: getComputedStyle(element).boxSizing,
      maxWidth: getComputedStyle(element).maxWidth,
      objectFit: getComputedStyle(element).objectFit,
    }));
    expect(Math.abs(after.rect.height - before.height)).toBeLessThan(2);
    expect(after.boxSizing).toBe("border-box");
    expect(after.maxWidth).toBe("none");
    expect(after.objectFit).toBe("cover");

    await page.getByTestId("undo-button").click();
    await expect.poll(() => image.evaluate((element) => element.getBoundingClientRect().toJSON())).toEqual(before);
    await page.getByTestId("redo-button").click();
    await expect.poll(() => image.evaluate((element) => element.style.width)).toBe(after.styleWidth);
    await expect.poll(() => image.evaluate((element) => element.getBoundingClientRect().width)).toBe(after.rect.width);
  });

  test("resizes inline text as a wrapping box and preserves cumulative captured moves in history", async ({ page }) => {
    const { preview } = await openDesktop(page);
    const text = preview.locator("#resize-text-fixture");
    await preview.locator("body").evaluate((body) => {
      const fixture = document.createElement("span");
      fixture.id = "resize-text-fixture";
      fixture.textContent = "A useful text box wraps words when its width changes";
      fixture.style.cssText = [
        "position: fixed",
        "left: 300px",
        "top: 420px",
        "display: inline",
        "padding: 6px",
        "border: 2px solid transparent",
        "box-sizing: content-box",
        "font: 20px/1.2 sans-serif",
      ].join(";");
      body.appendChild(fixture);
    });
    await text.click();
    await expect(page.getByTestId("node-selection-box")).toBeVisible();

    const before = await text.evaluate((element) => element.getBoundingClientRect().toJSON());
    await drag(page, page.getByTestId("node-resize-handle-e"), -110, 0);
    await expect.poll(() => text.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(before.width - 80);
    const resized = await text.evaluate((element) => ({
      rect: element.getBoundingClientRect().toJSON(),
      inlineDisplay: element.style.display,
      display: getComputedStyle(element).display,
      boxSizing: getComputedStyle(element).boxSizing,
      whiteSpace: getComputedStyle(element).whiteSpace,
    }));
    expect(resized.rect.height).toBeGreaterThan(before.height);
    expect(resized.inlineDisplay).toBe("inline-block");
    expect(resized.boxSizing).toBe("border-box");
    expect(resized.whiteSpace).toBe("normal");

    await page.getByTestId("node-selection-box").dblclick();
    await expect(text).toHaveAttribute("contenteditable", "true");
    await text.press("Escape");
    await expect(text).not.toHaveAttribute("data-design-tool-editing", "true");

    const x0 = resized.rect.x;
    await drag(page, page.getByTestId("node-selection-box"), 36, 0);
    await expect.poll(() => text.evaluate((element) => element.getBoundingClientRect().x)).toBeGreaterThan(x0 + 25);
    const x1 = await text.evaluate((element) => element.getBoundingClientRect().x);
    await drag(page, page.getByTestId("node-selection-box"), 36, 0);
    await expect.poll(() => text.evaluate((element) => element.getBoundingClientRect().x)).toBeGreaterThan(x1 + 10);
    const x2 = await text.evaluate((element) => element.getBoundingClientRect().x);
    await page.getByTestId("undo-button").click();
    await expect.poll(() => text.evaluate((element) => element.getBoundingClientRect().x)).toBeCloseTo(x1, 0);
    await page.getByTestId("undo-button").click();
    await expect.poll(() => text.evaluate((element) => element.getBoundingClientRect().x)).toBeCloseTo(x0, 0);
    await page.getByTestId("redo-button").click();
    await expect.poll(() => text.evaluate((element) => element.getBoundingClientRect().x)).toBeCloseTo(x1, 0);
    await page.getByTestId("redo-button").click();
    await expect.poll(() => text.evaluate((element) => element.getBoundingClientRect().x)).toBeCloseTo(x2, 0);
  });

  test("keeps a freshly placed image immediately movable and resizable", async ({ page }) => {
    await page.goto("/?demo=1");
    const frame = page.locator('[data-frame-id="desktop"]');
    const preview = frame.locator("iframe").contentFrame();
    await expect(frame).toHaveAttribute("data-bridge-status", "ready");

    await page.getByTestId("tool-button-image").click();
    const creationLayer = frame.getByTestId("frame-creation-layer");
    const box = await creationLayer.boundingBox();
    if (!box || !preview) throw new Error("The active frame creation layer is unavailable");
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5 + 120, box.y + box.height * 0.5 + 80, { steps: 5 });
    await page.mouse.up();
    await page.getByTestId("canvas-image-input").setInputFiles({
      name: "pixel.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    });
    await expect.poll(() => preview.locator('[data-design-tool-kind="image"]').count()).toBe(1);
    await expect(page.getByTestId("node-selection-box")).toBeVisible();
    await expect(page.getByTestId("node-resize-handle-e")).toBeVisible();

    const image = preview.locator('[data-design-tool-kind="image"]');
    const before = await image.evaluate((element) => element.getBoundingClientRect().toJSON());
    await drag(page, page.getByTestId("node-selection-box"), 60, 30);
    await expect.poll(() => image.evaluate((element) => element.getBoundingClientRect().x)).toBeGreaterThan(before.x + 20);

    const widthBefore = await image.evaluate((element) => element.getBoundingClientRect().width);
    await drag(page, page.getByTestId("node-resize-handle-e"), 120, 0);
    await expect.poll(() => image.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(widthBefore + 60);
  });

  test("rotates with the dedicated handle and keeps handle size stable through zoom", async ({ page }) => {
    await openDesktop(page);
    const rotateHandle = page.getByTestId("node-rotation-handle");
    const beforeHandle = await rotateHandle.boundingBox();
    if (!beforeHandle) throw new Error("Rotation handle has no bounding box");
    await drag(page, rotateHandle, 70, 0);
    const heading = page.locator('[data-frame-id="desktop"] iframe').contentFrame().getByRole("heading", { name: "Make room for better ideas." });
    await expect.poll(() => heading.evaluate((element) => element.style.transform)).toContain("rotate(");

    const selectedBox = page.getByTestId("node-selection-box");
    const beforeZoom = await selectedBox.boundingBox();
    if (!beforeZoom) throw new Error("Selection box has no bounding box");
    await page.getByRole("button", { name: "Zoom in" }).click();
    const afterZoom = await page.getByTestId("node-rotation-handle").boundingBox();
    if (!afterZoom) throw new Error("Rotation handle disappeared after zoom");
    expect(Math.abs(afterZoom.width - beforeHandle.width)).toBeLessThan(3);
  });
});
