import { chromium } from "@playwright/test";
import path from "node:path";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto("http://localhost:5199/?demo=1");
await page.waitForSelector(".canvas-dock", { timeout: 20000 });
await page.waitForTimeout(1200);
await page.getByTestId("tool-button-shader").click();
await page.getByTestId("shader-card-mesh-gradient").click();
await page.waitForTimeout(1500); // add selects -> sidebar row auto-expands
const report = await page.evaluate(() => {
  const el = document.querySelector(".sidebar-panel-content");
  if (!el) return ["no sidebar panel"];
  const clip = el.getBoundingClientRect();
  const out = [`sidebar right=${Math.round(clip.right)} scrollW=${el.scrollWidth} clientW=${el.clientWidth}`];
  for (const num of el.querySelectorAll(".shader-param-number")) {
    const r = num.getBoundingClientRect();
    if (r.width === 0) continue;
    out.push(`${num.closest(".shader-param")?.querySelector(".shader-param-label")?.textContent} right=${Math.round(r.right)} clipped=${r.right > clip.right + 0.5} w=${r.width}`);
  }
  return out;
});
console.log(report.join("\n"));
const sidebar = page.locator(".left-sidebar");
await sidebar.screenshot({ path: path.resolve("qa/evidence-visual/910-left-shader-editor.png") }).catch(() => {});
await browser.close();
