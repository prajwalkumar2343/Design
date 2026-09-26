import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:4187";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${base}/?demo=1`);
await page.waitForSelector('[data-testid="canvas-surface"]');
await page.waitForTimeout(1200);

const info = async (id) => page.evaluate((fid) => {
  const el = document.querySelector(`[data-frame-id="${fid}"]`);
  return { t: el?.style.transform, sel: el?.getAttribute("data-selected") };
}, id);

// ensure desktop selected
if ((await info("desktop")).sel !== "true") {
  await page.locator('[data-frame-drag-handle="desktop"]').click();
  await page.waitForTimeout(200);
}
const box = await page.locator('[data-frame-id="desktop"]').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const at = await page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  return el ? `${el.tagName}.${typeof el.className === "string" ? el.className : ""}` : null;
}, { x: cx, y: cy });
console.log("selected frame center hit:", at);

// unselected tablet body drag still works
const tbox = await page.locator('[data-frame-id="tablet"]').boundingBox();
await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2);
await page.mouse.down();
await page.mouse.move(tbox.x + tbox.width / 2 + 40, tbox.y + tbox.height / 2 + 30, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(250);
console.log("tablet after body-drag:", JSON.stringify(await info("tablet")));

// cold/zoomed-out: zoom to fit at low zoom, then drag mobile label
await page.keyboard.press("0");
await page.waitForTimeout(600);
const mbox = await page.locator('[data-frame-drag-handle="mobile"]').boundingBox();
console.log("mobile label at fit-zoom:", JSON.stringify(mbox));
await browser.close();
