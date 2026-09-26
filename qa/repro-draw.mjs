import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:4187";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${base}/?demo=1`);
await page.waitForSelector('[data-testid="canvas-surface"]');
await page.waitForTimeout(800);

const start = await page.evaluate(() => {
  const surface = document.querySelector('[data-testid="canvas-surface"]');
  const box = surface.getBoundingClientRect();
  for (let r = 1; r < 8; r++) for (let c = 1; c < 10; c++) {
    const x = box.x + box.width*c/10, y = box.y + box.height*r/8;
    const t = document.elementFromPoint(x, y);
    if (t && s_contains(surface, t)) return { x, y };
  }
  function s_contains(s, t) {
    return s.contains(t) && !t.closest("[data-frame-id]") && !t.closest("[data-brief-frame-id]") && !(t instanceof HTMLIFrameElement) && !t.closest("[data-canvas-control]");
  }
  return null;
});
await page.keyboard.press("r");
await page.mouse.move(start.x, start.y);
await page.mouse.down();
await page.mouse.move(start.x + 220, start.y + 150, { steps: 8 });
await page.waitForTimeout(100);
const clip = { x: start.x - 20, y: start.y - 20, width: 280, height: 210 };
await page.screenshot({ path: "qa/draw-preview.png", clip });
await page.mouse.up();
await page.waitForSelector('[data-frame-id][data-freeform="true"][data-bridge-status="ready"]', { timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: "qa/draw-committed.png", clip });
console.log("done");
await browser.close();
