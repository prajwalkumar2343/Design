import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
await page.addInitScript(() => {
  window.__bench = { raf: 0, longMs: 0, longN: 0 };
  const loop = () => { window.__bench.raf += 1; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__bench.longMs += e.duration; window.__bench.longN += 1; } }).observe({ entryTypes: ["longtask"] }); } catch {}
});
await page.goto("http://127.0.0.1:5299/?demo=1", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".canvas-surface", { timeout: 30000 });
await page.waitForTimeout(3000);

const FRAME_HTML = (i) => `<!doctype html><html><body><div style="padding:20px"><h1>F${i}</h1><p>card ${i}</p><button>go</button></div></body></html>`;
const count = () => page.evaluate(() => document.querySelectorAll(".canvas-frame").length);
const iframes = () => page.evaluate(() => document.querySelectorAll("iframe.frame-document").length);
const sample = () => page.evaluate(() => ({ raf: window.__bench.raf, longMs: window.__bench.longMs, longN: window.__bench.longN, heap: performance.memory?.usedJSHeapSize ?? 0 }));

const t0 = Date.now();
const target = 1000;
let i = 0;
while (i < target) {
  const batch = Math.min(120, target - i);
  await Promise.all(Array.from({ length: batch }, (_, k) => {
    const n = i + k;
    return fetch("http://127.0.0.1:5299/__canvas-agent/op", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "push", id: `k-${n}`, name: `K${n}`, html: FRAME_HTML(n),
        x: (n % 40) * 560, y: Math.floor(n / 40) * 460, width: 420, height: 320 }) }).then(r => r.json());
  }));
  // wait for this batch to land
  const want = i + batch;
  for (;;) {
    const n = await count();
    if (n >= want || Date.now() - t0 > 300000) break;
    await page.waitForTimeout(800);
  }
  i += batch;
  const n = await count();
  console.log(`seeded->${n} frames (${((Date.now()-t0)/1000).toFixed(0)}s) iframes=${await iframes()}`);
  if (n < want) { console.log("BATCH SHORTFALL", want - n); }
}
console.log(`SEED DONE: ${await count()} frames in ${((Date.now()-t0)/1000).toFixed(0)}s`);

await page.waitForTimeout(4000);
console.log(`iframes after settle: ${await iframes()} heap=${Math.round((await sample()).heap/1048576)}MB`);

async function measurePan(seconds = 3) {
  const box = await page.locator(".canvas-surface").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.keyboard.down(" ");
  const before = await sample();
  const t = Date.now();
  await page.mouse.move(cx, cy); await page.mouse.down();
  const steps = Math.ceil(seconds * 30);
  for (let s = 0; s < steps; s++) {
    const k = s / steps;
    await page.mouse.move(cx + Math.sin(k * Math.PI * 4) * box.width * 0.3, cy + Math.cos(k * Math.PI * 3) * box.height * 0.25);
    await page.waitForTimeout(1000 / 30);
  }
  await page.mouse.up(); await page.keyboard.up(" ");
  const el = (Date.now() - t) / 1000, after = await sample();
  return { fps: ((after.raf - before.raf) / el).toFixed(1), longMs: Math.round(after.longMs - before.longMs), n: after.longN - before.longN };
}
async function measureWheel(seconds = 3) {
  const box = await page.locator(".canvas-surface").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await sample(); const t = Date.now();
  for (let s = 0; s < seconds * 20; s++) { await page.mouse.wheel(60, 40); await page.waitForTimeout(50); }
  const el = (Date.now() - t) / 1000, after = await sample();
  return { fps: ((after.raf - before.raf) / el).toFixed(1), longMs: Math.round(after.longMs - before.longMs), n: after.longN - before.longN };
}
async function zoomTo(dy, steps = 8) {
  const box = await page.locator(".canvas-surface").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  for (let s = 0; s < steps; s++) { await page.mouse.wheel(0, dy); await page.waitForTimeout(50); }
  await page.keyboard.up("Control"); await page.waitForTimeout(400);
}

console.log("panOverview:", JSON.stringify(await measurePan()));
await zoomTo(-240, 10);
console.log("panZoomed:", JSON.stringify(await measurePan()));
console.log("wheelPan:", JSON.stringify(await measureWheel()));
console.log(`final iframes=${await iframes()} heap=${Math.round((await sample()).heap/1048576)}MB`);
await browser.close();
