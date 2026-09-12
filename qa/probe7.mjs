import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const glWarn = [];
page.on("console", (m) => { if (/WebGL/i.test(m.text())) glWarn.push(m.text()); });

await page.goto("http://127.0.0.1:4173/?demo=1");
await page.waitForSelector('[data-frame-id="desktop"][data-bridge-status="ready"]', { timeout: 15000 });

// WebGL contexts when shader menu opens
console.log("== shader menu WebGL load ==");
await page.getByTestId("tool-button-shader").click();
await page.waitForSelector('[data-testid="shader-menu"]', { timeout: 5000 });
await page.waitForTimeout(1500);
const canvases = await page.getByTestId("shader-menu").locator("canvas").count();
console.log("  shader preview canvases in menu:", canvases, "| WebGL warnings:", glWarn.length, glWarn.slice(0, 2));
await page.screenshot({ path: "qa/evidence/probe-shadermenu.png" });
await page.keyboard.press("Escape");

// frame move-handle hit area across frames
console.log("== frame handle hit area ==");
for (const fid of ["desktop", "tablet", "mobile"]) {
  const f = page.locator(`[data-frame-id="${fid}"]`);
  const handle = f.getByRole("button", { name: /Move / });
  const b = await handle.boundingBox().catch(() => null);
  if (b) console.log(`  ${fid}: handle ${Math.round(b.width)}x${Math.round(b.height)}px`);
}

// 1px drag test (fresh frame context)
console.log("== 1px drag ==");
const preview = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
const kindsBefore = await preview.locator("[data-design-tool-kind]").count();
await page.keyboard.press("r");
const layer = page.locator('[data-frame-id="desktop"]').getByTestId("frame-creation-layer");
const lbc = await layer.count();
if (lbc === 0) {
  // need the frame selected/hovered first?
  await page.locator('[data-frame-id="desktop"]').hover();
  await page.waitForTimeout(300);
}
const lb = await layer.boundingBox();
if (lb) {
  await page.mouse.move(lb.x + 40, lb.y + 40);
  await page.mouse.down(); await page.mouse.move(lb.x + 41, lb.y + 41); await page.mouse.up();
  await page.waitForTimeout(400);
  console.log("  elements before/after 1px drag:", kindsBefore, "/", await preview.locator("[data-design-tool-kind]").count());
} else console.log("  no creation layer (frame not active?)");

// shift multi-select retest
console.log("== shift multi-select ==");
const heading = preview.getByRole("heading", { name: "Make room for better ideas." });
await heading.click();
await page.getByTestId("node-selection-box").waitFor({ timeout: 5000 });
const para = preview.locator("p").first();
const pbox = await para.boundingBox();
console.log("  para box:", JSON.stringify(pbox));
await para.click({ modifiers: ["Shift"] });
await page.waitForTimeout(800);
console.log("  outlines:", await page.locator('[data-testid^="node-selection-outline-id"]').count(),
  "| sel box:", await page.getByTestId("node-selection-box").count());
await page.screenshot({ path: "qa/evidence/probe-multiselect.png" });
await browser.close();
