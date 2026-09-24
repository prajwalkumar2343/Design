// Tokens inside a real project (same context) + mobile overflow.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE ?? "http://localhost:5173";
const OUT = path.resolve(process.cwd(), "qa/evidence-visual");
let idx = 400;
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
await page.waitForTimeout(700);

// create landing project (same context)
await page.getByTestId("create-kind-landing").click();
await page.waitForTimeout(2500);
log("url:", page.url());

// tokens tab inside the project
const tknTab = page.getByTestId("sidebar-tab-tokens");
log("tokens tab exists:", await tknTab.count());
if (await tknTab.count()) {
  await tknTab.click();
  await page.waitForTimeout(800);
  await shot(page, "tokens-in-project");
  const info = await page.evaluate(() => ({
    btns: [...document.querySelectorAll(".sidebar-active-panel button")].map((b) => (b.getAttribute("data-testid") || b.getAttribute("aria-label") || b.textContent).trim().slice(0, 40)).filter(Boolean).slice(0, 50),
  }));
  log("token buttons:", JSON.stringify(info.btns));
  // click through mode rows / theme rows
  for (const sel of ["[data-testid^='tkn-mode']", ".tkn-mode", "[role='tab']"]) {
    const n = await page.locator(sel).count();
    if (n) log(sel, "x", n);
  }
}

// mobile overflow check
const mob = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await mob.newPage();
await mp.goto(BASE + "/?demo=1");
await mp.waitForSelector("[data-frame-id] iframe", { timeout: 20000 });
await mp.waitForTimeout(1200);
await mp.screenshot({ path: path.join(OUT, "410-mobile.png") });
const ov = await mp.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: innerWidth }));
log("mobile overflow:", JSON.stringify(ov));
await browser.close();
