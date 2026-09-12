import { expect, test } from "@playwright/test";

test.describe("Token theme store", () => {
  test("switches themes and authors a token from the Tokens panel", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("project-lake")).toBeVisible();
    await page.getByTestId("create-kind-landing").click();
    await page.waitForURL(/\/design\//);
    await expect(page.getByTestId("brief-frame")).toBeVisible();

    // Tokens live in the left sidebar next to pages and layers.
    await page.getByTestId("sidebar-tab-tokens").click();
    await expect(page.getByTestId("tokens-panel")).toBeVisible();
    await expect(page.getByTestId("theme-switch-light")).toHaveAttribute("aria-pressed", "true");

    // Switching to dark marks it active.
    await page.getByTestId("theme-switch-dark").click();
    await expect(page.getByTestId("theme-switch-dark")).toHaveAttribute("aria-pressed", "true");

    // Authoring a token shows it in the set list.
    await page.getByTestId("token-set-select").selectOption({ label: "Light" });
    await page.getByTestId("token-creator-toggle").click();
    await page.getByTestId("token-name-input").fill("color.e2e.check");
    await page.getByTestId("token-value-value").fill("#654321");
    await page.getByTestId("token-create-button").click();
    await expect(page.getByText("color.e2e.check")).toBeVisible();

    // Theme choice and tokens survive a reload via project persistence.
    await page.waitForTimeout(1200); // autosave debounce
    await page.reload();
    await expect(page.getByTestId("brief-frame")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("sidebar-tab-tokens").click();
    await expect(page.getByTestId("theme-switch-dark")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("token-set-select").selectOption({ label: "Light" });
    await expect(page.getByText("color.e2e.check")).toBeVisible();
  });

  test("injects the active theme variables into live design iframes", async ({ page }) => {
    await page.goto("/?demo=1");
    const liveFrame = page.locator("iframe.frame-document").first();
    await expect(liveFrame).toBeVisible({ timeout: 15000 });

    await page.getByTestId("sidebar-tab-tokens").click();
    await expect(page.getByTestId("tokens-panel")).toBeVisible();
    await page.getByTestId("theme-switch-dark").click();
    await expect(page.getByTestId("theme-switch-dark")).toHaveAttribute("aria-pressed", "true");

    // Mode switches update the live theme block in place — rebuilding srcdoc
    // would reload the iframe and wipe live edits like var() links.
    const frameDoc = liveFrame.contentFrame();
    await expect
      .poll(() =>
        frameDoc.locator("html").evaluate((el) =>
          getComputedStyle(el).getPropertyValue("--color-accent-primary").trim(),
        ),
      )
      .toBe("#6faee0");
    const srcdoc = await liveFrame.getAttribute("srcdoc");
    expect(srcdoc).toContain("data-design-tool-token-theme");
    expect(srcdoc).not.toContain("data-design-tool-wireframe-theme");
  });
});
