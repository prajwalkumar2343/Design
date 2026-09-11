import { test } from "@playwright/test";

test("dump card DOM (dev)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err).slice(0, 1200)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("[console.error] " + msg.text().slice(0, 400));
  });
  await page.goto("http://127.0.0.1:5199/?demo=1");
  await page.getByTestId("tool-button-shader").click();
  await page.getByTestId("shader-menu").waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(3500);
  const html = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('[data-testid="shader-card-mesh-gradient"]');
    return card ? card.outerHTML.slice(0, 1500) : "no card";
  });
  console.log("CARD HTML:", html);
  console.log("PAGE ERRORS:", errors.length ? errors.slice(0, 3) : "none");
});
