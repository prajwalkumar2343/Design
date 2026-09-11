import { expect, test } from "@playwright/test";

const surfaceSelector = '[data-testid="canvas-surface"]';
const frameSelector = "[data-frame-id]";

const SAVED_PAGE = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8"><title>Pricing plans</title>',
  "<style>.hero { color: rgb(185, 28, 28); padding: 24px; }</style></head>",
  '<body><main class="hero" data-testid="imported-hero"><h1>Plans</h1><p>Simple pricing.</p></main></body>',
  "</html>",
].join("");

const PAGE_WITH_SCRIPT = [
  "<!doctype html>",
  '<html lang="en"><head><title>Script page</title><script>window.__imported = true;</script></head>',
  '<body><main data-testid="imported-main" onclick="steal()"><p>Script content.</p></main></body>',
  "</html>",
].join("");

const HOSTILE_PAGE =
  '<!doctype html><html><head></head><body><div data-design-tool-iframe-bridge="1"></div></body></html>';

async function importHtmlFile(page, name, html) {
  await page.getByTestId("import-html-input").setInputFiles({
    name,
    mimeType: "text/html",
    buffer: Buffer.from(html, "utf-8"),
  });
}

test.describe("HTML file import", () => {
  test("imports a saved webpage as a live styled frame", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(surfaceSelector)).toBeVisible();

    await importHtmlFile(page, "pricing.html", SAVED_PAGE);

    await expect(page.locator(frameSelector)).toHaveCount(1);
    const frame = page.locator(frameSelector).first();
    await expect(frame).toHaveAttribute("aria-label", "Pricing plans");
    await expect(page.getByTestId("persistence-feedback")).toContainText('Imported "Pricing plans" as a new frame');

    await expect.poll(() => frame.locator("iframe").count()).toBeGreaterThan(0);
    const preview = frame.locator("iframe").contentFrame();
    await expect(preview.locator('[data-testid="imported-hero"]')).toBeVisible();
    await expect(preview.locator('[data-testid="imported-hero"]')).toContainText("Simple pricing.");
    const color = await preview
      .locator('[data-testid="imported-hero"]')
      .evaluate((element) => getComputedStyle(element).color);
    expect(color).toBe("rgb(185, 28, 28)");
  });

  test("strips scripts and handlers with an honest notice", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(surfaceSelector)).toBeVisible();

    await importHtmlFile(page, "script-page.html", PAGE_WITH_SCRIPT);

    await expect(page.locator(frameSelector)).toHaveCount(1);
    await expect(page.getByTestId("persistence-feedback")).toContainText("removed for safety");
    const frame = page.locator(frameSelector).first();
    await expect.poll(() => frame.locator("iframe").count()).toBeGreaterThan(0);
    const preview = frame.locator("iframe").contentFrame();
    await expect(preview.locator('[data-testid="imported-main"]')).toContainText("Script content.");
    const strayScripts = await preview.locator("html").evaluate((root) =>
      root.ownerDocument.querySelectorAll("script:not([data-design-tool-iframe-bridge])").length);
    expect(strayScripts).toBe(0);
    const executedFlag = await preview.locator("html").evaluate((root) =>
      (root.ownerDocument.defaultView as unknown as { __imported?: boolean }).__imported ?? null);
    expect(executedFlag).toBeNull();
  });

  test("imports onto its own page and undoes as one step", async ({ page }) => {
    await page.goto("/?demo=1");
    await expect(page.locator(surfaceSelector)).toBeVisible();
    expect(await page.locator(frameSelector).count()).toBe(4);

    await importHtmlFile(page, "pricing.html", SAVED_PAGE);

    await expect(page.locator(frameSelector)).toHaveCount(1);
    await expect(page.locator('[aria-label="Pricing plans"]')).toBeVisible();

    await page.getByTestId("undo-button").click();
    await expect(page.locator(frameSelector)).toHaveCount(4);
  });

  test("rejects hostile HTML with a clear error and untouched state", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(surfaceSelector)).toBeVisible();

    await importHtmlFile(page, "evil.html", HOSTILE_PAGE);

    await expect(page.locator(frameSelector)).toHaveCount(0);
    await expect(page.getByTestId("persistence-feedback")).toContainText("Could not import HTML");
  });
});
