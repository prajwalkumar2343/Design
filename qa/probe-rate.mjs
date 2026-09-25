import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const t0 = Date.now();
await page.goto("http://127.0.0.1:5173/?demo=1", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".canvas-surface", { timeout: 30000 });
let last = -1, lastT = t0;
while (Date.now() - t0 < 60000) {
  const n = await page.evaluate(() => document.querySelectorAll(".canvas-frame").length);
  if (n !== last) {
    const now = Date.now();
    console.log(`${((now - t0) / 1000).toFixed(1)}s frames=${n} (+${((now - lastT) / 1000).toFixed(2)}s)`);
    last = n; lastT = now;
  }
  await page.waitForTimeout(200);
}
await browser.close();
