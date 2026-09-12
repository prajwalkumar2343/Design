import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto("http://127.0.0.1:4173/?demo=1");
await page.waitForSelector('[data-frame-id="desktop"][data-bridge-status="ready"]', { timeout: 15000 });
const preview = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
const layer = page.locator('[data-frame-id="desktop"]').getByTestId("frame-creation-layer");

async function state(tag) {
  console.log(` ${tag}: tool-rect pressed=${await page.getByTestId("tool-button-rectangle").getAttribute("aria-pressed")}`,
    "| creation layers:", await page.getByTestId("frame-creation-layer").count(),
    "| outlines:", await page.locator(".node-selection-outline").count(),
    "| selbox:", await page.getByTestId("node-selection-box").count());
}

// baseline: r on fresh page
await page.keyboard.press("r");
await state("fresh+R");

await page.keyboard.press("Escape"); // back to select
const heading = preview.getByRole("heading", { name: "Make room for better ideas." });
await heading.click();
await page.getByTestId("node-selection-box").waitFor({ timeout: 5000 });
await preview.getByText(/A quiet place for teams/).click({ modifiers: ["Shift"] });
await page.waitForTimeout(600);
await state("multi-selected");

await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await state("after Escape x1");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await state("after Escape x2");
await page.keyboard.press("r");
await page.waitForTimeout(500);
await state("after R");
await browser.close();
