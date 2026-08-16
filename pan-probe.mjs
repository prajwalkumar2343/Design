import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:5199/?demo=1");
await page.waitForSelector('[data-testid="canvas-world"]');
await page.waitForTimeout(500);

const tf = () => page.evaluate(() => document.querySelector('[data-testid="canvas-world"]').style.transform);
const liveCount = () => page.evaluate(() => document.querySelectorAll('iframe.frame-document').length);

// find a live frame's on-screen rect
const rects = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-frame-id]')).map(el => {
    const r = el.getBoundingClientRect();
    return { id: el.getAttribute('data-frame-id'), x: r.x, y: r.y, w: r.width, h: r.height };
  });
});
console.log("frames:", rects);

// hold space, pan across the first frame
await page.keyboard.down("Space");
await page.mouse.move(720, 300);
await page.mouse.down();
const samples = [];
for (let i = 1; i <= 60; i++) {
  await page.mouse.move(720 + i * 12, 300, { steps: 1 });
  samples.push(`${await tf()} live=${await liveCount()}`);
}
await page.mouse.up();
await page.keyboard.up("Space");
console.log(samples.join("\n"));
await browser.close();
