import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

await page.goto("http://127.0.0.1:4173/");
await page.getByTestId("project-lake").waitFor({ timeout: 10000 });
const inputs = await page.locator('[data-testid="project-lake"] input').evaluateAll((els) => els.map((e) => ({ ph: e.getAttribute("placeholder"), type: e.type, testid: e.getAttribute("data-testid") })));
console.log("lake inputs:", JSON.stringify(inputs));
const search = page.locator('[data-testid="project-lake"] input').first();
if (await search.count()) {
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  console.log("focused after Ctrl+K:", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName));
  // and slash
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("/");
  await page.waitForTimeout(300);
  console.log("focused after /:", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName));
}
await page.screenshot({ path: "qa/evidence/probe-lake.png" });
// lake card count + sort menu presence
console.log("cards:", await page.getByTestId("project-card").count());
const sortBtns = await page.locator('[data-testid="project-lake"] button').evaluateAll((b) => b.map((x) => x.innerText.slice(0, 24)));
console.log("lake buttons:", JSON.stringify(sortBtns.slice(0, 12)));
await browser.close();
