import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const STYLED_PAGE = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8"><title>Pricing plans</title>',
  "<style>.hero { color: rgb(185, 28, 28); padding: 24px; }</style></head>",
  '<body><main class="hero"><h1>Plans</h1><p>Simple pricing.</p></main></body>',
  "</html>",
].join("");

test.describe("React project export", () => {
  test("downloads a runnable React project zip for the canvas documents", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("start-brainstorming").click();
    if (await page.getByTestId("blank-chooser").isVisible().catch(() => false)) {
      await page.getByTestId("blank-choose-website").click();
    }
    await page.getByTestId("brief-field-projectDescription").fill("Pricing export canvas");
    await page.getByTestId("brief-field-audience").click();

    await page.getByTestId("import-html-input").setInputFiles({
      name: "pricing.html",
      mimeType: "text/html",
      buffer: Buffer.from(STYLED_PAGE, "utf-8"),
    });
    await expect(page.locator("[data-frame-id]")).toHaveCount(1);

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-react-button").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/-react\.zip$/);
    const path = await download.path();
    if (!path) throw new Error("React export download has no temporary path");

    const bytes = readFileSync(path);
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    const raw = new TextDecoder().decode(bytes);

    for (const entry of [
      "package.json",
      "index.html",
      "tsconfig.json",
      "vite.config.ts",
      "README.md",
      "src/main.tsx",
      "src/App.tsx",
      "src/design/PricingPlans.tsx",
      "src/design/PricingPlans.css",
      "src/design/export-manifest.json",
    ]) {
      expect(raw).toContain(entry);
    }
    expect(raw).toContain('"react"');
    expect(raw).toContain("Simple pricing.");
    expect(raw).toContain("className");
    expect(raw).toContain("rgb(185,28,28)");

    await expect(page.getByTestId("persistence-feedback")).toContainText("react.zip");
  });

  test("reports honestly when Export React is pressed before any page exists", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("start-brainstorming").click();
    if (await page.getByTestId("blank-chooser").isVisible().catch(() => false)) {
      await page.getByTestId("blank-choose-website").click();
    }

    await page.getByTestId("export-react-button").click();
    await expect(page.getByTestId("persistence-feedback")).toContainText("no page code to export yet");
  });
});
