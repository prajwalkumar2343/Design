import { expect, test, type FrameLocator } from "@playwright/test";

async function iframePointer(preview: FrameLocator, type: "pointerdown" | "pointermove" | "pointerup", point: { x: number; y: number }, buttons = type === "pointerup" ? 0 : 1) {
  await preview.locator("body").dispatchEvent(type, {
    bubbles: true,
    clientX: point.x,
    clientY: point.y,
    pointerId: 1,
    buttons,
  });
}

async function iframeKey(preview: FrameLocator, key: string) {
  await preview.locator("body").dispatchEvent("keydown", { bubbles: true, key });
}

test.describe("sandboxed iframe bridge", () => {
  test("reports ready, hover, selection, hierarchy, and computed-style inspection", async ({ page }) => {
    await page.goto("/");
    const frame = page.locator('[data-frame-id="desktop"]');
    const iframe = frame.locator("iframe");
    const preview = iframe.contentFrame();

    await expect(frame).toHaveAttribute("data-bridge-status", "ready");
    await expect.poll(async () => Number(await frame.getAttribute("data-bridge-hierarchy-node-count"))).toBeGreaterThan(0);

    const heading = preview.getByRole("heading", { name: "Make room for better ideas." });
    await heading.hover();
    await expect(frame).toHaveAttribute("data-bridge-hovered-element-id", /.+/);

    await heading.click();
    await expect(frame).toHaveAttribute("data-bridge-selected-element-id", /.+/);
    await expect(frame).toHaveAttribute("data-bridge-inspected-tag-name", "h1");
    await expect(frame).toHaveAttribute("data-selected", "true");
  });

  test("rejects malformed child messages without changing the selected target", async ({ page }) => {
    await page.goto("/");
    const frame = page.locator('[data-frame-id="desktop"]');
    const iframe = frame.locator("iframe");
    const preview = iframe.contentFrame();
    const heading = preview.getByRole("heading", { name: "Make room for better ideas." });

    await expect(frame).toHaveAttribute("data-bridge-status", "ready");
    await heading.click();
    await expect(frame).toHaveAttribute("data-bridge-selected-element-id", /.+/);
    const before = await frame.getAttribute("data-bridge-selected-element-id");
    expect(before).toBeTruthy();

    const iframeHandle = await iframe.elementHandle();
    const childFrame = await iframeHandle?.contentFrame();
    if (!childFrame) throw new Error("Sandboxed preview frame is unavailable");
    await childFrame.evaluate(() => {
      window.parent.postMessage({
        protocol: "design-tool/iframe-bridge",
        version: 999,
        channel: "wrong-channel",
        frameId: "desktop",
        type: "event",
        event: "select",
        target: null,
        point: { x: 0, y: 0 },
      }, "*");
    });

    await page.waitForTimeout(50);
    await expect(frame).toHaveAttribute("data-bridge-selected-element-id", before!);
  });

  test("creates real bridge-backed layers, keeps text editable, and reverses insertion", async ({ page }) => {
    await page.goto("/");
    const frame = page.locator('[data-frame-id="desktop"]');
    const iframe = frame.locator("iframe");
    const preview = iframe.contentFrame();
    const box = await iframe.boundingBox();
    if (!box || !preview) throw new Error("Live desktop frame is unavailable");
    await expect(frame).toHaveAttribute("data-bridge-status", "ready");
    const initialHierarchyCount = Number(await frame.getAttribute("data-bridge-hierarchy-node-count"));

    await page.getByTestId("tool-button-rectangle").click();
    await iframePointer(preview, "pointerdown", { x: 520, y: 180 });
    await iframePointer(preview, "pointermove", { x: 820, y: 315 });
    await iframePointer(preview, "pointerup", { x: 820, y: 315 });
    await expect.poll(() => preview.locator('[data-design-tool-kind="rectangle"]').count()).toBe(1);
    const rectangleId = await preview.locator('[data-design-tool-kind="rectangle"]').getAttribute("data-design-element-id");
    expect(rectangleId).toBeTruthy();

    await page.getByTestId("tool-button-text").click();
    await iframePointer(preview, "pointerdown", { x: 980, y: 180 });
    await iframePointer(preview, "pointerup", { x: 980, y: 180 });
    const textLayer = preview.locator('[data-design-tool-kind="text"]').last();
    await expect(textLayer).toHaveAttribute("contenteditable", "true");
    await textLayer.fill("Bridge text");
    await expect(textLayer).toHaveText("Bridge text");

    await page.getByTestId("tool-button-pen").click();
    await iframePointer(preview, "pointerdown", { x: 560, y: 410 });
    await iframePointer(preview, "pointerup", { x: 560, y: 410 });
    await iframePointer(preview, "pointerdown", { x: 720, y: 460 });
    await iframePointer(preview, "pointerup", { x: 720, y: 460 });
    await iframeKey(preview, "Enter");
    await expect.poll(() => preview.locator('[data-design-tool-kind="path"]').count()).toBe(1);

    await page.getByTestId("tool-button-comment").click();
    await iframePointer(preview, "pointerdown", { x: 1080, y: 400 });
    await iframePointer(preview, "pointerup", { x: 1080, y: 400 });
    await expect(page.getByTestId("comment-marker")).toHaveCount(1);

    await page.getByTestId("tool-button-eyedropper").click();
    await preview.getByRole("heading", { name: "Make room for better ideas." }).hover();
    await expect(page.getByTestId("eyedropper-readout")).toBeVisible();

    await page.getByTestId("tool-button-image").click();
    await expect(page.getByTestId("tool-button-image")).toHaveAttribute("aria-pressed", "true");
    await iframePointer(preview, "pointerdown", { x: 1100, y: 560 });
    await iframePointer(preview, "pointerup", { x: 1100, y: 560 });
    await page.getByTestId("canvas-image-input").setInputFiles({
      name: "pixel.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    });
    await expect.poll(() => preview.locator('[data-design-tool-kind="image"]').count()).toBe(1);
    await expect.poll(async () => Number(await frame.getAttribute("data-bridge-hierarchy-node-count"))).toBeGreaterThan(initialHierarchyCount);

    await page.getByTestId("undo-button").click();
    await expect.poll(() => preview.locator('[data-design-tool-kind="image"]').count()).toBe(0);
    await page.getByTestId("redo-button").click();
    await expect.poll(() => preview.locator('[data-design-tool-kind="image"]').count()).toBe(1);
  });

  test("creates and selects a shape through ordinary canvas pointer interaction", async ({ page }) => {
    await page.goto("/");
    const frame = page.locator('[data-frame-id="desktop"]');
    const preview = frame.locator("iframe").contentFrame();
    await page.getByTestId("tool-button-rectangle").click();
    const creationLayer = frame.getByTestId("frame-creation-layer");
    const box = await creationLayer.boundingBox();
    if (!box || !preview) throw new Error("The active frame creation layer is unavailable");

    await expect(page.getByTestId("creation-mode-status")).toContainText("Rectangle mode");

    const start = { x: box.x + box.width * 0.32, y: box.y + box.height * 0.28 };
    const end = { x: start.x + 120, y: start.y + 82 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();

    await expect.poll(() => preview.locator('[data-design-tool-kind="rectangle"]').count()).toBe(1);
    await expect(page.locator("[data-testid^='node-selection-outline-']")).toHaveCount(1);

    await page.getByTestId("undo-button").click();
    await expect.poll(() => preview.locator('[data-design-tool-kind="rectangle"]').count()).toBe(0);
    await page.getByTestId("redo-button").click();
    await expect.poll(() => preview.locator('[data-design-tool-kind="rectangle"]').count()).toBe(1);
  });

  test("shows an actionable error when image picking receives a non-image file", async ({ page }) => {
    await page.goto("/");
    const frame = page.locator('[data-frame-id="desktop"]');
    await page.getByTestId("tool-button-image").click();
    const creationLayer = frame.getByTestId("frame-creation-layer");
    const box = await creationLayer.boundingBox();
    if (!box) throw new Error("The active frame creation layer is unavailable");

    await page.mouse.move(box.x + box.width * 0.34, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.46, box.y + box.height * 0.42, { steps: 3 });
    await page.mouse.up();
    await page.getByTestId("canvas-image-input").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });

    await expect(page.getByTestId("creation-mode-status")).toHaveAttribute("role", "alert");
    await expect(page.getByTestId("creation-mode-status")).toContainText("not an image");
  });
});
