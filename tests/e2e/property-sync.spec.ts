import { expect, test } from "@playwright/test";

test.describe("properties panel synchronization", () => {
  test("keeps live size data current and preserves prior moves on a position edit", async ({ page }) => {
    await page.goto("/?demo=1");

    const frame = page.locator('[data-frame-id="desktop"]');
    const preview = frame.locator("iframe").contentFrame();
    const heading = preview.getByRole("heading", { name: "Make room for better ideas." });
    await expect(frame).toHaveAttribute("data-bridge-status", "ready");
    await heading.hover();
    await heading.click();

    const widthField = page.getByTestId("property-node-width");
    await expect(widthField).toBeVisible();
    await expect.poll(() => widthField.inputValue()).not.toBe("");

    const resizeHandle = page.getByTestId("node-resize-handle-e");
    const resizeBox = await resizeHandle.boundingBox();
    if (!resizeBox) throw new Error("The selected node resize handle is unavailable");
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 80, resizeBox.y + resizeBox.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => widthField.inputValue()).toBe(
      await heading.evaluate((element) => element.style.width || getComputedStyle(element).width),
    );

    const currentX = Number(await page.getByTestId("property-node-x").inputValue());
    const requestedX = currentX + 80;
    await page.getByTestId("property-node-x").fill(String(requestedX));
    await page.getByTestId("property-node-x").press("Enter");

    await expect.poll(() => heading.evaluate((element) => element.getBoundingClientRect().x)).toBeCloseTo(requestedX, 0);
    await expect(page.getByTestId("property-node-width")).toHaveValue(
      await heading.evaluate((element) => element.style.width || getComputedStyle(element).width),
    );

    await page.keyboard.press("Control+z");
    await expect.poll(() => heading.evaluate((element) => element.getBoundingClientRect().x)).toBeCloseTo(currentX, 0);
  });
});
