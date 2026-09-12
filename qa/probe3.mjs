import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));

for (const base of ["http://localhost:5199", "http://127.0.0.1:4173"]) {
  console.log(`\n== ${base} ==`);
  await page.goto(base + "/?demo=1");
  await page.waitForSelector('[data-frame-id="desktop"][data-bridge-status="ready"]', { timeout: 15000 });
  const preview = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
  const heading = preview.getByRole("heading", { name: "Make room for better ideas." });
  const box = await heading.boundingBox();
  console.log("  heading box:", JSON.stringify(box));
  const t0 = Date.now();
  try { await heading.click({ timeout: 8000 }); console.log("  click ok at", Date.now() - t0, "ms"); }
  catch (e) { console.log("  click fail:", String(e.message).split("\n").slice(0, 4).join(" | ")); }
  let seen = -1;
  for (let i = 0; i < 30; i++) {
    if (await page.getByTestId("node-selection-box").count()) { seen = i * 200; break; }
    await page.waitForTimeout(200);
  }
  console.log("  selection box after ~", seen, "ms");
  await page.keyboard.press("Escape").catch(() => {});
  await page.getByTestId("tool-button-comment").click();
  try { await heading.click({ timeout: 8000 }); } catch { console.log("  comment click fail"); }
  let cm = -1;
  for (let i = 0; i < 30; i++) {
    if (await page.getByTestId("comment-marker").count()) { cm = i * 200; break; }
    await page.waitForTimeout(200);
  }
  console.log("  comment marker after ~", cm, "ms; popover:", await page.getByTestId("comment-popover").count());
}
await browser.close();
