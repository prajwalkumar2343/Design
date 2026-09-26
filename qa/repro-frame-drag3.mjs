import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:4187";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto(`${base}/?demo=1`);
await page.waitForSelector('[data-testid="canvas-surface"]');
await page.waitForTimeout(1200);

// instrument: count pointerdowns on each drag handle
await page.evaluate(() => {
  window.__pd = [];
  document.addEventListener("pointerdown", (e) => {
    window.__pd.push({ target: `${e.target.tagName}.${e.target.className}`, x: e.clientX, y: e.clientY });
  }, true);
});

for (const id of ["desktop", "tablet", "mobile", "mobile-large"]) {
  const label = page.locator(`[data-frame-drag-handle="${id}"]`);
  const box = await label.boundingBox();
  if (!box) { console.log(id, "no label box"); continue; }
  const sx = box.x + box.width / 2, sy = box.y + box.height / 2;
  const at = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const chain = [];
    let n = el;
    while (n && chain.length < 6) { chain.push(`${n.tagName}.${typeof n.className === "string" ? n.className : ""}`); n = n.parentElement; }
    return chain;
  }, { x: sx, y: sy });
  const before = await page.evaluate((fid) => document.querySelector(`[data-frame-id="${fid}"]`)?.style.transform, id);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 60, sy + 30, { steps: 5 });
  const mid = await page.evaluate((fid) => ({
    t: document.querySelector(`[data-frame-id="${fid}"]`)?.style.transform,
    i: document.querySelector(".canvas-surface")?.getAttribute("data-interaction"),
  }), id);
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.evaluate((fid) => document.querySelector(`[data-frame-id="${fid}"]`)?.style.transform, id);
  console.log(`${id}: box=${JSON.stringify(box)} at=${JSON.stringify(at)}`);
  console.log(`   before=${before} mid=${JSON.stringify(mid)} after=${after}`);
}
console.log("pointerdowns:", JSON.stringify(await page.evaluate(() => window.__pd)));
await browser.close();
