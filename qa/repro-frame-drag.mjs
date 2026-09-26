import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text()); });

await page.goto(`${base}/?demo=1`);
await page.waitForSelector('[data-testid="canvas-surface"]');
await page.waitForTimeout(1200);

const frames = await page.evaluate(() =>
  Array.from(document.querySelectorAll("[data-frame-id]")).map((el) => ({
    id: el.getAttribute("data-frame-id"),
    name: el.getAttribute("aria-label"),
    transform: el.style.transform,
    rect: el.getBoundingClientRect().toJSON(),
    freeform: el.getAttribute("data-freeform"),
    labelVisible: (() => {
      const l = el.querySelector(".frame-label");
      if (!l) return null;
      const r = l.getBoundingClientRect();
      return { rect: r.toJSON(), display: getComputedStyle(l).display, pe: getComputedStyle(l).pointerEvents };
    })(),
    activationLayer: !!el.querySelector(".frame-activation-layer"),
  })),
);
console.log(JSON.stringify(frames, null, 1));

// Drag the first non-freeform frame by its label handle
const target = frames.find((f) => f.labelVisible && f.labelVisible.display !== "none");
if (!target) {
  console.log("NO DRAGGABLE LABEL FOUND");
} else {
  const label = page.locator(`[data-frame-drag-handle="${target.id}"]`);
  const box = await label.boundingBox();
  console.log("label box", box, "frame", target.id);
  if (box) {
    const sx = box.x + box.width / 2;
    const sy = box.y + box.height / 2;
    // what element is actually at that point?
    const at = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el ? `${el.tagName}.${el.className}` : null;
    }, { x: sx, y: sy });
    console.log("element at label center:", at);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 150, sy + 90, { steps: 8 });
    const mid = await page.evaluate((id) => {
      const el = document.querySelector(`[data-frame-id="${id}"]`);
      return { transform: el?.style.transform, interaction: document.querySelector(".canvas-surface")?.getAttribute("data-interaction") };
    }, target.id);
    console.log("mid-drag:", JSON.stringify(mid));
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await page.evaluate((id) => {
      const el = document.querySelector(`[data-frame-id="${id}"]`);
      return { transform: el?.style.transform, interaction: document.querySelector(".canvas-surface")?.getAttribute("data-interaction") };
    }, target.id);
    console.log("after-drop:", JSON.stringify(after));
  }
}
await browser.close();
