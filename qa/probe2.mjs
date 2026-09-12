// Probe 2b: fit camera first, then select/comment/export probes.
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 200)));

async function probeSelect(base, tag) {
  console.log(`\n== select-in-iframe on ${tag} ==`);
  await page.goto(base + "/?demo=1");
  await page.waitForSelector('[data-frame-id="desktop"][data-bridge-status="ready"]', { timeout: 15000 });
  // fit all frames so content is fully in viewport
  await page.getByRole("button", { name: "Fit all frames" }).last().click();
  await page.waitForTimeout(800);
  const preview = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
  const heading = preview.getByRole("heading", { name: "Make room for better ideas." });
  const box = await heading.boundingBox();
  console.log("  heading box after fit:", JSON.stringify(box));
  if (!box || box.y + box.height > 890) console.log("  NOTE: still below fold");
  try {
    await heading.click({ timeout: 6000 });
    console.log("  click ok");
  } catch (e) {
    console.log("  click FAILED:", String(e.message).split("\n").filter((l) => l.trim()).slice(0, 6).join(" | "));
    await heading.click({ force: true }).catch(() => {});
  }
  await page.waitForTimeout(600);
  console.log("  selection box:", await page.getByTestId("node-selection-box").count(),
    "| frame selected:", await page.locator('[data-frame-id="desktop"]').getAttribute("data-selected"));
  await page.screenshot({ path: `qa/evidence/probe-select-${tag.replace(/[^a-z0-9]/gi, "")}.png` });
  // comment flow
  await page.keyboard.press("Escape").catch(() => {});
  await page.getByTestId("tool-button-comment").click();
  try {
    await heading.click({ timeout: 6000 });
    await page.waitForTimeout(600);
    console.log("  comment markers:", await page.getByTestId("comment-marker").count(),
      "| popover:", await page.getByTestId("comment-popover").count(),
      "| input focused:", await page.getByTestId("comment-input").isFocused().catch(() => false));
  } catch (e) {
    console.log("  comment click FAILED:", String(e.message).split("\n").filter((l) => l.trim()).slice(0, 5).join(" | "));
  }
}

await probeSelect("http://localhost:5199", "DEV5199");
await probeSelect("http://127.0.0.1:4173", "PREVIEW4173");

// glass slider reproduction (preview)
console.log("\n== glass slider on text layer (preview) ==");
await page.goto("http://127.0.0.1:4173/?demo=1");
await page.waitForSelector('[data-frame-id="desktop"][data-bridge-status="ready"]', { timeout: 15000 });
await page.getByRole("button", { name: "Fit all frames" }).last().click();
await page.waitForTimeout(500);
{
  const frame = page.locator('[data-frame-id="desktop"]');
  await page.getByTestId("tool-button-text").click();
  const layer = frame.getByTestId("frame-creation-layer");
  const box = await layer.boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3 + 160, box.y + box.height * 0.5 + 30, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.keyboard.type("Glassy", { delay: 15 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const preview = frame.locator("iframe").contentFrame();
  const textLayer = preview.locator('[data-design-tool-kind="text"]').last();
  const tb = await textLayer.boundingBox();
  console.log("  text layer box:", JSON.stringify(tb));
  if (tb) {
    await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.waitForTimeout(700);
  }
  console.log("  glass-level-increment visible:", await page.getByTestId("glass-level-increment").isVisible().catch(() => false));
  const panelText = await page.getByTestId("properties-panel").innerText().catch(() => "(no panel)");
  console.log("  panel text:", panelText.slice(0, 400).replace(/\n/g, " | "));
  await page.screenshot({ path: "qa/evidence/probe-glass.png" });
}

// exports in a real project
console.log("\n== exports in a real project (preview) ==");
await page.goto("http://127.0.0.1:4173/");
await page.getByTestId("project-lake").waitFor({ timeout: 10000 });
await page.getByTestId("create-kind-landing").click();
await page.waitForURL(/\/design\//);
await page.waitForSelector('[data-testid="brief-frame"]', { timeout: 8000 });
for (const id of ["export-project-button", "export-figma-button", "export-code-button", "import-html-button"]) {
  console.log(`  ${id}: count=${await page.getByTestId(id).count()}`);
}
{
  const btn = page.getByTestId("export-project-button");
  if (await btn.count()) {
    const dl = page.waitForEvent("download", { timeout: 6000 }).catch(() => null);
    await btn.click();
    const d = await dl;
    console.log("  export download:", d ? d.suggestedFilename() : "NONE");
    console.log("  feedback:", await page.getByTestId("persistence-feedback").innerText().catch(() => "(none)"));
  }
}

await browser.close();
