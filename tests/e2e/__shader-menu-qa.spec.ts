import { test } from "@playwright/test";

test("capture shader menu states", async ({ page }) => {
  page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=1");
  await page.waitForLoadState("networkidle");

  // Dismiss any welcome/overlay if present, then open the shader menu via the dock button.
  await page.getByTestId("tool-button-shader").click();
  const menu = page.getByTestId("shader-menu");
  await menu.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "tmp/shader-menu-all.png" });

  // Filter by a category.
  await page.getByTestId("shader-filter-patterns").click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "tmp/shader-menu-patterns.png" });

  // Search filtering.
  await page.getByTestId("shader-filter-all").click();
  await page.getByTestId("shader-search-input").fill("grad");
  await page.waitForTimeout(800);
  await page.screenshot({ path: "tmp/shader-menu-search.png" });

  // Empty state.
  await page.getByTestId("shader-search-input").fill("zzzz");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "tmp/shader-menu-empty.png" });
});
