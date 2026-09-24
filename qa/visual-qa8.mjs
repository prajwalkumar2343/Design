// Overflow + overlap scan across viewports and surfaces.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE ?? "http://localhost:5173";
const OUT = path.resolve(process.cwd(), "qa/evidence-visual");
let idx = 800;
async function shot(page, name) {
  idx += 1;
  await page.screenshot({ path: path.join(OUT, `${idx}-${name}.png`) }).catch(() => {});
}
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ headless: true });

for (const vp of [{ w: 1440, h: 900 }, { w: 1024, h: 768 }, { w: 800, h: 600 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log(`[${vp.w}] PAGEERROR:`, e.message));

  // lake
  await page.goto(BASE + "/");
  await page.waitForSelector(".project-lake", { timeout: 15000 });
  await page.waitForTimeout(700);
  await shot(page, `lake-${vp.w}`);

  // demo canvas
  await page.goto(BASE + "/?demo=1");
  await page.waitForSelector("[data-frame-id] iframe", { timeout: 20000 });
  await page.waitForTimeout(1200);
  await shot(page, `canvas-${vp.w}`);

  // horizontal overflow of chrome elements
  const issues = await page.evaluate(() => {
    const out = [];
    const vw = innerWidth;
    for (const el of document.querySelectorAll("[data-canvas-control], .workspace-header, .canvas-dock, .left-sidebar, .right-properties-panel, .canvas-help")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < -0.5 || r.right > vw + 0.5) out.push(`${el.className?.toString().slice(0, 50)} [${Math.round(r.left)}..${Math.round(r.right)}] vw=${vw}`);
    }
    return out;
  });
  if (issues.length) log(`[${vp.w}] OVERFLOW:`, JSON.stringify(issues));
  else log(`[${vp.w}] chrome overflow: none`);

  // dock vs sidebars overlap check at small sizes
  const overlap = await page.evaluate(() => {
    const dock = document.querySelector(".canvas-dock")?.getBoundingClientRect();
    const ls = document.querySelector(".left-sidebar")?.getBoundingClientRect();
    const rs = document.querySelector(".right-properties-panel")?.getBoundingClientRect();
    const hit = (a, b) => a && b && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    return { dockLeft: hit(dock, ls), dockRight: hit(dock, rs) };
  });
  if (overlap.dockLeft || overlap.dockRight) log(`[${vp.w}] DOCK OVERLAP:`, JSON.stringify(overlap));

  await ctx.close();
}
await browser.close();
