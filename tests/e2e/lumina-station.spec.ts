import { expect, test } from "@playwright/test";

test.describe("Lumina Station desktop screen", () => {
  test("renders as a distinct 1440px screen with the local hero asset", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("sidebar-tab-pages").click();
    await page.locator(".page-row").filter({ hasText: "Lumina Station" }).locator(".page-select-button").click();

    const frame = page.locator('[data-frame-id="lumina-desktop"]');
    await expect(frame).toHaveAttribute("aria-label", "Lumina Station · Desktop · 1440 × 900");
    await expect(frame).toHaveCSS("width", "1440px");
    await expect(frame).toHaveCSS("height", "900px");

    const preview = frame.locator("iframe").contentFrame();
    await expect(frame).toHaveAttribute("data-bridge-status", "ready");
    await expect(preview.getByRole("heading", { name: "Quiet power, clearly arranged." })).toBeVisible();
    await expect(preview.getByRole("img", { name: /Lumina Station modular compute hardware/ })).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect(preview.locator("img")).toHaveJSProperty("naturalWidth", 1536);
    await expect(preview.getByRole("link", { name: "Explore the system" })).toBeVisible();
  });

  test("reveals the feature chapter on scroll without external URLs", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("sidebar-tab-pages").click();
    await page.locator(".page-row").filter({ hasText: "Lumina Station" }).locator(".page-select-button").click();
    const frame = page.locator('[data-frame-id="lumina-desktop"]');
    const iframe = frame.locator("iframe");
    const preview = iframe.contentFrame();

    await preview.locator("body").evaluate((body) => body.scrollTo({ top: 760, behavior: "auto" }));
    await expect(preview.getByRole("heading", { name: "Less ceremony between thought and output." })).toBeVisible();
    await expect(preview.getByRole("heading", { name: "Modular by nature" })).toBeVisible();

    const urls = await preview.locator("a, img, link").evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("href") ?? element.getAttribute("src") ?? ""),
    );
    expect(urls.every((url) => url.startsWith("#") || url.startsWith("data:"))).toBe(true);
  });

  test("places the generated local asset through the editor image-upload flow", async ({ page }) => {
    await page.goto("/");
    const frame = page.locator('[data-frame-id="desktop"]');
    const preview = frame.locator("iframe").contentFrame();
    await expect(frame).toHaveAttribute("data-bridge-status", "ready");

    await page.getByTestId("tool-button-image").click();
    const creationLayer = frame.getByTestId("frame-creation-layer");
    const box = await creationLayer.boundingBox();
    if (!box) throw new Error("The Fieldwork desktop creation layer is unavailable");
    await page.mouse.move(box.x + 220, box.y + 180);
    await page.mouse.down();
    await page.mouse.move(box.x + 540, box.y + 420, { steps: 3 });
    await page.mouse.up();
    await page.getByTestId("canvas-image-input").setInputFiles("src/assets/lumina-station-hero.png");

    await expect.poll(() => preview.locator('[data-design-tool-kind="image"]').count()).toBe(1);
    await expect(preview.locator('[data-design-tool-kind="image"]').first()).toHaveAttribute("alt", "lumina-station-hero");
  });
});
