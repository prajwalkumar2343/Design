import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));

// 1. glass slider repro on preview
console.log("== glass slider on text layer (preview) ==");
await page.goto("http://127.0.0.1:4173/?demo=1");
await page.waitForSelector('[data-frame-id="desktop"][data-bridge-status="ready"]', { timeout: 15000 });
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
  await textLayer.click();
  await page.waitForTimeout(800);
  const incVisible = await page.getByTestId("glass-level-increment").isVisible().catch(() => false);
  console.log("  glass-level-increment visible:", incVisible);
  const panelText = await page.getByTestId("properties-panel").innerText().catch(() => "(no panel)");
  console.log("  panel:", panelText.slice(0, 300).replace(/\n/g, " | "));
  await page.screenshot({ path: "qa/evidence/probe-glass.png" });
}

// 2. exports in a real project
console.log("\n== exports in real project (preview) ==");
await page.goto("http://127.0.0.1:4173/");
await page.getByTestId("project-lake").waitFor({ timeout: 10000 });
await page.getByTestId("create-kind-landing").click();
await page.waitForURL(/\/design\//);
await page.waitForSelector('[data-testid="brief-frame"]', { timeout: 8000 });
for (const id of ["export-project-button", "export-figma-button", "export-code-button", "import-html-button"])
  console.log(`  ${id}: count=${await page.getByTestId(id).count()}`);
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

// 3. routing edge cases on preview
console.log("\n== routing edge cases (preview) ==");
for (const p of ["/design/%", "/design/", "/design/a%20b", "/p/xyz"]) {
  const resp = await page.goto("http://127.0.0.1:4173" + p).catch((e) => null);
  await page.waitForTimeout(800);
  const nf = await page.getByTestId("project-not-found").count();
  const lake = await page.getByTestId("project-lake").count();
  const empty = await page.getByTestId("empty-canvas-state").count();
  console.log(`  ${p}: http=${resp ? resp.status() : "nav-error"} notFound=${nf} lake=${lake} empty=${empty} url=${page.url().replace("http://127.0.0.1:4173", "")}`);
}

// 4. shape menu reopen + shader add (dev)
console.log("\n== shape/shader menus (dev) ==");
await page.goto("http://localhost:5199/?demo=1");
await page.waitForSelector(`${'[data-frame-id="desktop"]'}[data-bridge-status="ready"]`, { timeout: 15000 });
{
  await page.getByTestId("shape-menu-button").click();
  const m1 = await page.getByRole("menu", { name: "Shape tools" }).count();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.getByTestId("shape-menu-button").click();
  await page.waitForTimeout(400);
  const m2 = await page.getByRole("menu", { name: "Shape tools" }).count();
  console.log("  shape menu open1:", m1, "reopen after Esc:", m2);
  await page.keyboard.press("Escape");
}
{
  await page.getByTestId("tool-button-shader").click();
  await page.waitForTimeout(600);
  const menu = page.getByTestId("shader-menu");
  const buttons = await menu.locator("button").evaluateAll((bs) =>
    bs.slice(0, 15).map((b) => ({ tid: b.getAttribute("data-testid"), t: b.innerText.slice(0, 30).replace(/\n/g, " ") })));
  console.log("  shader menu buttons:", JSON.stringify(buttons));
  // pick the first actual shader entry
  const entry = menu.locator('[data-testid^="shader-option-"], [data-shader-id]').first();
  const ec = await entry.count();
  console.log("  shader entry count:", ec);
  if (ec) {
    const before = await page.getByTestId("shader-element").count();
    await entry.click();
    await page.waitForTimeout(900);
    console.log("  shader-element:", before, "→", await page.getByTestId("shader-element").count());
  }
}
await browser.close();
