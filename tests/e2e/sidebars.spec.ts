import { expect, test } from "@playwright/test";

async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/?demo=1");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await expect(page.locator('[data-frame-id="desktop"]')).toHaveAttribute("data-bridge-status", "ready");
}

async function worldTransform(page: import("@playwright/test").Page) {
  return page.getByTestId("canvas-world").evaluate((element) => getComputedStyle(element).transform);
}

async function backgroundPoint(page: import("@playwright/test").Page) {
  const surface = page.getByTestId("canvas-surface");
  const box = await surface.boundingBox();
  if (!box) throw new Error("Canvas surface has no viewport box");
  const point = await page.evaluate(({ x, y, width, height }) => {
    const surfaceElement = document.querySelector('[data-testid="canvas-surface"]');
    if (!surfaceElement) return null;
    const candidates = [];
    for (let row = 1; row < 6; row += 1) {
      for (let column = 1; column < 8; column += 1) {
        candidates.push({ x: x + (width * column) / 8, y: y + (height * row) / 6 });
      }
    }
    return candidates.find(({ x: candidateX, y: candidateY }) => {
      const target = document.elementFromPoint(candidateX, candidateY);
      return target && surfaceElement.contains(target) && !target.closest("[data-frame-id]") && !target.closest("[data-canvas-control]");
    }) ?? null;
  }, box);
  if (!point) throw new Error("Could not find an unobscured canvas background point");
  return point;
}

function layerButton(page: import("@playwright/test").Page, name: string) {
  // Match exactly: container rows now carry descriptive names that can contain
  // a descendant's label as a substring.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.locator(".layer-name").filter({ hasText: new RegExp(`^${escaped}$`) }).first().locator("xpath=..");
}

