// Verify created-shape rendering — pick a point guaranteed inside the creation layer.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE ?? "http://localhost:5173";
const OUT = path.resolve(process.cwd(), "qa/evidence-visual");
fs.mkdirSync(OUT, { recursive: true });
let idx = 200;
async function shot(page, name) {
  idx += 1;
  await page.screenshot({ path: path.join(OUT, `${idx}-${name}.png`) }).catch(() => {});
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE-ERR:", m.text()); });

await page.goto(BASE + "/?demo=1");
await page.waitForSelector("[data-frame-id] iframe", { timeout: 20000 });
await page.waitForTimeout(1500);
await page.keyboard.press("0");
await page.waitForTimeout(400);

const deskFrame = page.locator('[data-frame-id="desktop"]');
await page.keyboard.press("r");
const layer = deskFrame.getByTestId("frame-creation-layer");
await layer.waitFor({ timeout: 5000 });

// find a screen point where elementFromPoint === the creation layer
const pt = await page.evaluate(() => {
  const layerEl = document.querySelector('[data-frame-id="desktop"] [data-testid="frame-creation-layer"]');
  if (!layerEl) return null;
  const r = layerEl.getBoundingClientRect();
  for (let fy = 0.1; fy < 0.95; fy += 0.07) {
    for (let fx = 0.05; fx < 0.95; fx += 0.05) {
      const x = r.x + r.width * fx, y = r.y + r.height * fy;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      if (document.elementFromPoint(x, y) === layerEl) return { x, y };
    }
  }
  return null;
});
console.log("draw point:", JSON.stringify(pt));
if (!pt) throw new Error("no free point on creation layer");

await page.mouse.move(pt.x, pt.y);
await page.mouse.down();
await page.mouse.move(pt.x + 160, pt.y + 80, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(900);
await shot(page, "rect-drawn");

const preview = deskFrame.locator("iframe").contentFrame();
const created = preview.locator("[data-design-tool-created='true']").last();
const info = await created.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const svg = el.querySelector("svg");
  const child = svg?.querySelector("rect,ellipse,line,polyline,polygon,path");
  return {
    kind: el.getAttribute("data-design-tool-kind"),
    rect: { w: Math.round(r.width), h: Math.round(r.height) },
    bg: cs.backgroundColor, pos: cs.position, z: cs.zIndex,
    childFill: child?.getAttribute("fill"), childStroke: child?.getAttribute("stroke"), childStrokeW: child?.getAttribute("stroke-width"),
    fillAttr: el.getAttribute("data-design-tool-fill"), strokeWAttr: el.getAttribute("data-design-tool-stroke-width"),
  };
}).catch((e) => ({ error: String(e).slice(0, 150) }));
console.log("CREATED:", JSON.stringify(info));
await shot(page, "rect-selected");

// comment marker visual
await page.keyboard.press("Escape");
await page.keyboard.press("c");
const pt2 = await page.evaluate(() => {
  const frameEl = document.querySelector('[data-frame-id="tablet"]');
  if (!frameEl) return null;
  const r = frameEl.getBoundingClientRect();
  const x = r.x + r.width * 0.5, y = r.y + r.height * 0.5;
  return { x, y };
});
await page.mouse.click(pt2.x, pt2.y);
await page.waitForTimeout(600);
await shot(page, "comment-open");
await page.keyboard.type("Marker check");
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
await shot(page, "comment-closed");

await browser.close();
