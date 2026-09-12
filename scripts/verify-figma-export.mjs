// Scratch verification: create shapes via the app's creation layer (synthetic
// pointer events reach React handlers directly), recolor via the real
// properties-panel fill path, export .fig, render in Photopea.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const APP = process.env.APP_URL ?? "http://127.0.0.1:4173";
const OUT = "/tmp/figma-verify";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => { if (msg.type() === "error") console.log("[app console]", msg.text()); });

// Synthetic pointer events have no real pointerId; React handlers call
// setPointerCapture which would throw NotFoundError.
await page.addInitScript(() => {
  Element.prototype.setPointerCapture = function () {};
  Element.prototype.releasePointerCapture = function () {};
  Element.prototype.hasPointerCapture = function () { return true; };
});

await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.getByTestId("start-brainstorming").click();
if (await page.getByTestId("blank-chooser").isVisible().catch(() => false)) {
  await page.getByTestId("blank-choose-website").click();
}
await page.waitForTimeout(800);
await page.getByTestId("add-frame-button").click();
await page.getByRole("menu", { name: "Frame presets" }).waitFor();
await page.getByTestId("frame-category-desktop").click();
await page.getByTestId("add-desktop-frame").click();
await page.waitForTimeout(2500);

const frame = page.locator("[data-frame-id]").filter({ has: page.locator("iframe") }).last();
const innerFrame = await (await frame.locator("iframe").elementHandle()).contentFrame();

async function selectShape(variant) {
  await page.getByTestId("shape-menu-button").dispatchEvent("click");
  await page.getByRole("menu", { name: "Shape tools" }).waitFor();
  await page.getByTestId(`shape-menu-${variant}`).dispatchEvent("click");
  await page.waitForTimeout(150);
}

async function dragInLayer(x0, y0, x1, y1) {
  const layer = frame.getByTestId("frame-creation-layer");
  await layer.waitFor({ state: "visible", timeout: 8000 });
  const box = await layer.boundingBox();
  const ev = (x, y) => ({
    clientX: box.x + x, clientY: box.y + y,
    button: 0, buttons: 1, isPrimary: true, pointerId: 1, pointerType: "mouse",
    bubbles: true, cancelable: true, composed: true,
  });
  await layer.dispatchEvent("pointerdown", ev(x0, y0));
  await layer.dispatchEvent("pointermove", ev((x0 + x1) / 2, (y0 + y1) / 2));
  await layer.dispatchEvent("pointermove", ev(x1, y1));
  await layer.dispatchEvent("pointerup", { ...ev(x1, y1), buttons: 0 });
  await page.waitForTimeout(700);
}

async function createdKinds() {
  return innerFrame.evaluate(() =>
    Array.from(document.querySelectorAll("[data-design-tool-created='true']"))
      .map((e) => e.getAttribute("data-design-tool-kind")));
}

const shapeDrags = [
  ["rectangle", [40, 60, 160, 140]],
  ["ellipse", [200, 60, 320, 140]],
  ["polygon", [40, 200, 160, 280]],
  ["star", [200, 200, 320, 280]],
  ["line", [380, 200, 540, 270]],
  ["arrow", [380, 300, 540, 370]],
];
let count = 0;
for (const [variant, d] of shapeDrags) {
  await selectShape(variant);
  await dragInLayer(...d);
  let kinds = await createdKinds();
  if (kinds.length <= count || kinds[kinds.length - 1] !== variant) {
    console.log(`retry ${variant}: had ${kinds.join(",")}`);
    await page.waitForTimeout(900);
    await selectShape(variant);
    await dragInLayer(...d);
    kinds = await createdKinds();
  }
  count = kinds.length;
  console.log("kinds:", kinds.join(","));
}

