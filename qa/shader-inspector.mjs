// Visual check: select a placed shader and exercise the right-panel inspector.
import { chromium } from "@playwright/test";
import path from "node:path";

const BASE = process.env.QA_BASE ?? "http://localhost:5199";
const OUT = path.resolve(process.cwd(), "qa/evidence-visual");
let idx = 900;
async function shot(page, name) {
  idx += 1;
  const file = `${idx}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, file) }).catch(() => {});
  return file;
}
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => log("PAGEERROR:", e.message));

await page.goto(BASE + "/?demo=1");
await page.waitForSelector(".canvas-dock", { timeout: 20000 });
await page.waitForTimeout(1500);

// Place a mesh gradient via the shader menu.
await page.getByTestId("tool-button-shader").click();
await page.getByTestId("shader-menu").waitFor({ state: "visible", timeout: 10000 });
await page.getByTestId("shader-card-mesh-gradient").click();
const el = page.getByTestId("shader-element").first();
await el.waitFor({ state: "visible", timeout: 15000 });
await page.waitForTimeout(800);

// Click the element to select it (center of the card).
const box = await el.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(600);
await shot(page, "shader-selected-inspector");

// Inspector assertions
const panel = page.getByTestId("properties-panel");
const hasX = await panel.getByTestId("property-shader-x").count();
const hasRadius = await panel.getByTestId("shape-radius-slider").count();
const hasEditor = await panel.getByTestId(`shader-editor-${await el.getAttribute("data-shader-element-id")}`).count();
const hasColors = await panel.locator('[data-testid^="shader-param-colors"]').count();
const hasSpeed = await panel.locator('[data-testid="shader-param-speed"]').count();
const hasPreset = await panel.getByTestId("shader-preset-select").count();
log(`inspector: x=${hasX} radius=${hasRadius} editor=${hasEditor} colors=${hasColors} speed=${hasSpeed} preset=${hasPreset}`);

// Drag the corner-radius slider and confirm the element rounds.
const radius = panel.getByTestId("shape-radius-slider");
await radius.fill("70");
await page.waitForTimeout(300);
const br = await el.evaluate((n) => getComputedStyle(n).borderRadius);
log("element border-radius after slider:", br);
await shot(page, "shader-radius-70");

// Move the distortion slider (param edit) while panel is open — deselect bug check.
const distortion = panel.getByLabel("Distortion slider");
await distortion.fill("0.4");
await page.waitForTimeout(400);
const stillSelected = await page.locator(".canvas-shader-element.is-selected").count();
log("still selected after param edit:", stillSelected);
const stillInspector = await panel.getByTestId("property-shader-x").count();
log("inspector still showing:", stillInspector);
await shot(page, "shader-param-edited");

// Open a color swatch popover in the Colors group.
const swatches = panel.locator(".shader-param.is-colors .color-swatch-button");
const nSwatch = await swatches.count();
log("color stops:", nSwatch);
if (nSwatch > 0) {
  await swatches.first().click();
  await page.waitForTimeout(300);
  const pop = await panel.locator(".shader-color-popover").count();
  log("color popover open:", pop);
  await shot(page, "shader-color-popover");
  // pick a swatch
  const opt = panel.locator(".shader-color-popover .color-swatch").nth(8);
  if (await opt.count()) await opt.click();
  await page.waitForTimeout(300);
  await shot(page, "shader-color-picked");
}

await ctx.close();
await browser.close();
log("done");
