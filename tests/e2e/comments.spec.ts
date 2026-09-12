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
    await expect(page.getByTestId("comment-feedback")).toHaveCount(0);

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

  test("supports keyboard navigation, explicit save, resolve and reopen", async ({ page }) => {
    await openEditor(page);
    const heading = page.locator('[data-frame-id="desktop"] iframe').contentFrame().getByRole("heading", { name: "Make room for better ideas." });
    await page.getByTestId("tool-button-comment").click();
    await heading.click();
    await expect(page.getByRole("button", { name: "Save comment", exact: true })).toBeDisabled();
    await page.getByTestId("comment-input").fill("Give the headline more breathing room.");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Save comment", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("comment-popover")).toHaveCount(0);
    await page.getByTestId("comment-marker").click();
    await expect(page.getByTestId("comment-marker")).toHaveAttribute("aria-expanded", "true");
    await page.mouse.move(0, 0);
    await expect.poll(async () => Math.round((await page.getByTestId("comment-marker").boundingBox())!.width)).toBe(28);
    await page.getByRole("button", { name: "Resolve comment", exact: true }).click();
    await expect(page.getByTestId("comment-marker")).toHaveAttribute("data-comment-status", "resolved");
    await page.getByTestId("comment-marker").click();
    await expect(page.locator(".comment-status")).toHaveText("Resolved");
    await page.getByRole("button", { name: "Reopen comment", exact: true }).click();
    await expect(page.getByTestId("comment-marker")).toHaveAttribute("data-comment-status", "open");
  });

  test("keeps a long comment within the viewport after resizing", async ({ page }) => {
    await openEditor(page);
    const heading = page.locator('[data-frame-id="desktop"] iframe').contentFrame().getByRole("heading", { name: "Make room for better ideas." });
    await page.getByTestId("tool-button-comment").click();
    await heading.click();
    await page.getByTestId("comment-input").fill("A detailed review note.\n".repeat(35));
    await page.setViewportSize({ width: 640, height: 480 });
    await expect(page.getByRole("button", { name: "Save comment", exact: true })).toBeVisible();
    await expect.poll(async () => {
      const box = await page.getByTestId("comment-popover").boundingBox();
      return !!box && box.x >= 11 && box.y >= 11 && box.x + box.width <= 629 && box.y + box.height <= 469;
    }).toBe(true);
    await page.getByRole("button", { name: "Save comment", exact: true }).click();
    await expect(page.getByTestId("comment-popover")).toHaveCount(0);
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
    const headingBox = (await heading.boundingBox())!;
    // Fractional offsets keep the taps inside the heading at any camera zoom.
    await page.mouse.click(headingBox.x + headingBox.width * 0.3, headingBox.y + headingBox.height * 0.4);
    await page.getByTestId("comment-input").fill("First comment");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("comment-popover")).toHaveCount(0);
    await expect(page.getByTestId("comment-marker")).toHaveCount(1);

    await page.mouse.click(headingBox.x + headingBox.width * 0.7, headingBox.y + headingBox.height * 0.6);
    await expect(page.getByTestId("comment-marker")).toHaveCount(2);
    await expect(page.getByTestId("comment-input")).toBeFocused();
    await expect(page.getByTestId("comment-input")).toHaveValue("");

    await page.getByTestId("canvas-surface").click({ position: { x: 30, y: 40 } });
    await expect(page.getByTestId("comment-popover")).toHaveCount(0);
    await expect(page.getByTestId("comment-marker")).toHaveCount(1);
  });
});