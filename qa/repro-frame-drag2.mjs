import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:4187";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto(`${base}/?demo=1`);
await page.waitForSelector('[data-testid="canvas-surface"]');
await page.waitForTimeout(1200);

const info = async (id) => page.evaluate((fid) => {
  const el = document.querySelector(`[data-frame-id="${fid}"]`);
  return {
    transform: el?.style.transform,
    selected: el?.getAttribute("data-selected"),
    hasActivation: !!el?.querySelector(".frame-activation-layer"),
    interaction: document.querySelector(".canvas-surface")?.getAttribute("data-interaction"),
  };
}, id);

const dragAt = async (x, y, dx, dy) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
};

// 1) Drag UNSELECTED frame "tablet" by its body center
let box = await page.locator('[data-frame-id="tablet"]').boundingBox();
console.log("tablet before:", JSON.stringify(await info("tablet")));
await dragAt(box.x + box.width / 2, box.y + box.height / 2, 120, 60);
console.log("tablet after body-drag:", JSON.stringify(await info("tablet")));

// 2) Drag SELECTED frame body — click first to select, then drag body
await page.locator('[data-frame-drag-handle="tablet"]').click();
await page.waitForTimeout(200);
console.log("tablet selected:", JSON.stringify(await info("tablet")));
box = await page.locator('[data-frame-id="tablet"]').boundingBox();
await dragAt(box.x + box.width / 2, box.y + box.height / 2, 90, 50);
console.log("tablet after selected-body-drag:", JSON.stringify(await info("tablet")));

// 3) Drag the frame-label of "mobile"
const lbox = await page.locator('[data-frame-drag-handle="mobile"]').boundingBox();
console.log("mobile label box:", JSON.stringify(lbox), "before:", JSON.stringify(await info("mobile")));
if (lbox) {
  await dragAt(lbox.x + lbox.width / 2, lbox.y + lbox.height / 2, 80, 40);
  console.log("mobile after label-drag:", JSON.stringify(await info("mobile")));
}
await browser.close();
