import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:4187";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto(`${base}/?demo=1`);
await page.waitForSelector('[data-testid="canvas-surface"]');
await page.waitForTimeout(800);

const start = await page.evaluate(() => {
  const surface = document.querySelector('[data-testid="canvas-surface"]');
  const box = surface.getBoundingClientRect();
  for (let row = 1; row < 8; row += 1) {
    for (let col = 1; col < 10; col += 1) {
      const x = box.x + (box.width * col) / 10;
      const y = box.y + (box.height * row) / 8;
      const t = document.elementFromPoint(x, y);
      if (t && surface.contains(t) && !t.closest("[data-frame-id]") && !t.closest("[data-brief-frame-id]") && !(t instanceof HTMLIFrameElement) && !t.closest("[data-canvas-control]")) {
        return { x, y };
      }
    }
  }
  return null;
});
await page.keyboard.press("r");
await page.mouse.move(start.x, start.y);
await page.mouse.down();
await page.mouse.move(start.x + 200, start.y + 140, { steps: 8 });
await page.mouse.up();

const freeform = page.locator('[data-frame-id][data-freeform="true"]');
await freeform.waitFor({ state: "attached" });
await page.waitForSelector('[data-frame-id][data-freeform="true"][data-bridge-status="ready"]', { timeout: 15000 });
const doc = freeform.locator("iframe").contentFrame();
const shape = doc.locator('[data-design-tool-kind="rectangle"]');
await shape.waitFor();

const inspect = async (label) => {
  const inner = await shape.evaluate((el) => {
    const child = el.firstElementChild?.tagName === "defs" ? el.children[1] : el.firstElementChild;
    const cr = child?.getBoundingClientRect();
    const html = el.outerHTML.slice(0, 800);
    return {
      elRect: el.getBoundingClientRect().toJSON(),
      elInline: el.getAttribute("style"),
      childTag: child?.tagName,
      childRect: cr?.toJSON(),
      childAttrs: child ? { x: child.getAttribute("x"), y: child.getAttribute("y"), w: child.getAttribute("width"), h: child.getAttribute("height"), fill: child.getAttribute("fill"), style: child.getAttribute("style") } : null,
      viewBox: el.getAttribute("viewBox"),
      bodyInline: document.body.getAttribute("style"),
      html,
    };
  });
  const sel = await page.locator('[data-testid="node-selection-box"]').boundingBox().catch(() => null);
  const frameBox = await freeform.boundingBox();
  console.log(`--- ${label} ---`);
  console.log(JSON.stringify({ frameBox, sel, ...inner }));
};
await inspect("after draw");

const shapeBox = await shape.boundingBox();
await page.mouse.click(shapeBox.x + shapeBox.width / 2, shapeBox.y + shapeBox.height / 2);
await page.waitForSelector('[data-testid="node-selection-box"]');
await inspect("after select");

const sel = await page.locator('[data-testid="node-selection-box"]').boundingBox();
const ds = { x: sel.x + sel.width / 2, y: sel.y + sel.height / 2 };
await page.mouse.move(ds.x, ds.y);
await page.mouse.down();
await page.mouse.move(ds.x + 120, ds.y + 50, { steps: 6 });
await inspect("mid-drag");
await page.mouse.up();
await page.waitForTimeout(800);
await inspect("after drop");
await page.screenshot({ path: "qa/repro-move.png", clip: { x: sel.x - 320, y: sel.y - 220, width: 700, height: 500 } });
await browser.close();
