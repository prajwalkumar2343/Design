import { expect, test, type Page } from "@playwright/test";

const surfaceSelector = '[data-testid="canvas-surface"]';
const frameSelector = "[data-frame-id]";

const CAPTURED_HTML = [
  "<!doctype html>",
  '<html lang="en" data-canvas-paste-source="https%3A%2F%2Fexample.com%2Fpricing" data-canvas-paste-title="Pricing%20plans" data-canvas-paste-width="640" data-canvas-paste-height="480" data-canvas-paste-background="rgb(255%2C%20255%2C%20255)">',
  '<head><meta charset="utf-8"><title>Pricing plans</title></head>',
  '<body><section data-testid="pasted-section" style="padding:24px"><h2>Plans</h2><p>Simple pricing.</p></section></body>',
  "</html>",
].join("");

async function dispatchPaste(page: Page, html: string, plain = html) {
  await page.evaluate(({ html, plain }) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/html", html);
    dataTransfer.setData("text/plain", plain);
    const target = document.querySelector('[data-testid="canvas-surface"]');
    if (!target) {
      throw new Error("canvas surface not found");
    }
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: dataTransfer });
    target.dispatchEvent(event);
  }, { html, plain });
}

test.describe("clipboard paste", () => {
  test("pastes captured HTML as a new styled frame on an empty canvas", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(surfaceSelector)).toBeVisible();

    await dispatchPaste(page, CAPTURED_HTML);

    await expect(page.locator(frameSelector)).toHaveCount(1);
    const frame = page.locator(frameSelector).first();
    await expect(frame).toHaveAttribute("aria-label", "Pricing plans");
    await expect(page.getByTestId("paste-feedback")).toBeVisible();
    await expect(page.getByTestId("paste-feedback")).toContainText("pasted onto the canvas");

    await expect.poll(() => frame.locator("iframe").count()).toBeGreaterThan(0);
    const preview = frame.locator("iframe").contentFrame();
    await expect(preview.locator('[data-testid="pasted-section"]')).toBeVisible();
    await expect(preview.locator('[data-testid="pasted-section"]')).toContainText("Simple pricing.");

    const padding = await preview
      .locator('[data-testid="pasted-section"]')
      .evaluate((element) => getComputedStyle(element).padding);
    expect(padding).toBe("24px");
  });

  test("pastes onto its own page and undoes as one step", async ({ page }) => {
    await page.goto("/?demo=1");
    await expect(page.locator(surfaceSelector)).toBeVisible();
    expect(await page.locator(frameSelector).count()).toBe(4);

    await dispatchPaste(page, CAPTURED_HTML);

    // The paste switches to a new page that holds only the pasted frame.
    await expect(page.locator(frameSelector)).toHaveCount(1);
    const pasted = page.locator('[aria-label="Pricing plans"]');
    await expect(pasted).toBeVisible();

    // One undo restores the demo page with all four frames.
    await page.keyboard.press("Control+z");
    await expect(page.locator(frameSelector)).toHaveCount(4);
  });

  test("ignores plain text without HTML structure", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(surfaceSelector)).toBeVisible();

    await dispatchPaste(page, "", "just some plain text");

    await expect(page.locator(frameSelector)).toHaveCount(0);
    await expect(page.getByTestId("paste-feedback")).toHaveCount(0);
  });

  test("shows an error toast for invalid HTML and leaves the canvas empty", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(surfaceSelector)).toBeVisible();

    await dispatchPaste(page, '<!doctype html><html><head></head><body><div data-design-tool-iframe-bridge="1"></div></body></html>');

    await expect(page.locator(frameSelector)).toHaveCount(0);
    const feedback = page.getByTestId("paste-feedback");
    await expect(feedback).toBeVisible();
    await expect(feedback).toContainText("reserved");
  });
});
