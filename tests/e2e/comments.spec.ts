import { expect, test } from "@playwright/test";

async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await expect(page.locator('[data-frame-id="desktop"]')).toHaveAttribute("data-bridge-status", "ready");
}

test.describe("canvas comments", () => {
  test("creates, selects, edits, resolves, deletes, and restores a comment", async ({ page }) => {
    await openEditor(page);
    const preview = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
    const heading = preview.getByRole("heading", { name: "Make room for better ideas." });

    await page.getByTestId("tool-button-comment").click();
    await heading.click();
    await expect(page.getByTestId("comment-marker")).toHaveCount(1);
    await expect(page.getByTestId("comment-popover")).toBeVisible();
    await expect(page.getByTestId("comment-input")).toBeFocused();

    await page.getByTestId("comment-input").fill("Tighten the heading rhythm");
    await page.getByTestId("comment-save").click();
    await expect(page.getByTestId("comment-body")).toHaveText("Tighten the heading rhythm");
    await expect(page.getByTestId("comment-feedback")).toHaveText("Comment saved");

    await page.getByTestId("comment-edit").click();
    await page.getByTestId("comment-input").fill("Use a calmer headline scale");
    await page.getByTestId("comment-save").click();
    await expect(page.getByTestId("comment-body")).toHaveText("Use a calmer headline scale");

    await page.getByRole("button", { name: "Resolve comment" }).click();
    await expect(page.getByTestId("comment-marker")).toHaveAttribute("data-comment-status", "resolved");
    await expect(page.getByRole("button", { name: "Reopen comment" })).toBeVisible();

    await page.getByRole("button", { name: "Close comment" }).click();
    await expect(page.getByTestId("comment-popover")).toHaveCount(0);
    await page.getByTestId("comment-marker").click();
    await expect(page.getByTestId("comment-body")).toHaveText("Use a calmer headline scale");

    await page.getByRole("button", { name: "Delete comment" }).click();
    await expect(page.getByTestId("comment-marker")).toHaveCount(0);
    await expect(page.getByTestId("comment-feedback")).toHaveText("Comment deleted");

    await page.getByTestId("undo-button").click();
    await expect(page.getByTestId("comment-marker")).toHaveCount(1);
    await expect(page.getByTestId("comment-body")).toHaveText("Use a calmer headline scale");
    await expect(page.getByTestId("comment-feedback")).toHaveText("Comment restored");

    await page.getByTestId("redo-button").click();
    await expect(page.getByTestId("comment-marker")).toHaveCount(0);
    await expect(page.getByTestId("comment-feedback")).toHaveText("Comment deleted");
  });
});

