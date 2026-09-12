// Focused verification probes for suspected issues.
import { chromium } from "@playwright/test";

const BASE = "http://localhost:5199";
const browser = await chromium.launch({ headless: false });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("console", (m) => m.type() === "error" && console.log("  [console.error]", m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 200)));

await page.goto(BASE + "/?demo=1");
await page.waitForSelector('[data-frame-id="desktop"] iframe', { timeout: 15000 });

// ── Probe 1: frame move handle ──
console.log("P1: frame move handle drag");
{
  const frame = page.locator('[data-frame-id="tablet"]');
  const handle = frame.getByRole("button", { name: /Move Tablet/ });
  console.log("  handle count:", await handle.count());
  const box = await handle.boundingBox();
  console.log("  handle box:", JSON.stringify(box));
  const before = await frame.evaluate((el) => getComputedStyle(el).transform);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 45, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const after = await frame.evaluate((el) => getComputedStyle(el).transform);
  console.log("  transform before:", before, "\n  after:", after, "\n  moved:", before !== after);
  // where does a mousedown land? check elementFromPoint at handle center
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? `${el.tagName}.${el.className?.toString().slice(0, 60)} role=${el.getAttribute("role")} aria=${el.getAttribute("aria-label")}` : "none";
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  console.log("  elementFromPoint at handle center:", hit);
}

// ── Probe 2: click heading inside iframe ──
console.log("P2: click heading inside desktop iframe");
{
  const preview = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
  const heading = preview.getByRole("heading", { name: "Make room for better ideas." });
  try {
    await heading.click({ timeout: 5000 });
    console.log("  click ok; selection box:", await page.getByTestId("node-selection-box").count());
  } catch (e) {
    console.log("  click FAILED:", String(e.message).split("\n").slice(0, 8).join(" | "));
    // what intercepts?
    const info = await page.evaluate(() => {
      const frame = document.querySelector('[data-frame-id="desktop"] iframe');
      const fr = frame.getBoundingClientRect();
      const inner = frame.contentDocument.querySelector("h1, h2");
      if (!inner) return "no h1 in iframe";
      const r = inner.getBoundingClientRect();
      const cx = fr.x + r.x + r.width / 2, cy = fr.y + r.y + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      return { iframeRect: fr, innerRect: r, point: [cx, cy], top: top ? `${top.tagName}.${String(top.className).slice(0, 80)}` : "null" };
    });
    console.log("  intercept info:", JSON.stringify(info));
  }
}

// ── Probe 3: Export button ──
console.log("P3: export button");
{
  const btn = page.getByTestId("export-project-button");
  console.log("  export btn count:", await btn.count(), "visible:", await btn.isVisible().catch(() => false));
  const dl = page.waitForEvent("download", { timeout: 4000 }).catch(() => null);
  await btn.click();
  const d = await dl;
  console.log("  download:", d ? d.suggestedFilename() : "NONE");
  const fb = await page.getByTestId("persistence-feedback").innerText().catch(() => "(none)");
  console.log("  feedback:", fb);
}

// ── Probe 4: export code / figma buttons presence ──
console.log("P4: header buttons in demo mode");
for (const id of ["export-code-button", "export-figma-button", "import-html-button", "import-project-button", "lake-toggle-button"])
  console.log(`  ${id}: count=${await page.getByTestId(id).count()}`);

// ── Probe 5: shape menu reopen ──
console.log("P5: shape menu re-open after Escape");
{
  await page.getByTestId("shape-menu-button").click();
  const menu1 = await page.getByRole("menu", { name: "Shape tools" }).count();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.getByTestId("shape-menu-button").click();
  await page.waitForTimeout(400);
  const menu2 = await page.getByRole("menu", { name: "Shape tools" }).count();
  const ellipse = await page.getByTestId("shape-menu-ellipse").count();
  console.log("  menu open first:", menu1, "after esc+reopen:", menu2, "ellipse items:", ellipse);
}

// ── Probe 6: shader menu real entries ──
console.log("P6: shader menu contents");
{
  await page.getByTestId("tool-button-shader").click();
  await page.waitForTimeout(500);
  const menu = page.getByTestId("shader-menu");
  const items = await menu.locator("button").evaluateAll((bs) =>
    bs.map((b) => ({ testid: b.getAttribute("data-testid"), text: b.innerText.slice(0, 40), cls: String(b.className).slice(0, 40) })),
  );
  console.log("  buttons:", JSON.stringify(items, null, 1).slice(0, 2000));
}

await browser.close();
