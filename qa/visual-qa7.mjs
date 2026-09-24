// Shader element on canvas + Shaders panel + Pages + lake overlay.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE ?? "http://localhost:5173";
const OUT = path.resolve(process.cwd(), "qa/evidence-visual");
let idx = 700;
async function shot(page, name) {
  idx += 1;
  await page.screenshot({ path: path.join(OUT, `${idx}-${name}.png`) }).catch(() => {});
}
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") log("CONSOLE-ERR:", m.text().slice(0, 160)); });

await page.goto(BASE + "/?demo=1");
await page.waitForSelector("[data-frame-id] iframe", { timeout: 20000 });
await page.waitForTimeout(1400);

// ── add a shader element via the shader menu ──
await page.getByTestId("tool-button-shader").click();
await page.waitForTimeout(600);
const meshCard = page.locator('[data-testid*="mesh-gradient"], .shader-card').first();
// find the add button on a card
const card = page.locator(".shader-card").first();
await card.hover();
await page.waitForTimeout(400);
await shot(page, "shader-menu-hover");
// click the card or its add action
const addBtn = card.locator("button").first();
await (await addBtn.count() ? addBtn : card).click();
await page.waitForTimeout(1200);
await shot(page, "shader-added");
log("shader elements on canvas:", await page.locator(".shader-element, [class*='shader-element']").count());
log("shaders tab visible:", await page.getByTestId("sidebar-tab-shaders").count());

// Shaders panel should auto-open on selection
await page.waitForTimeout(600);
await shot(page, "shaders-panel-open");
const panelText = await page.evaluate(() => document.querySelector(".sidebar-active-panel")?.textContent?.slice(0, 300));
log("panel text:", panelText?.slice(0, 140));

// try editing a param if inputs exist
const slider = page.locator(".sidebar-active-panel input[type='range']").first();
if (await slider.count()) {
  await slider.fill("0.8").catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, "shader-param-edited");
}

// ── pages panel ──
await page.getByTestId("sidebar-tab-pages").click();
await page.waitForTimeout(400);
await shot(page, "pages-panel");
const addPage = page.locator('.sidebar-active-panel button[aria-label*="page" i], .sidebar-active-panel button[aria-label*="add" i]').first();
log("add-page candidates:", await addPage.count());

// ── lake overlay (real project only) — skip demo; but check Workspace btn absent in demo
log("lake-toggle in demo:", await page.getByTestId("lake-toggle-button").count());

// ── right panel collapse/expand round trip ──
await page.getByTestId("right-sidebar-toggle").click();
await page.waitForTimeout(400);
await shot(page, "right-collapsed");
await page.getByTestId("right-sidebar-toggle").click().catch(async () => {
  // maybe testid changes when collapsed
  await page.locator('[aria-label*="properties" i], [aria-label*="Expand" i]').first().click().catch(() => {});
});
await page.waitForTimeout(400);
await shot(page, "right-expanded-again");

await browser.close();
