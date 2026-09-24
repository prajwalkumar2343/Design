import { expect, test } from "@playwright/test";

const frameSel = "[data-frame-id]";

test.describe("QA regressions", () => {
  test("tool shortcuts work while a frame document holds focus", async ({ page }) => {
    await page.goto("/?demo=1");
    const frame = page.locator('[data-frame-id="desktop"]');
    const preview = frame.locator("iframe").contentFrame();
    await expect(frame).toHaveAttribute("data-bridge-status", "ready");
    const heading = preview.getByRole("heading", { name: "Make room for better ideas." });
    await heading.click();
    await expect(page.getByTestId("node-selection-box")).toBeVisible();
    // Focus is inside the iframe now.
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");

    await page.keyboard.press("r");
    await expect(page.getByTestId("creation-mode-status")).toContainText("Rectangle mode");
    await page.keyboard.press("v");
    await expect(page.getByTestId("tool-button-select")).toHaveAttribute("aria-pressed", "true");

    // Escape forwards too — returns any active tool to select.
    await page.keyboard.press("t");
    await expect(page.getByTestId("tool-button-text")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tool-button-select")).toHaveAttribute("aria-pressed", "true");
  });

  test("a click with no drag does not mint a shape", async ({ page }) => {
    await page.goto("/?demo=1");
    const frame = page.locator('[data-frame-id="desktop"]');
    const preview = frame.locator("iframe").contentFrame();
    await expect(frame).toHaveAttribute("data-bridge-status", "ready");
    const before = await preview.locator("[data-design-tool-created='true']").count();

    await page.keyboard.press("r");
    const layer = frame.getByTestId("frame-creation-layer");
    const box = (await layer.boundingBox())!;
    await page.mouse.move(box.x + 60, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 61, box.y + 61);
    await page.mouse.up();

    // Give the bridge a beat, then assert nothing was created.
    await page.waitForTimeout(400);
    expect(await preview.locator("[data-design-tool-created='true']").count()).toBe(before);
  });

  test("shader menu shows thumbnails and only mounts WebGL on hover", async ({ page }) => {
    await page.goto("/?demo=1");
    await page.waitForSelector(`${frameSel} iframe`, { timeout: 15000 });
    await page.getByTestId("tool-button-shader").click();
    const menu = page.getByTestId("shader-menu");
    await expect(menu).toBeVisible();

    // Thumbnails render with zero live canvases mounted.
    await expect(menu.locator(".shader-card-thumb").first()).toBeVisible();
    await expect(menu.locator("canvas")).toHaveCount(0);

    // Hovering a card mounts its live preview; leaving unmounts it.
    const card = page.getByTestId("shader-card-mesh-gradient");
    await card.hover();
    await expect(menu.locator("canvas")).toHaveCount(1, { timeout: 8000 });
    await page.getByTestId("shader-search-input").hover();
    await expect(menu.locator("canvas")).toHaveCount(0, { timeout: 8000 });
  });

  test("deletes the selected frame with Delete and restores it on undo", async ({ page }) => {
    await page.goto("/?demo=1");
    const desktop = page.locator('[data-frame-id="desktop"]');
    await expect(desktop).toBeVisible();
    // The first demo frame starts selected — Delete must remove the frame itself.
    await expect(desktop).toHaveAttribute("data-selected", "true");

    await page.keyboard.press("Delete");
    await expect(desktop).toHaveCount(0);
    // Sibling frames on the same page are untouched.
    await expect(page.locator('[data-frame-id="tablet"]')).toHaveCount(1);

    await page.keyboard.press("Meta+z");
    await expect(desktop).toHaveCount(1);
  });

  test("moves an unselected frame by dragging its body", async ({ page }) => {
    await page.goto("/?demo=1");
    const tablet = page.locator('[data-frame-id="tablet"]');
    const grabLayer = tablet.getByRole("button", { name: /Select Tablet/ });
    await expect(grabLayer).toBeVisible();
    const before = await tablet.evaluate((element) => getComputedStyle(element).transform);
    const box = await grabLayer.boundingBox();
    if (!box) throw new Error("Frame activation layer has no box");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 6 });
    await page.mouse.up();

    await expect(tablet).toHaveAttribute("data-selected", "true");
    await expect
      .poll(() => tablet.evaluate((element) => getComputedStyle(element).transform))
      .not.toBe(before);
  });
});
