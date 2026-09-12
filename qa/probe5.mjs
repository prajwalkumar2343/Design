import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));

const PREVIEW = "http://127.0.0.1:4173";

// real project: exports code + fig
console.log("== real project exports ==");
await page.goto(PREVIEW + "/");
await page.getByTestId("project-lake").waitFor({ timeout: 10000 });
await page.getByTestId("create-kind-landing").click();
await page.waitForURL(/\/design\//);
await page.waitForSelector('[data-testid="brief-frame"]', { timeout: 8000 });
for (const [id, label] of [["export-code-button", "code"], ["export-figma-button", "fig"]]) {
  const dl = page.waitForEvent("download", { timeout: 6000 }).catch(() => null);
  await page.getByTestId(id).click();
  const d = await dl;
  console.log(`  ${label}:`, d ? d.suggestedFilename() : "NO DOWNLOAD", "| feedback:", await page.getByTestId("persistence-feedback").innerText().catch(() => "(none)"));
}

// demo: shader add + tokens tab + marquee + resize/rotate + glass on text vs rect
console.log("\n== demo canvas deep checks ==");
await page.goto(PREVIEW + "/?demo=1");
await page.waitForSelector('[data-frame-id="desktop"][data-bridge-status="ready"]', { timeout: 15000 });

// shader add
await page.getByTestId("tool-button-shader").click();
await page.waitForSelector('[data-testid="shader-card-mesh-gradient"]', { timeout: 5000 });
const sBefore = await page.getByTestId("shader-element").count();
await page.getByTestId("shader-card-mesh-gradient").click();
await page.waitForTimeout(1000);
const sAfter = await page.getByTestId("shader-element").count();
console.log("  shader add:", sBefore, "→", sAfter, sAfter > sBefore ? "PASS" : "FAIL");
await page.screenshot({ path: "qa/evidence/probe-shader.png" });

// tokens tab (left sidebar)
await page.locator("button", { hasText: "Tokens" }).first().click().catch(() => {});
await page.waitForTimeout(500);
console.log("  tokens panel visible:", await page.getByTestId("tokens-panel").isVisible().catch(() => false));
await page.screenshot({ path: "qa/evidence/probe-tokens.png" });

// resize + rotate handles on node selection
const preview = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
const heading = preview.getByRole("heading", { name: "Make room for better ideas." });
await page.keyboard.press("Escape");
await heading.click();
await page.waitForTimeout(600);
console.log("  node-selection-box:", await page.getByTestId("node-selection-box").count());
console.log("  resize nw handle:", await page.getByRole("button", { name: "Resize selection from nw" }).count());
console.log("  rotate handle:", await page.getByRole("button", { name: "Rotate selection" }).count());

// drag a resize handle — element size changes?
const hBefore = await heading.boundingBox();
const nw = page.getByRole("button", { name: "Resize selection from se" });
if (await nw.count()) {
  const hb = await nw.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 40, hb.y + 20, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const hAfter = await heading.boundingBox();
  console.log("  resize se drag: w", Math.round(hBefore.width), "→", Math.round(hAfter.width), Math.abs(hAfter.width - hBefore.width) > 4 ? "PASS" : "FAIL/NOCHANGE");
} else console.log("  resize se handle missing");

// shift multi-select
const para = preview.locator("p").first();
await heading.click();
await page.waitForTimeout(400);
await para.click({ modifiers: ["Shift"] });
await page.waitForTimeout(500);
console.log("  multi outlines:", await page.locator('[data-testid^="node-selection-outline-id"]').count());

// glass on rectangle (positive control) then on text (suspected bug)
await page.keyboard.press("Escape");
await page.getByTestId("tool-button-rectangle").click();
const layer = page.locator('[data-frame-id="desktop"]').getByTestId("frame-creation-layer");
const lb = await layer.boundingBox();
await page.mouse.move(lb.x + lb.width * 0.15, lb.y + lb.height * 0.15);
await page.mouse.down();
await page.mouse.move(lb.x + lb.width * 0.15 + 130, lb.y + lb.height * 0.15 + 90, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(500);
const rect = preview.locator('[data-design-tool-kind="rectangle"]').last();
await rect.click();
await page.waitForTimeout(600);
console.log("  glass on rectangle visible:", await page.getByTestId("glass-level-increment").isVisible().catch(() => false));

await page.keyboard.press("Escape");
await page.getByTestId("tool-button-text").click();
const lb2 = await layer.boundingBox();
await page.mouse.move(lb2.x + lb2.width * 0.5, lb2.y + lb2.height * 0.55);
await page.mouse.down(); await page.mouse.up();
await page.keyboard.type("Glassy", { delay: 10 });
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
const tl = preview.locator('[data-design-tool-kind="text"]').last();
await tl.click();
await page.waitForTimeout(700);
console.log("  glass on text visible:", await page.getByTestId("glass-level-increment").isVisible().catch(() => false), "← e2e expects TRUE");
await browser.close();