// text: drag a box (creates "Type to edit")
await page.getByTestId("tool-button-text").dispatchEvent("click");
await dragInLayer(40, 380, 240, 420);
let kinds = await createdKinds();
if (!kinds.includes("text")) {
  console.log("retry text");
  await page.getByTestId("tool-button-text").dispatchEvent("click");
  await dragInLayer(40, 380, 240, 420);
  kinds = await createdKinds();
}
console.log("kinds:", kinds.join(","));

// --- fills via the real properties-panel path (set-shape-fill) ---
async function selectLayer(layerName) {
  const row = page.locator(".layer-row", { hasText: layerName }).first();
  for (let i = 0; i < 3; i++) {
    await row.locator(".layer-select-button").dispatchEvent("click");
    try {
      await page.waitForFunction(
        (el) => el.classList.contains("is-selected"),
        await row.elementHandle(),
        { timeout: 3000 },
      );
      // Selection committed; give the async inspect() roundtrip time to land
      // before any style commit reads entry.inspection.
      await page.waitForTimeout(1500);
      return true;
    } catch { /* retry */ }
  }
  return false;
}
async function setFill(layerName, color) {
  if (!(await selectLayer(layerName))) {
    console.log(`select ${layerName} FAILED`);
    return;
  }
  const fillInput = page.locator('.color-field input[aria-label="Fill"]').first();
  await fillInput.click();
  await fillInput.fill(color);
  await fillInput.press("Enter");
  await page.waitForTimeout(1500);
  const applied = await innerFrame.evaluate((name) => {
    const el = Array.from(document.querySelectorAll("[data-design-tool-created='true']"))
      .find((e) => e.getAttribute("data-design-tool-kind") === name);
    return el?.getAttribute("data-design-tool-fill");
  }, layerName);
  console.log(`fill ${layerName} ->`, applied);
}
if (kinds.includes("rectangle")) await setFill("rectangle", "hsl(280 80% 50% / 0.9)");
if (kinds.includes("ellipse")) await setFill("ellipse", "rebeccapurple");
if (kinds.includes("polygon")) await setFill("polygon", "#3af");
console.log("fills applied");

// Force a fresh inspection round: re-select each edited shape so its bridge
// inspection carries the newest attributes before the exporter snapshots.
for (const name of ["rectangle", "ellipse", "polygon"]) {
  if (kinds.includes(name)) await selectLayer(name);
}
await page.waitForTimeout(1000);

// --- export ---
const downloadPromise = page.waitForEvent("download");
await page.getByTestId("export-figma-button").click();
const download = await downloadPromise;
const figPath = await download.path();
const figBytes = await import("node:fs").then((fs) => fs.readFileSync(figPath));
writeFileSync(`${OUT}/brainstorm-session.fig`, figBytes);
console.log("saved", figBytes.length, "bytes");

// --- Photopea render check ---
const photo = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await photo.goto("https://www.photopea.com", { waitUntil: "domcontentloaded" });
await photo.waitForTimeout(3000);
await photo.getByText("Start using Photopea").first().click();
await photo.waitForTimeout(6000);
await photo.locator('input[type="file"]').first().setInputFiles(`${OUT}/brainstorm-session.fig`);
await photo.waitForTimeout(10000);

const layerInfo = await photo.evaluate(() => new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ ok: false, reason: "no response" }), 8000);
  const handler = (event) => {
    clearTimeout(timer);
    window.removeEventListener("message", handler);
    resolve({ ok: true, data: String(event.data).slice(0, 4000) });
  };
  window.addEventListener("message", handler);
  window.postMessage(
    `var out=[];function w(ls,d){for(var i=0;i<ls.length;i++){var l=ls[i];out.push("  ".repeat(d)+l.name+" ["+l.kind+"]");if(l.layers)w(l.layers,d+1);}}w(app.activeDocument.layers,0);out.join("\\n")`,
    "*",
  );
}));
console.log("photopea layers:", JSON.stringify(layerInfo, null, 1));
await photo.screenshot({ path: `${OUT}/photopea.png` });
console.log("screenshot saved");
await browser.close();
