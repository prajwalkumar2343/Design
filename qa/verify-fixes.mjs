// Verify the five fixes visually.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE ?? "http://localhost:5173";
const OUT = path.resolve(process.cwd(), "qa/evidence-visual");
fs.mkdirSync(OUT, { recursive: true });
let idx = 600;
async function shot(page, name, clip) {
  idx += 1;
  await page.screenshot({ path: path.join(OUT, `${idx}-${name}.png`), clip }).catch(() => {});
}
const log = (...a) => console.log(...a);
const failures = [];
const check = (cond, label, detail) => {
  if (cond) log("PASS", label);
  else { failures.push(label); log("FAIL", label, detail ?? ""); }
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") log("CONSOLE-ERR:", m.text().slice(0, 160)); });

await page.goto(BASE + "/?demo=1");
await page.waitForSelector("[data-frame-id] iframe", { timeout: 20000 });
await page.waitForTimeout(1500);

// 1. sidebar tabs — measure widths/clip
await shot(page, "tabs-icon-only");
const tabs = await page.evaluate(() => [...document.querySelectorAll(".sidebar-tab")].map((t) => {
  const r = t.getBoundingClientRect();
  return { label: t.getAttribute("aria-label"), w: Math.round(r.width), clipped: t.scrollWidth > t.clientWidth };
}));
log("tabs:", JSON.stringify(tabs));
check(tabs.length > 0, "sidebar tabs render");
check(tabs.every((t) => !t.clipped), "sidebar tabs not clipped", JSON.stringify(tabs.filter((t) => t.clipped)));

// 2. canvas-help position — visible, centered, not under rail
const help = await page.evaluate(() => {
  const el = document.querySelector(".canvas-help");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const at = document.elementFromPoint(r.x + 4, r.y + r.height / 2);
  return { rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }, visible: r.width > 0, underOther: at ? !el.contains(at) && at !== el : true, coveredBy: at?.className?.toString().slice(0, 50) };
});
log("canvas-help:", JSON.stringify(help));
check(help?.visible === true, "canvas-help visible", JSON.stringify(help));
check(help != null && !help.underOther, "canvas-help not covered by another element", help?.coveredBy ?? "missing");
await shot(page, "canvas-help-position", { x: 0, y: 750, width: 1440, height: 150 });

// 3. comment marker at 22% zoom
await page.keyboard.press("0");
await page.waitForTimeout(400);
await page.keyboard.press("c");
const fb = await page.locator('[data-frame-id="desktop"] iframe').boundingBox();
await page.mouse.click(fb.x + fb.width * 0.5, fb.y + fb.height * 0.4);
await page.waitForTimeout(500);
await page.keyboard.type("Pin visibility check");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await shot(page, "comment-marker-zoomed-out");
const markerInfo = await page.evaluate(() => {
  const m = document.querySelector('[data-testid="comment-marker"]');
  if (!m) return null;
  const r = m.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
});
log("marker box (expect ~28px):", JSON.stringify(markerInfo));
check(markerInfo !== null, "comment marker exists after pin drop");
check(markerInfo !== null && markerInfo.w >= 20 && markerInfo.w <= 40 && markerInfo.h >= 20 && markerInfo.h <= 40,
  "comment marker stays ~28px when zoomed out", JSON.stringify(markerInfo));

// 4. shape menu icons
await page.getByTestId("shape-menu-button").click();
await page.waitForTimeout(300);
await shot(page, "shape-menu-icons", );
const icons = await page.evaluate(() => [...document.querySelectorAll(".shape-menu-item")].map((b) => ({ label: b.textContent.trim(), hasIcon: b.querySelector("svg") !== null })));
log("shape items:", JSON.stringify(icons));
check(icons.length > 0, "shape menu opens with items");
check(icons.length > 0 && icons.every((i) => i.hasIcon), "shape menu items render icons", JSON.stringify(icons));
await page.keyboard.press("Escape");

// 5. popover clamp: place a comment near the right edge of the surface
await page.keyboard.press("c");
await page.mouse.click(fb.x + fb.width - 30, fb.y + 60); // near right edge of desktop frame — but surface edge matters; frame near right edge of screen
await page.waitForTimeout(600);
const pop = await page.evaluate(() => {
  const p = document.querySelector('[data-testid="comment-popover"]');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight };
});
log("popover (must be inside viewport):", JSON.stringify(pop));
check(pop !== null, "comment popover exists near surface edge");
check(pop !== null && pop.x >= 0 && pop.y >= 0 && pop.right <= pop.vw + 1 && pop.bottom <= pop.vh + 1,
  "comment popover clamped inside viewport", JSON.stringify(pop));
await shot(page, "comment-popover-edge");

await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
log("\nAll checks passed.");
