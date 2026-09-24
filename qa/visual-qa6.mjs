// In-project interactions: theme switch, token create, exports, dock menus.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE ?? "http://localhost:5173";
const OUT = path.resolve(process.cwd(), "qa/evidence-visual");
let idx = 500;
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

await page.goto(BASE + "/");
await page.waitForSelector(".project-lake", { timeout: 15000 });
await page.getByTestId("create-kind-landing").click();
await page.waitForTimeout(2200);

// ── theme switch re-skins ──
await page.getByTestId("sidebar-tab-tokens").click();
await page.waitForTimeout(600);
await page.getByTestId("theme-switch-dark").click();
await page.waitForTimeout(800);
await shot(page, "theme-dark-switched");
const activeTheme = await page.evaluate(() => document.querySelector("[data-testid^='theme-switch'].is-active, [class*='is-active'][data-testid^='theme']")?.getAttribute("data-testid"));
log("active theme after switch:", activeTheme);
// back to light
await page.getByTestId("theme-switch-light").click();
await page.waitForTimeout(500);

// ── token create form ──
await page.getByTestId("token-creator-toggle").click();
await page.waitForTimeout(400);
await shot(page, "token-create-form");
const createBtn = page.getByTestId("token-create-button");
log("create disabled empty:", await createBtn.isDisabled().catch(() => "?"));

// ── import/export buttons ──
await shot(page, "tokens-bottom-scroll");
const importBtn = page.getByTestId("tokens-import-button");
log("import btn:", await importBtn.count(), await importBtn.isVisible().catch(() => false));
const dtcg = page.getByTestId("tokens-export-dtcg");
if (await dtcg.count()) {
  const dl = page.waitForEvent("download", { timeout: 4000 }).catch(() => null);
  await dtcg.click();
  const d = await dl;
  log("dtcg export download:", d ? await d.suggestedFilename() : "NONE");
}

// ── export buttons in header ──
for (const [tid, name] of [["export-project-button", "wirecanvas"], ["export-code-button", "code"]]) {
  const btn = page.getByTestId(tid);
  if (await btn.count()) {
    const dlp = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
    await btn.click();
    const d = await dlp;
    log(name, "export:", d ? await d.suggestedFilename() : "no-download (maybe toast)");
    await page.waitForTimeout(400);
  }
}
await shot(page, "after-exports");

// ── brainstorm brief frame interactions ──
const briefField = page.locator(".brief-frame textarea, [class*='brief'] textarea, [data-testid^='brief']").first();
log("brief fields:", await page.locator("textarea").count());

await browser.close();
