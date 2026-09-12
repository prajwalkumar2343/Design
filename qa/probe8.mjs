import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

await page.goto("http://127.0.0.1:4173/?demo=1");
await page.waitForSelector('[data-frame-id="desktop"][data-bridge-status="ready"]', { timeout: 15000 });
const preview = page.locator('[data-frame-id="desktop"] iframe').contentFrame();

// shift multi-select, correct selector
const heading = preview.getByRole("heading", { name: "Make room for better ideas." });
await heading.click();
await page.getByTestId("node-selection-box").waitFor({ timeout: 5000 });
const para = preview.getByText(/A quiet place for teams/);
await para.click({ modifiers: ["Shift"] });
await page.waitForTimeout(700);
console.log("multi-select outlines (.node-selection-outline):", await page.locator(".node-selection-outline").count());

// 1px drag — what geometry did the created element get?
await page.keyboard.press("Escape");
await page.keyboard.press("r");
const layer = page.locator('[data-frame-id="desktop"]').getByTestId("frame-creation-layer");
const lb = await layer.boundingBox();
await page.mouse.move(lb.x + 40, lb.y + 40);
await page.mouse.down(); await page.mouse.move(lb.x + 41, lb.y + 41); await page.mouse.up();
await page.waitForTimeout(500);
const created = await preview.locator("[data-design-tool-created='true']").evaluateAll((els) =>
  els.map((e) => ({ kind: e.getAttribute("data-design-tool-kind"), w: e.getAttribute("width") ?? e.style.width, h: e.getAttribute("height") ?? e.style.height, style: (e.getAttribute("style") ?? "").slice(0, 120) })));
console.log("elements after 1px drag:", JSON.stringify(created));

// frame handle: is there a bigger visual bar vs the button? measure the frame title element
const frame = page.locator('[data-frame-id="tablet"]');
const handle = frame.getByRole("button", { name: /Move / });
const dims = await handle.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return { w: r.width, h: r.height, py: cs.paddingTop + "/" + cs.paddingBottom, fs: cs.fontSize, overflow: cs.overflow, parentH: el.parentElement?.getBoundingClientRect().height };
});
console.log("tablet handle dims:", JSON.stringify(dims));
await page.screenshot({ path: "qa/evidence/probe-handle.png", clip: { x: 640, y: 270, width: 220, height: 90 } });
await browser.close();
