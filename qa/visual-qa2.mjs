// Deep visual QA — inspect specific surfaces closely.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE ?? "http://localhost:5173";
const OUT = path.resolve(process.cwd(), "qa/evidence-visual");
fs.mkdirSync(OUT, { recursive: true });
let idx = 100;
async function shot(page, name) {
  idx += 1;
  const file = `${idx}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, file) }).catch(() => {});
  return file;
}
const hygiene = [];
function attach(page, tag) {
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) hygiene.push(`[${tag}] ${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => hygiene.push(`[${tag}] pageerror: ${e.message}`));
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
attach(page, "deep");

await page.goto(BASE + "/?demo=1");
await page.waitForSelector("[data-frame-id] iframe", { timeout: 20000 });
await page.waitForTimeout(1600);

// ── Sidebar tab strip geometry ──
const tabInfo = await page.evaluate(() => {
  const strip = document.querySelector(".sidebar-tabs");
  const tabs = [...document.querySelectorAll(".sidebar-tab")].map((t) => {
    const r = t.getBoundingClientRect();
    return { label: t.textContent, w: Math.round(r.width), clipped: t.scrollWidth > t.clientWidth };
  });
  const r = strip?.getBoundingClientRect();
  return { stripWidth: r?.width, tabs };
});
console.log("TAB STRIP:", JSON.stringify(tabInfo));

// ── Tokens panel: filter chips ──
await page.getByTestId("sidebar-tab-tokens").click();
await page.waitForTimeout(600);
const chipInfo = await page.evaluate(() => {
  return [...document.querySelectorAll(".tkn-filter")].map((c) => {
    const r = c.getBoundingClientRect();
    return { label: c.textContent.trim(), w: Math.round(r.width), clipped: c.scrollWidth > c.clientWidth, top: Math.round(r.top) };
  });
});
console.log("TOKEN CHIPS:", JSON.stringify(chipInfo));
await shot(page, "tokens-panel");

// Token row interactions — click a token row, open edit sheet
const tokenRow = page.locator(".tkn-row, [class*='token-row'], [data-testid^='tkn-row']").first();
const rowCount = await tokenRow.count();
console.log("token rows:", rowCount);
if (rowCount) {
  await tokenRow.click().catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, "tokens-row-clicked");
}

// scroll tokens panel to bottom to see all controls
const panel = page.locator(".sidebar-active-panel");
await panel.evaluate((el) => { el.scrollTop = el.scrollHeight; }).catch(() => {});
await page.waitForTimeout(300);
await shot(page, "tokens-panel-bottom");

// ── Shader menu with thumbnails ──
await page.getByTestId("sidebar-tab-layers").click();
await page.getByTestId("tool-button-shader").click();
await page.waitForTimeout(900);
await shot(page, "shader-menu-top");
const shaderMenu = page.locator(".shader-menu, [role='menu']").first();
if (await shaderMenu.count()) {
  await shaderMenu.evaluate((el) => { el.scrollTop = 500; }).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, "shader-menu-scrolled");
  // hover a card -> live preview mounts
  const card = page.locator(".shader-card, [class*='shader-card'], [data-testid^='shader-']").first();
  if (await card.count()) { await card.hover(); await page.waitForTimeout(900); await shot(page, "shader-card-hover"); }
}
await page.keyboard.press("Escape");

// ── Select a created element -> properties panel ──
// Draw a rectangle first
await page.keyboard.press("r");
const deskFrame = page.locator('[data-frame-id="desktop"]');
const layer = deskFrame.getByTestId("frame-creation-layer");
const box = await layer.boundingBox();
await page.mouse.move(box.x + 100, box.y + 140);
await page.mouse.down();
await page.mouse.move(box.x + 300, box.y + 260, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(700);
await shot(page, "rect-created-props");

// select the heading text -> typography controls
const preview = deskFrame.locator("iframe").contentFrame();
const heading = preview.getByRole("heading").first();
if (await heading.count()) {
  await heading.click();
  await page.waitForTimeout(700);
  await shot(page, "heading-selected-props");
}

// ── Comment flow ──
await page.keyboard.press("c");
await page.mouse.click(box.x + 500, box.y + 400);
await page.waitForTimeout(600);
await shot(page, "comment-popover");
await page.keyboard.type("Visual QA note");
await page.mouse.click(box.x + 700, box.y + 600); // click away to save
await page.waitForTimeout(600);
await shot(page, "comment-saved");
await page.keyboard.press("Escape");

// ── Right panel at different selections ──
await page.getByTestId("tool-button-select").click();
await page.mouse.click(box.x + 60, box.y + 60); // background of desktop frame? maybe frame select
await page.waitForTimeout(500);
await shot(page, "after-clicks");

console.log("\nHYGIENE:", JSON.stringify(hygiene.slice(0, 20), null, 1));
await browser.close();
