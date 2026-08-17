import { expect, test } from "@playwright/test";

async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/?demo=1");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await expect(page.locator('[data-frame-id="desktop"]')).toHaveAttribute("data-bridge-status", "ready");
}

test.describe("canvas comments", () => {
  test("auto-saves a typed comment and dismisses empty comments", async ({ page }) => {
    await openEditor(page);
    const preview = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
    const heading = preview.getByRole("heading", { name: "Make room for better ideas." });

    await page.getByTestId("tool-button-comment").click();
    await heading.click();
    await expect(page.getByTestId("comment-marker")).toHaveCount(1);
    await expect(page.getByTestId("comment-popover")).toBeVisible();
    await expect(page.getByTestId("comment-input")).toBeFocused();

    await page.getByTestId("comment-input").fill("Tighten the heading rhythm");
    await page.getByTestId("tool-button-select").click();
    await expect(page.getByTestId("comment-popover")).toHaveCount(0);
    await expect(page.getByTestId("comment-marker")).toHaveCount(1);
    await expect(page.getByTestId("comment-feedback")).toHaveText("Comment saved");

    await page.getByTestId("comment-marker").click();
    await expect(page.getByTestId("comment-input")).toHaveValue("Tighten the heading rhythm");

    await page.getByTestId("comment-input").fill("Use a calmer headline scale");
    await page.getByTestId("canvas-surface").click({ position: { x: 30, y: 40 } });
    await expect(page.getByTestId("comment-popover")).toHaveCount(0);
    await expect(page.getByTestId("comment-marker")).toHaveCount(1);

    await page.getByTestId("comment-marker").click();
    await page.getByTestId("comment-input").fill("");
    await page.getByTestId("tool-button-select").click();
    await expect(page.getByTestId("comment-marker")).toHaveCount(0);
    await expect(page.getByTestId("comment-feedback")).toHaveText("Comment deleted");
  });

  test("dismisses a brand-new empty comment without registering it", async ({ page }) => {
    await openEditor(page);
    const preview = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
    const heading = preview.getByRole("heading", { name: "Make room for better ideas." });

    await page.getByTestId("tool-button-comment").click();
    await heading.click();
    await expect(page.getByTestId("comment-marker")).toHaveCount(1);
    await expect(page.getByTestId("comment-input")).toBeFocused();

    await page.getByTestId("tool-button-select").click();
    await expect(page.getByTestId("comment-popover")).toHaveCount(0);
    await expect(page.getByTestId("comment-marker")).toHaveCount(0);
  });

  test("opens a fresh empty box for a new comment and dismisses it when empty", async ({ page }) => {
    await openEditor(page);
    const preview = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
    const heading = preview.getByRole("heading", { name: "Make room for better ideas." });

    await page.getByTestId("tool-button-comment").click();
    await heading.click({ position: { x: 200, y: 30 } });
    await page.getByTestId("comment-input").fill("First comment");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("comment-popover")).toHaveCount(0);
    await expect(page.getByTestId("comment-marker")).toHaveCount(1);

    await page.getByTestId("tool-button-comment").click();
    await heading.click({ position: { x: 400, y: 50 } });
    await expect(page.getByTestId("comment-marker")).toHaveCount(2);
    await expect(page.getByTestId("comment-input")).toBeFocused();
    await expect(page.getByTestId("comment-input")).toHaveValue("");

    await page.getByTestId("canvas-surface").click({ position: { x: 30, y: 40 } });
    await expect(page.getByTestId("comment-popover")).toHaveCount(0);
    await expect(page.getByTestId("comment-marker")).toHaveCount(1);
  });
});