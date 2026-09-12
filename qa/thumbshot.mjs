import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto("http://127.0.0.1:4173/?demo=1");
await page.waitForSelector('[data-frame-id] iframe', { timeout: 15000 });
await page.getByTestId("tool-button-shader").click();
await page.getByTestId("shader-menu").waitFor();
await page.waitForTimeout(600);
await page.getByTestId("shader-menu").screenshot({ path: "qa/evidence/shader-thumbs.png" });
// hover mesh-gradient and capture the live state
await page.getByTestId("shader-card-mesh-gradient").hover();
await page.waitForTimeout(1800);
await page.getByTestId("shader-menu").screenshot({ path: "qa/evidence/shader-hover.png" });
await browser.close();
