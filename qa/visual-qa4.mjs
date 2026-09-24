// Real-project flow QA v2: template card → project canvas → exports, tokens, theme switch.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE ?? "http://localhost:5173";
const OUT = path.resolve(process.cwd(), "qa/evidence-visual");
fs.mkdirSync(OUT, { recursive: true });
let idx = 300;
async function shot(page, name) {
  idx += 1;
  await page.screenshot({ path: path.join(OUT, `${idx}-${name}.png`) }).catch(() => {});
}
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") log("CONSOLE-ERR:", m.text().slice(0, 200)); });

await page.goto(BASE + "/");
await page.waitForSelector(".project-lake", { timeout: 15000 });
await page.waitForTimeout(900);

// Click the "Landing page" template card → creates project + navigates
await page.getByTestId("create-kind-landing").click();
await page.waitForTimeout(2500);
log("URL after template create:", page.url());
await shot(page, "project-from-template");
log("frames:", await page.locator("[data-frame-id]").count());
for (const t of ["export-project-button", "export-figma-button", "export-code-button", "lake-toggle-button"]) {
  log(t, ":", await page.getByTestId(t).count());
}

// blank card → chooser dialog
await page.goto(BASE + "/");
await page.waitForTimeout(900);
await page.getByTestId("create-kind-blank").click();
await page.waitForTimeout(500);
await shot(page, "blank-chooser");
const chooser = page.locator('[role="dialog"], .blank-chooser, [data-testid*="chooser"]').first();
log("chooser visible:", await chooser.count());
// pick website canvas if buttons exist
const pick = page.locator('[data-testid*="blank-canvas-"], [data-testid*="chooser"] button').first();
if (await pick.count()) { await pick.click(); await page.waitForTimeout(1500); log("URL after blank create:", page.url()); }
await shot(page, "blank-created");

// ── tokens: theme switch on a real frame ──
await page.getByTestId("sidebar-tab-tokens").click().catch(() => {});
await page.waitForTimeout(600);
await shot(page, "tokens-real");
const tknButtons = await page.evaluate(() =>
  [...document.querySelectorAll(".sidebar-active-panel button, .sidebar-active-panel [role='button']")]
    .map((b) => ({ label: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 45), testid: b.getAttribute("data-testid") || "" }))
    .filter((b) => b.label).slice(0, 80)
);
log("tokens buttons:", JSON.stringify(tknButtons.map((b) => b.testid || b.label)));

// theme/mode rows
const modes = await page.evaluate(() => [...document.querySelectorAll("[data-testid^='tkn-theme'], [data-testid^='tkn-mode'], .tkn-mode")].map((e) => e.textContent?.trim().slice(0, 40)));
log("mode rows:", JSON.stringify(modes));
await browser.close();
