import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

// iframe-focus keyboard reachability matrix
await page.goto("http://127.0.0.1:4173/?demo=1");
await page.waitForSelector('[data-frame-id="desktop"][data-bridge-status="ready"]', { timeout: 15000 });
const preview = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
const heading = preview.getByRole("heading", { name: "Make room for better ideas." });
await heading.click();
await page.getByTestId("node-selection-box").waitFor({ timeout: 5000 });
console.log("selected; iframe has focus:", await page.evaluate(() => document.activeElement?.tagName));

for (const k of ["r", "t", "h", "0", "Escape", "v"]) {
  await page.keyboard.press(k);
  await page.waitForTimeout(250);
}
const activeTools = await page.locator('.tool-button[aria-pressed="true"]').evaluateAll((b) => b.map((x) => x.getAttribute("data-testid")));
console.log("after r,t,h,0,Esc,v while iframe focused → active tool:", JSON.stringify(activeTools), "| outlines:", await page.locator(".node-selection-outline").count());
// compare: blur iframe by clicking dock, then press r
await page.getByTestId("tool-button-select").click();
await page.keyboard.press("r");
await page.waitForTimeout(250);
console.log("after chrome focus + r → rect pressed:", await page.getByTestId("tool-button-rectangle").getAttribute("aria-pressed"));

// lake: Cmd+K focuses search?
await page.goto("http://127.0.0.1:4173/");
await page.getByTestId("project-lake").waitFor({ timeout: 10000 });
const search = page.locator('[data-testid="project-lake"] input[type="search"], [data-testid="project-lake"] input[placeholder*="earch" i]').first();
const hasSearch = await search.count();
await page.keyboard.press("Control+k");
await page.waitForTimeout(300);
console.log("lake search input:", hasSearch, "| focused after Ctrl+K:", hasSearch ? await search.isFocused() : "n/a");

// agent connection panel content on empty state
await page.goto("http://127.0.0.1:4173/");
const start = page.getByTestId("start-brainstorming").first();
if (await start.count()) {
  // empty canvas state exists — check panel content
  const panel = page.locator('[data-testid="empty-canvas-state"]');
  console.log("empty state text:", (await panel.innerText().catch(() => "")).slice(0, 220).replace(/\n/g, " | "));
} else {
  console.log("no start-brainstorming on / (lake home has", await page.getByTestId("project-card").count(), "cards)");
}
await browser.close();
