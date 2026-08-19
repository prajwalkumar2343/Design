import { expect, test } from "@playwright/test";

test.describe("Brainstorming Mode", () => {
  test("opens on a blank canvas and starts with the Brief Frame", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator('[data-testid="project-lake"], [data-testid="empty-canvas-state"]')).toBeVisible();
    await expect(page.locator("[data-frame-id]")).toHaveCount(0);
    await expect(page.locator("iframe")).toHaveCount(0);

    await page.getByTestId("start-brainstorming").first().click();

    await expect(page.getByTestId("brief-frame")).toBeVisible();
    await expect(page.getByTestId("brief-opening-prompt")).toHaveText(
      "Alright—let’s understand the project first. What are you making, who is it for, and what should it help them do?",
    );
    await expect(page.getByLabel("Project description")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
  });

  test("edits brief content, validates references, and keeps the frame movable", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("start-brainstorming").first().click();

    const description = page.getByTestId("brief-field-projectDescription");
    await description.fill("A calm planning workspace for small teams.");
    await page.getByTestId("brief-field-audience").click();
    await expect(description).toHaveValue("A calm planning workspace for small teams.");

    await page.getByLabel("New reference label").fill("Product notes");
    await page.getByLabel("New reference URL").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Add reference" }).click();
    await expect(page.getByRole("alert")).toContainText("http:// or https://");
    await expect(page.locator(".brief-reference-card")).toHaveCount(0);

    await page.getByLabel("New reference URL").fill("https://example.com/notes");
    await page.getByRole("button", { name: "Add reference" }).click();
    await expect(page.locator(".brief-reference-card")).toHaveCount(1);
    await expect(page.locator(".brief-reference-card a")).toHaveAttribute("rel", "noopener noreferrer");
    await expect(page.locator(".brief-reference-card a")).toHaveAttribute("target", "_blank");

    await page.getByLabel("New decision statement").fill("Keep the brief on canvas");
    await page.getByLabel("New decision rationale").fill("Context should stay visible");
    await page.getByRole("button", { name: "Add confirmed decision" }).click();
    await expect(page.locator(".brief-decision-card")).toHaveCount(1);

    const brief = page.getByTestId("brief-frame");
    const handle = page.getByRole("button", { name: "Move Project brief" });
    const before = await brief.getAttribute("style");
    const box = await handle.boundingBox();
    if (!box) throw new Error("Brief Frame handle has no bounding box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 35, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => brief.getAttribute("style")).not.toBe(before);
  });
});
