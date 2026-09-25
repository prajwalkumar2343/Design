// Exercises eviction + teardown: 80 frames exceed MAX_MOUNTED_FRAMES=64 —
// panning across them forces mount/evict cycles through handleBridgeDetach.
import { chromium } from "@playwright/test";

const URL_BASE = "http://127.0.0.1:5299";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${URL_BASE}/?demo=1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".canvas-surface", { timeout: 30000 });
await page.waitForTimeout(1500);

await page.evaluate(async (base) => {
  for (let i = 0; i < 80; i++) {
    await fetch(`${base}/__canvas-agent/op`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "push", id: `ev-${i}`, name: `EV${i}`,
        html: `<!doctype html><html><body><h3>F${i}</h3></body></html>`,
        x: (i % 10) * 500, y: Math.floor(i / 10) * 400, width: 400, height: 300,
      }),
    });
  }
}, URL_BASE);
await page.waitForFunction(() => document.querySelectorAll(".canvas-frame").length >= 80, { timeout: 60000 });

const stats = () => page.evaluate(() => ({
  frames: document.querySelectorAll(".canvas-frame").length,
  iframes: document.querySelectorAll("iframe.frame-document").length,
  placeholders: document.querySelectorAll(".frame-placeholder").length,
}));
console.log("after seed:", await stats());

// Pan across the field — wheel deltas drive the imperative camera.
const box = await page.locator(".canvas-surface").boundingBox();
for (let i = 0; i < 12; i++) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(-1400, -900);
  await page.waitForTimeout(400);
}
console.log("after pan sweep:", await stats());
await page.waitForTimeout(2500);
const end = await stats();
console.log("settled:", end);
console.log("page errors:", errors.slice(0, 5), "total:", errors.length);

const ok = end.iframes <= 70 && end.iframes > 0 && errors.length === 0;
console.log(ok ? "PASS: mount cap held, evictions clean, no errors" : "FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
