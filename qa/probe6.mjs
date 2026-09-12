import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));

const PREVIEW = "http://127.0.0.1:4173";
await page.goto(PREVIEW + "/");
await page.getByTestId("project-lake").waitFor({ timeout: 10000 });
await page.getByTestId("create-kind-landing").click();
await page.waitForURL(/\/design\//);
await page.waitForSelector('[data-testid="brief-frame"]', { timeout: 8000 });

console.log("== Export Code with NO pages ==");
const dl0 = page.waitForEvent("download", { timeout: 3000 }).catch(() => null);
await page.getByTestId("export-code-button").click();
await page.getByTestId("persistence-feedback").waitFor({ timeout: 4000 }).catch(() => {});
console.log("  download:", (await dl0)?.suggestedFilename() ?? "none",
  "| toast:", await page.getByTestId("persistence-feedback").innerText().catch(() => "(absent)"));

console.log("== add a desktop frame, then Export Code ==");
await page.getByTestId("add-frame-button").click();
await page.getByTestId("frame-category-desktop").click();
const preset = page.locator('[data-testid^="add-"][data-testid$="-frame"]').first();
await preset.click();
await page.waitForSelector(`${'[data-frame-id]'} iframe`, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);
const dl1 = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
await page.getByTestId("export-code-button").click();
const d1 = await dl1;
if (d1) {
  const p = "qa/evidence/" + d1.suggestedFilename();
  await d1.saveAs(p);
  const buf = (await import("node:fs")).readFileSync(p);
  console.log("  download:", d1.suggestedFilename(), buf.length, "bytes, magic:", buf.subarray(0, 2).toString());
} else {
  console.log("  download: NONE | toast:", await page.getByTestId("persistence-feedback").innerText().catch(() => "(absent)"));
}
await page.screenshot({ path: "qa/evidence/probe-export.png" });
await browser.close();
