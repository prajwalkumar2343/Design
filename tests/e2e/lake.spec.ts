import { expect, test } from "@playwright/test";

test.describe("Project lake", () => {
  test("creates a project, routes to it, and continues from local memory", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("project-lake")).toBeVisible();

    await page.getByTestId("create-kind-landing").click();
    await page.waitForURL(/\/design\//);
    const projectUrl = page.url();
    await expect(page.getByTestId("brief-frame")).toBeVisible();

    // Brief edits persist through the lake round-trip (fields commit on blur).
    const description = page.getByTestId("brief-field-projectDescription");
    await description.fill("Lake regression check description");
    await description.blur();
    await page.waitForTimeout(900); // autosave debounce

    // The header Lake button returns home without losing the project.
    await page.getByTestId("lake-toggle-button").click();
    await expect(page.getByTestId("project-lake")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("project-card")).toHaveCount(1);

    // Reopening continues exactly where the session left off.
    await page.locator('[data-testid="project-card"] .figma-file-thumb').first().click();
    await page.waitForURL(/\/design\//);
    await expect(page.getByTestId("brief-field-projectDescription")).toHaveValue(/Lake regression check/, { timeout: 10000 });
    expect(page.url()).toBe(projectUrl);

    // A hard reload on the project route restores the same session.
    await page.reload();
    await expect(page.getByTestId("brief-field-projectDescription")).toHaveValue(/Lake regression check/, { timeout: 10000 });
  });

  test("renames, duplicates, and deletes projects from the file cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("project-lake")).toBeVisible();
    await page.getByTestId("create-kind-landing").click();
    await page.waitForURL(/\/design\//);
    await page.getByTestId("lake-toggle-button").click();
    await expect(page.getByTestId("project-lake")).toBeVisible();

    // Rename
    await page.locator('[data-testid="project-card"] [aria-label="More actions"]').first().click();
    await page.locator('.figma-more-menu [role="menuitem"]', { hasText: "Rename" }).click();
    await page.locator('[aria-label="Rename file"]').fill("Renamed regression");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="project-card"] .figma-file-name').first()).toHaveText("Renamed regression");

    // Duplicate
    await page.locator('[data-testid="project-card"] [aria-label="More actions"]').first().click();
    await page.locator('.figma-more-menu [role="menuitem"]', { hasText: "Duplicate" }).click();
    await expect(page.getByTestId("project-card")).toHaveCount(2);

    // Delete one (with confirmation); the other survives with its renamed title.
    await page.locator('[data-testid="project-card"]').nth(0).locator('[aria-label="More actions"]').click();
    await page.locator('.figma-more-menu [role="menuitem"]', { hasText: "Delete" }).click();
    await page.getByTestId("confirm-delete-project").click();
    await expect(page.getByTestId("project-card")).toHaveCount(1);
    await expect(page.locator('[data-testid="project-card"] .figma-file-name').first()).toHaveText("Renamed regression");

    // Browser back from a project returns to the lake.
    await page.locator('[data-testid="project-card"] .figma-file-thumb').first().click();
    await page.waitForURL(/\/design\//);
    await page.goBack();
    await expect(page.getByTestId("project-lake")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("shows the not-found state for unknown project routes", async ({ page }) => {
    await page.goto("/design/project-does-not-exist");
    await expect(page.getByTestId("project-not-found")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Go to home" }).click();
    await expect(page.getByTestId("project-lake")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });
});