test.describe("contextual sidebars", () => {
  test("keeps wheel scrolling inside each sidebar and preserves canvas wheel behavior", async ({ page }) => {
    // Purpose-built panels fit without scrolling at full height; use a shorter
    // viewport so both sidebars genuinely overflow and wheel containment can
    // be observed.
    await page.setViewportSize({ width: 1440, height: 620 });
    await openEditor(page);

    const left = page.locator(".sidebar-panel-content");
    await expect.poll(async () => Number(await left.evaluate((element) => element.scrollHeight - element.clientHeight))).toBeGreaterThan(0);
    const beforeLeftTransform = await worldTransform(page);
    const beforeLeftScroll = await left.evaluate((element) => element.scrollTop);
    const leftBox = await left.boundingBox();
    if (!leftBox) throw new Error("Left sidebar has no scroll box");
    await page.mouse.move(leftBox.x + leftBox.width / 2, leftBox.y + leftBox.height / 2);
    await page.mouse.wheel(0, 420);
    await expect.poll(() => left.evaluate((element) => element.scrollTop)).toBeGreaterThan(beforeLeftScroll);
    expect(await worldTransform(page)).toBe(beforeLeftTransform);

    const heading = page.locator('[data-frame-id="desktop"] iframe').contentFrame().getByRole("heading", { name: "Make room for better ideas." });
    await heading.click();
    await expect(page.getByTestId("property-node-width")).toBeVisible();
    const right = page.locator(".properties-scroll");
    await expect.poll(async () => Number(await right.evaluate((element) => element.scrollHeight - element.clientHeight))).toBeGreaterThan(0);
    const beforeRightTransform = await worldTransform(page);
    const beforeRightScroll = await right.evaluate((element) => element.scrollTop);
    const rightBox = await right.boundingBox();
    if (!rightBox) throw new Error("Right sidebar has no scroll box");
    await page.mouse.move(rightBox.x + rightBox.width / 2, rightBox.y + rightBox.height / 2);
    await page.mouse.wheel(0, 420);
    await expect.poll(() => right.evaluate((element) => element.scrollTop)).toBeGreaterThan(beforeRightScroll);
    expect(await worldTransform(page)).toBe(beforeRightTransform);

    const point = await backgroundPoint(page);
    const beforeCanvasTransform = await worldTransform(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, 180);
    await expect.poll(() => worldTransform(page)).not.toBe(beforeCanvasTransform);
  });

  test("collapses and reopens both contextual panels", async ({ page }) => {
    await openEditor(page);
    await expect(page.getByTestId("left-sidebar")).toBeVisible();
    await expect(page.getByTestId("properties-panel")).toBeVisible();

    await page.getByTestId("left-sidebar-toggle").click();
    await expect(page.locator(".left-sidebar-panel")).toHaveCount(0);
    await page.getByTestId("left-sidebar-toggle").click();
    await expect(page.locator(".left-sidebar-panel")).toBeVisible();

    await page.getByTestId("right-sidebar-toggle").click();
    await expect(page.locator(".properties-panel-inner")).toHaveCount(0);
    await page.getByTestId("right-sidebar-toggle").click();
    await expect(page.locator(".properties-panel-inner")).toBeVisible();
  });

  test("adds, renames, and switches normalized pages", async ({ page }) => {
    await openEditor(page);
    await page.getByTestId("sidebar-tab-pages").click();
    await page.getByTestId("add-page-button").click();
    await expect(page.getByText("Page 2", { exact: true })).toBeVisible();

    await page.getByTestId("page-rename-page-2").click();
    const input = page.locator(".sidebar-inline-input").last();
    await input.fill("Checkout");
    await input.press("Enter");
    await expect(page.getByText("Checkout", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Checkout", exact: true }).click();
    await expect(page.locator('[data-frame-id="desktop"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Page 1", exact: true }).click();
    await expect(page.locator('[data-frame-id="desktop"]')).toBeVisible();
  });

  test("keeps layer selection in sync and supports lock/hide controls", async ({ page }) => {
    await openEditor(page);
    const preview = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
    const headingElement = preview.locator("h1");
    const headingLayer = layerButton(page, "Make room for better ideas.");
    await expect(headingLayer).toBeVisible();
    await headingLayer.click();
    await expect(page.getByTestId("property-node-width")).toBeVisible();

    const headingRow = headingLayer.locator("xpath=..");
    const lock = headingRow.locator(".layer-action-button").nth(0);
    await headingRow.hover();
    await lock.click();
    await expect(headingRow.locator('button[aria-label^="Unlock Make room"]')).toBeVisible();

    await headingRow.locator('button[aria-label^="Hide Make room"]' ).click();
    await expect.poll(() => headingElement.evaluate((element) => getComputedStyle(element).display)).toBe("none");
    await headingRow.locator('button[aria-label^="Show Make room"]' ).click();
    await expect.poll(() => headingElement.evaluate((element) => getComputedStyle(element).display)).not.toBe("none");
  });

  test("edits a live property with bridge-backed undo and redo", async ({ page }) => {
    await openEditor(page);
    const heading = page.locator('[data-frame-id="desktop"] iframe').contentFrame().getByRole("heading", { name: "Make room for better ideas." });
    const before = await heading.evaluate((element) => element.getAttribute("style") ?? "");
    await heading.click();
    const width = page.getByTestId("property-node-width");
    await expect(width).toBeVisible();
    await width.fill("180px");
    await width.press("Enter");
    await expect.poll(() => heading.evaluate((element) => element.style.width)).toBe("180px");

    await page.keyboard.press("Control+z");
    await expect.poll(() => heading.evaluate((element) => element.getAttribute("style") ?? "")).toBe(before);
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(() => heading.evaluate((element) => element.style.width)).toBe("180px");
  });

  test("highlights the matching element on the canvas when hovering a layer row", async ({ page }) => {
    await openEditor(page);
    const heading = page.locator('[data-frame-id="desktop"] iframe').contentFrame().getByRole("heading", { name: "Make room for better ideas." });
    await expect(heading).toBeVisible();
    const headingBox = await heading.boundingBox();
    if (!headingBox) throw new Error("Heading has no box");

    await layerButton(page, "Make room for better ideas.").hover();

    const outline = page.getByTestId("node-hover-outline");
    await expect(outline).toBeVisible();
    const outlineBox = await outline.boundingBox();
    if (!outlineBox) throw new Error("Hover outline has no box");

    const centerX = headingBox.x + headingBox.width / 2;
    const centerY = headingBox.y + headingBox.height / 2;
    expect(centerX).toBeGreaterThan(outlineBox.x - 2);
    expect(centerX).toBeLessThan(outlineBox.x + outlineBox.width + 2);
    expect(centerY).toBeGreaterThan(outlineBox.y - 2);
    expect(centerY).toBeLessThan(outlineBox.y + outlineBox.height + 2);

    await page.locator(".sidebar-search").hover();
    await expect(outline).toHaveCount(0);
  });

  test("highlights the matching layer row when hovering an element on the canvas", async ({ page }) => {
    await openEditor(page);
    const heading = page.locator('[data-frame-id="desktop"] iframe').contentFrame().getByRole("heading", { name: "Make room for better ideas." });
    await heading.hover();

    const headingRow = layerButton(page, "Make room for better ideas.").locator("xpath=..");
    await expect(headingRow).toHaveClass(/is-hovered/);
  });
});
