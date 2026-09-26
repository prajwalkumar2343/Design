import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:4187";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto(`${base}/?demo=1`);
await page.waitForSelector('[data-testid="canvas-surface"]');
await page.waitForTimeout(1200);

const info = async (id) => page.evaluate((fid) => {
  const el = document.querySelector(`[data-frame-id="${fid}"]`);
  return {
    t: el?.style.transform,
    sel: el?.getAttribute("data-selected"),
    ring: !!el?.querySelector(".frame-drag-ring"),
    i: document.querySelector(".canvas-surface")?.getAttribute("data-interaction"),
  };
}, id);

// desktop is selected by default in demo state; if not, select via label click
const sel = await info("desktop");
console.log("desktop initial:", JSON.stringify(sel));
if (sel.sel !== "true") {
  await page.locator('[data-frame-drag-handle="desktop"]').click();
  await page.waitForTimeout(200);
}
console.log("desktop selected:", JSON.stringify(await info("desktop")));

// Drag the selected desktop frame by its TOP EDGE (the ring band ends at the
// frame edge — inside presses reach the document — so grab just outside it)
const box = await page.locator('[data-frame-id="desktop"]').boundingBox();
const ex = box.x + box.width / 2;
const ey = box.y - 4;
const at = await page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  return el ? `${el.tagName}.${typeof el.className === "string" ? el.className : ""}` : null;
}, { x: ex, y: ey });
console.log("element at top edge:", at);
await page.mouse.move(ex, ey);
await page.mouse.down();
await page.mouse.move(ex + 100, ey + 60, { steps: 6 });
console.log("mid-drag:", JSON.stringify(await info("desktop")));
await page.mouse.up();
await page.waitForTimeout(300);
console.log("after edge-drag:", JSON.stringify(await info("desktop")));

// Also drag by the OUTER band (just outside frame top edge)
const box2 = await page.locator('[data-frame-id="mobile"]').boundingBox();
// select mobile first
await page.locator('[data-frame-drag-handle="mobile"]').click();
await page.waitForTimeout(200);
const mbox = await page.locator('[data-frame-id="mobile"]').boundingBox();
const mx = mbox.x + mbox.width / 2;
const my = mbox.y - 3; // 3px above frame = outer ring band
const at2 = await page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  return el ? `${el.tagName}.${typeof el.className === "string" ? el.className : ""}` : null;
}, { x: mx, y: my });
console.log("element above mobile edge:", at2);
await page.mouse.move(mx, my);
await page.mouse.down();
await page.mouse.move(mx - 80, my + 45, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
console.log("mobile after outer-ring drag:", JSON.stringify(await info("mobile")));

await page.screenshot({ path: "qa/ring-drag.png" });
await browser.close();
