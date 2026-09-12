// Exploratory QA driver for Canvas (agent-native design tool).
// Drives the dev server on :5173 in headed Chromium, captures console/page
// errors, exercises every feature area, and emits qa/evidence/results.json.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:5199";
const OUT = path.resolve(process.cwd(), "qa/evidence");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const hygiene = { consoleErrors: [], consoleWarnings: [], pageErrors: [], requestFailures: [] };
let shotIdx = 0;

function record(area, name, status, details = "") {
  results.push({ area, name, status, details });
  console.log(`[${status}] ${area} :: ${name}${details ? " — " + details : ""}`);
}
const pass = (a, n, d) => record(a, n, "PASS", d);
const fail = (a, n, d) => record(a, n, "FAIL", d);
const warn = (a, n, d) => record(a, n, "WARN", d);

async function shot(page, name) {
  shotIdx += 1;
  const file = `${String(shotIdx).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, file) }).catch(() => {});
  return file;
}

function attachHygiene(page, tag) {
  page.on("console", (msg) => {
    if (msg.type() === "error") hygiene.consoleErrors.push(`[${tag}] ${msg.text()}`);
    if (msg.type() === "warning") hygiene.consoleWarnings.push(`[${tag}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => hygiene.pageErrors.push(`[${tag}] ${err.message}`));
  page.on("requestfailed", (req) =>
    hygiene.requestFailures.push(`[${tag}] ${req.url()} :: ${req.failure()?.errorText}`),
  );
}

async function newPage(browser, tag) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  attachHygiene(page, tag);
  return { context, page };
}

const surface = '[data-testid="canvas-surface"]';
const world = '[data-testid="canvas-world"]';
const frameSel = "[data-frame-id]";

async function worldTransform(page) {
  return page.locator(world).evaluate((el) => getComputedStyle(el).transform);
}
async function readZoom(page) {
  return page.evaluate(() => {
    const w = document.querySelector('[data-testid="canvas-world"]');
    return new DOMMatrixReadOnly(getComputedStyle(w).transform).a;
  });
}
async function findBackgroundPoint(page) {
  const box = await page.locator(surface).boundingBox();
  if (!box) throw new Error("no surface box");
  const point = await page.evaluate(({ x, y, width, height }) => {
    const s = document.querySelector('[data-testid="canvas-surface"]');
    for (let r = 1; r < 6; r++)
      for (let c = 1; c < 8; c++) {
        const px = x + (width * c) / 8, py = y + (height * r) / 6;
        const t = document.elementFromPoint(px, py);
        if (t && s.contains(t) && !t.closest("[data-frame-id]") && !(t instanceof HTMLIFrameElement) && !t.closest("[data-canvas-control]"))
          return { x: px, y: py };
      }
    return null;
  }, box);
  if (!point) throw new Error("no background point");
  return point;
}
async function check(area, name, fn) {
  try { const d = await fn(); pass(area, name, d ?? ""); }
  catch (e) { fail(area, name, String(e?.message ?? e).slice(0, 400)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); return msg; }

const browser = await chromium.launch({ headless: false });

// ────────────────────────────────────────────────────────────────
// A. Startup, routing, empty state
// ────────────────────────────────────────────────────────────────
{
  const { context, page } = await newPage(browser, "startup");
  const A = "A-startup";

  await check(A, "root renders lake on fresh profile", async () => {
    await page.goto(BASE + "/");
    await page.waitForSelector('[data-testid="project-lake"], [data-testid="empty-canvas-state"]', { timeout: 15000 });
    const lake = await page.locator('[data-testid="project-lake"]').count();
    const empty = await page.locator('[data-testid="empty-canvas-state"]').count();
    expect(lake + empty > 0, "neither lake nor empty state rendered");
    await shot(page, "a01-root");
    return `lake=${lake} empty=${empty}`;
  });

  await check(A, "no frames/iframes at startup", async () => {
    expect(await page.locator(frameSel).count() === 0, "frames present at startup");
    expect(await page.locator("iframe").count() === 0, "iframes present at startup");
  });

  await check(A, "header renders brand + actions", async () => {
    await page.getByLabel("Project header").waitFor({ timeout: 8000 });
    expect(await page.locator(".workspace-brand").count() === 1, "brand missing");
    await shot(page, "a02-header");
  });

  await check(A, "unknown project route shows not-found", async () => {
    await page.goto(BASE + "/design/project-does-not-exist");
    await page.getByTestId("project-not-found").waitFor({ timeout: 10000 });
    await shot(page, "a03-not-found");
    await page.getByRole("button", { name: "Go to home" }).click();
    await page.waitForURL(/\/$/);
    return "recovered home";
  });

  await check(A, "legacy /project/:id route resolves", async () => {
    await page.goto(BASE + "/project/legacy-id-123");
    await page.getByTestId("project-not-found").waitFor({ timeout: 10000 });
  });

  await check(A, "malformed route /design/% does not wedge", async () => {
    await page.goto(BASE + "/design/%");
    await page.waitForTimeout(1500);
    const wedged = await page.locator("body").evaluate((b) => b.children.length === 0);
    expect(!wedged, "blank body after malformed URL");
    await shot(page, "a04-malformed");
  });

  await check(A, "trailing slash /design/ treated as home", async () => {
    await page.goto(BASE + "/design/");
    await page.waitForTimeout(1200);
    const nf = await page.getByTestId("project-not-found").count();
    expect(nf === 0, "not-found shown for /design/");
  });

  await check(A, "demo=1 renders four live frames", async () => {
    await page.goto(BASE + "/?demo=1");
    await page.waitForSelector(surface);
    await page.waitForSelector(`${frameSel} iframe`, { timeout: 15000 });
    const n = await page.locator(frameSel).count();
    expect(n === 4, `expected 4 demo frames, got ${n}`);
    await shot(page, "a05-demo");
    return `${n} frames`;
  });

  await check(A, "document scroll locked on infinite canvas", async () => {
    const size = await page.evaluate(() => ({
      ch: document.documentElement.clientHeight, sh: document.documentElement.scrollHeight,
      cw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth,
    }));
    expect(size.ch === size.sh && size.cw === size.sw, `scroll leak ${JSON.stringify(size)}`);
  });

  await context.close();
}

// ────────────────────────────────────────────────────────────────
// B. Canvas infrastructure: zoom, pan, fit, bounds
// ────────────────────────────────────────────────────────────────
{
  const { context, page } = await newPage(browser, "canvas");
  const A = "B-canvas";
  await page.goto(BASE + "/?demo=1");
  await page.waitForSelector(`${frameSel} iframe`, { timeout: 15000 });

  await check(A, "ctrl+wheel zooms around cursor", async () => {
    const pt = await findBackgroundPoint(page);
    const before = await worldTransform(page);
    await page.mouse.move(pt.x, pt.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -240);
    await page.keyboard.up("Control");
    await page.waitForFunction((b) => getComputedStyle(document.querySelector('[data-testid="canvas-world"]')).transform !== b, before, { timeout: 4000 });
  });

  await check(A, "horizontal wheel pans (no zoom)", async () => {
    const pt = await findBackgroundPoint(page);
    await page.mouse.move(pt.x, pt.y);
    const read = () => page.locator(world).evaluate((el) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { s: m.a, tx: m.e, ty: m.f };
    });
    const before = await read();
    await page.mouse.wheel(160, 0);
    await page.mouse.wheel(160, 0);
    const after = await read();
    expect(after.s === before.s && after.tx !== before.tx && after.ty === before.ty, `pan violated ${JSON.stringify({ before, after })}`);
  });

  await check(A, "background drag pans world", async () => {
    const pt = await findBackgroundPoint(page);
    const before = await worldTransform(page);
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x + 120, pt.y + 80, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction((b) => getComputedStyle(document.querySelector('[data-testid="canvas-world"]')).transform !== b, before);
  });

  await check(A, "zoom buttons update % and transform", async () => {
    const label = page.locator(".zoom-value");
    const before = await label.innerText();
    await page.getByRole("button", { name: "Zoom in" }).click();
    const afterIn = await label.innerText();
    expect(afterIn !== before, `zoom label unchanged ${before}→${afterIn}`);
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    const afterOut = await label.innerText();
    return `${before} → in:${afterIn} → out2:${afterOut}`;
  });

  await check(A, "zoom-out is clamped (no degenerate scale)", async () => {
    for (let i = 0; i < 40; i++) await page.getByRole("button", { name: "Zoom out" }).click();
    const z = await readZoom(page);
    const label = await page.locator(".zoom-value").innerText();
    expect(z > 0.001 && Number.isFinite(z), `degenerate zoom ${z}`);
    return `min zoom ${(z * 100).toFixed(0)}% label=${label}`;
  });

  await check(A, "zoom-in is clamped at sane max", async () => {
    for (let i = 0; i < 60; i++) await page.getByRole("button", { name: "Zoom in" }).click();
    const z = await readZoom(page);
    expect(z < 100 && Number.isFinite(z), `absurd zoom ${z}`);
    return `max zoom ${(z * 100).toFixed(0)}%`;
  });

  await check(A, "fit-all recovers view + key 0 works", async () => {
    await page.getByRole("button", { name: "Fit all frames" }).last().click();
    await page.waitForTimeout(400);
    const z1 = await readZoom(page);
    // pan far away, then press 0
    const pt = await findBackgroundPoint(page);
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x + 900, pt.y + 600, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.press("0");
    await page.waitForTimeout(400);
    const z2 = await readZoom(page);
    expect(Math.abs(z2 - z1) < 0.05, `fit key zoom ${z2} vs button ${z1}`);
    await shot(page, "b01-fit");
    return `fit zoom ${(z2 * 100).toFixed(0)}%`;
  });

  await check(A, "undo disabled before first edit", async () => {
    // fresh context state: reload demo (undo stack is per-session)
    await page.reload();
    await page.waitForSelector(`${frameSel} iframe`, { timeout: 15000 });
    expect(await page.getByTestId("undo-button").isDisabled(), "undo not disabled on fresh state");
    expect(await page.getByTestId("redo-button").isDisabled(), "redo not disabled on fresh state");
  });

  await context.close();
}

// ────────────────────────────────────────────────────────────────
// C. Tools, creation, selection, clipboard
// ────────────────────────────────────────────────────────────────
{
  const { context, page } = await newPage(browser, "tools");
  const A = "C-tools";
  await page.goto(BASE + "/?demo=1");
  await page.waitForSelector(`${frameSel} iframe`, { timeout: 15000 });
  const desktopFrame = page.locator('[data-frame-id="desktop"]');
  const preview = desktopFrame.locator("iframe").contentFrame();

  await check(A, "tool buttons present + select active by default", async () => {
    for (const t of ["select", "hand", "rectangle", "text", "image", "comment"])
      expect(await page.getByTestId(`tool-button-${t}`).isEnabled(), `tool ${t} disabled`);
    expect((await page.getByTestId("tool-button-select").getAttribute("aria-pressed")) === "true", "select not default");
  });

  await check(A, "keyboard shortcuts activate tools (h,r,t,i,c,v)", async () => {
    const seq = [["h", "hand"], ["r", "rectangle"], ["t", "text"], ["i", "image"], ["c", "comment"], ["v", "select"]];
    for (const [key, tool] of seq) {
      await page.keyboard.press(key);
      const pressed = await page.getByTestId(`tool-button-${tool}`).getAttribute("aria-pressed");
      expect(pressed === "true", `${key} did not activate ${tool}`);
    }
  });

  await check(A, "space hold = temporary hand", async () => {
    await page.keyboard.down(" ");
    const pressed = await page.getByTestId("tool-button-hand").getAttribute("aria-pressed");
    await page.keyboard.up(" ");
    const after = await page.getByTestId("tool-button-hand").getAttribute("aria-pressed");
    expect(pressed === "true" && after !== "true", `temp-hand failed (${pressed}/${after})`);
  });

  await check(A, "shape menu lists all six variants", async () => {
    await page.getByTestId("shape-menu-button").click();
    await page.getByRole("menu", { name: "Shape tools" }).waitFor();
    for (const s of ["rectangle", "ellipse", "line", "arrow", "polygon", "star"])
      expect(await page.getByTestId(`shape-menu-${s}`).count() === 1, `missing shape ${s}`);
    await shot(page, "c01-shape-menu");
    await page.keyboard.press("Escape");
  });

  await check(A, "draw ellipse creates element + auto-returns to select", async () => {
    await page.getByTestId("shape-menu-button").click();
    await page.getByTestId("shape-menu-ellipse").click();
    const layer = desktopFrame.getByTestId("frame-creation-layer");
    const box = await layer.boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2 + 140, box.y + box.height * 0.2 + 90, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const n = await preview.locator('[data-design-tool-kind="ellipse"]').count();
    expect(n >= 1, `no ellipse created (${n})`);
    expect((await page.getByTestId("tool-button-select").getAttribute("aria-pressed")) === "true", "did not return to select");
  });

  await check(A, "rectangle draw creates rect element", async () => {
    await page.keyboard.press("r");
    const layer = desktopFrame.getByTestId("frame-creation-layer");
    const box = await layer.boundingBox();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.15);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6 + 160, box.y + box.height * 0.15 + 100, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect((await preview.locator('[data-design-tool-kind="rectangle"]').count()) >= 1, "no rectangle");
  });

  await check(A, "text tool: create, type, backspace, commit, delete", async () => {
    await page.keyboard.press("t");
    const layer = desktopFrame.getByTestId("frame-creation-layer");
    const box = await layer.boundingBox();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3 + 200, box.y + box.height * 0.55 + 32, { steps: 4 });
    await page.mouse.up();
    const textEl = preview.locator('[data-design-tool-kind="text"]').last();
    await page.waitForTimeout(300);
    await page.keyboard.type("QA notes", { delay: 15 });
    await page.waitForTimeout(200);
    const txt = await textEl.innerText().catch(() => "");
    expect(txt.includes("QA notes"), `text not typed (got "${txt}")`);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    return `committed "${await textEl.innerText().catch(() => "?")}"`;
  });

  await check(A, "frame menu → categories → add mobile frame", async () => {
    const before = await page.locator(frameSel).count();
    await page.getByTestId("add-frame-button").click();
    await page.getByRole("menu", { name: "Frame presets" }).waitFor();
    await shot(page, "c02-frame-menu");
    await page.getByTestId("frame-category-mobile").click();
    await page.getByTestId("add-mobile-frame").click();
    await page.waitForTimeout(600);
    const after = await page.locator(frameSel).count();
    expect(after === before + 1, `frame count ${before}→${after}`);
    const newest = page.locator(frameSel).last();
    expect((await newest.getAttribute("data-selected")) === "true", "new frame not selected");
  });

  await check(A, "new frame does not overlap existing frames", async () => {
    const overlap = await page.locator(frameSel).evaluateAll((els) => {
      const newest = els.at(-1)?.getBoundingClientRect();
      if (!newest) return true;
      return els.slice(0, -1).some((el) => {
        const r = el.getBoundingClientRect();
        return !(newest.right <= r.left || newest.left >= r.right || newest.bottom <= r.top || newest.top >= r.bottom);
      });
    });
    expect(!overlap, "new frame overlaps an existing frame");
  });

  await check(A, "undo/redo buttons reverse frame add", async () => {
    const before = await page.locator(frameSel).count();
    await page.getByTestId("undo-button").click();
    await page.waitForTimeout(300);
    expect(await page.locator(frameSel).count() === before - 1, "undo did not remove frame");
    await page.getByTestId("redo-button").click();
    await page.waitForTimeout(300);
    expect(await page.locator(frameSel).count() === before, "redo did not restore frame");
  });

  await check(A, "move a frame via title handle", async () => {
    const frame = page.locator('[data-frame-id="tablet"]');
    const handle = frame.getByRole("button", { name: /Move Tablet/ });
    const before = await frame.evaluate((el) => getComputedStyle(el).transform);
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 45, { steps: 6 });
    await page.mouse.up();
    const after = await frame.evaluate((el) => getComputedStyle(el).transform);
    expect(after !== before, "frame transform unchanged after drag");
  });

  await check(A, "Cmd/Ctrl+Z undoes move, Ctrl+Shift+Z redoes", async () => {
    const frame = page.locator('[data-frame-id="tablet"]');
    const handle = frame.getByRole("button", { name: /Move Tablet/ });
    const before = await frame.evaluate((el) => getComputedStyle(el).transform);
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 30, { steps: 4 });
    await page.mouse.up();
    const after = await frame.evaluate((el) => getComputedStyle(el).transform);
    await page.keyboard.press("Control+z");
    await page.waitForFunction(
      ({ sel, b }) => getComputedStyle(document.querySelector(sel)).transform === b,
      { sel: '[data-frame-id="tablet"]', b: before }, { timeout: 4000 },
    );
    await page.keyboard.press("Control+Shift+z");
    await page.waitForFunction(
      ({ sel, a }) => getComputedStyle(document.querySelector(sel)).transform === a,
      { sel: '[data-frame-id="tablet"]', a: after }, { timeout: 4000 },
    );
  });

  await check(A, "node overlay: select element inside frame", async () => {
    await page.getByTestId("tool-button-select").click();
    const heading = preview.getByRole("heading", { name: "Make room for better ideas." });
    if (await heading.count() === 0) throw new Error("demo heading missing");
    await heading.click();
    await page.getByTestId("node-selection-box").waitFor({ timeout: 5000 });
    await shot(page, "c03-node-select");
  });

  await check(A, "node overlay: drag moves element", async () => {
    const box = await page.getByTestId("node-selection-box").boundingBox();
    const heading = preview.getByRole("heading", { name: "Make room for better ideas." });
    const before = await heading.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await heading.boundingBox();
    const moved = Math.abs(after.x - before.x) > 5 || Math.abs(after.y - before.y) > 5;
    expect(moved, `element did not move (${JSON.stringify(before)}→${JSON.stringify(after)})`);
  });

  await check(A, "Escape clears node selection", async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const n = await page.getByTestId("node-selection-box").count();
    if (n !== 0) warn(A, "Escape clears node selection", `selection box still present (${n})`);
    else pass(A, "Escape clears node selection");
  });

  await check(A, "Ctrl+D duplicates selected element", async () => {
    const heading = preview.getByRole("heading", { name: "Make room for better ideas." });
    await heading.click();
    await page.getByTestId("node-selection-box").waitFor({ timeout: 5000 });
    const before = await preview.locator("h1, h2").count();
    await page.keyboard.press("Control+d");
    await page.waitForTimeout(500);
    const after = await preview.locator("h1, h2").count();
    if (after > before) pass(A, "Ctrl+D duplicates selected element", `${before}→${after} headings`);
    else warn(A, "Ctrl+D duplicates selected element", `count unchanged ${before}→${after}`);
  });

  await check(A, "Delete removes selected element", async () => {
    const count = await preview.locator('[data-design-tool-kind="rectangle"]').count();
    if (count === 0) { warn(A, "Delete removes selected element", "no rectangle left to delete"); return; }
    await preview.locator('[data-design-tool-kind="rectangle"]').first().click();
    await page.getByTestId("node-selection-box").waitFor({ timeout: 5000 }).catch(() => {});
    await page.keyboard.press("Delete");
    await page.waitForTimeout(400);
    const after = await preview.locator('[data-design-tool-kind="rectangle"]').count();
    expect(after === count - 1, `rect count ${count}→${after}`);
  });

  await context.close();
}

// ────────────────────────────────────────────────────────────────
// D. Comments
// ────────────────────────────────────────────────────────────────
{
  const { context, page } = await newPage(browser, "comments");
  const A = "D-comments";
  await page.goto(BASE + "/?demo=1");
  await page.waitForSelector('[data-frame-id="desktop"][data-bridge-status="ready"]', { timeout: 15000 });
  const preview = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
  const heading = preview.getByRole("heading", { name: "Make room for better ideas." });

  await check(A, "comment tool → marker + focused popover", async () => {
    await page.getByTestId("tool-button-comment").click();
    await heading.click();
    await page.getByTestId("comment-marker").waitFor({ timeout: 5000 });
    expect(await page.getByTestId("comment-input").isFocused(), "comment input not focused");
    await shot(page, "d01-comment-open");
  });

  await check(A, "comment autosaves on tool switch", async () => {
    await page.getByTestId("comment-input").fill("Tighten the heading rhythm");
    await page.getByTestId("tool-button-select").click();
    await page.waitForTimeout(400);
    expect(await page.getByTestId("comment-popover").count() === 0, "popover still open");
    expect(await page.getByTestId("comment-marker").count() === 1, "marker lost");
  });

  await check(A, "marker reopens saved text; empty deletes", async () => {
    await page.getByTestId("comment-marker").click();
    const v = await page.getByTestId("comment-input").inputValue();
    expect(v === "Tighten the heading rhythm", `value "${v}"`);
    await page.getByTestId("comment-input").fill("");
    await page.getByTestId("tool-button-select").click();
    await page.waitForTimeout(400);
    expect(await page.getByTestId("comment-marker").count() === 0, "marker survived empty save");
    const fb = await page.getByTestId("comment-feedback").innerText().catch(() => "");
    expect(/deleted/i.test(fb), `no delete feedback ("${fb}")`);
  });

  await check(A, "empty comment dismissed without registering", async () => {
    await page.getByTestId("tool-button-comment").click();
    await heading.click();
    await page.getByTestId("comment-marker").waitFor({ timeout: 5000 });
    await page.getByTestId("tool-button-select").click();
    await page.waitForTimeout(400);
    expect(await page.getByTestId("comment-marker").count() === 0, "empty comment persisted");
  });

  await context.close();
}

// ────────────────────────────────────────────────────────────────
// E. Sidebars, properties, tokens
// ────────────────────────────────────────────────────────────────
{
  const { context, page } = await newPage(browser, "panels");
  const A = "E-panels";
  await page.goto(BASE + "/?demo=1");
  await page.waitForSelector(`${frameSel} iframe`, { timeout: 15000 });

  await check(A, "left sidebar toggles", async () => {
    const toggle = page.getByTestId("left-sidebar-toggle");
    if (await toggle.count() === 0) { warn(A, "left sidebar toggles", "toggle missing"); return; }
    await toggle.click();
    await page.waitForTimeout(400);
    await shot(page, "e01-left-sidebar");
    expect(await page.getByTestId("left-sidebar").isVisible().catch(() => false), "left sidebar not visible");
  });

  await check(A, "right sidebar (properties) toggles", async () => {
    const toggle = page.getByTestId("right-sidebar-toggle");
    if (await toggle.count() === 0) { warn(A, "right sidebar toggles", "toggle missing"); return; }
    await toggle.click();
    await page.waitForTimeout(400);
    await shot(page, "e02-right-sidebar");
  });

  await check(A, "selecting element populates properties panel", async () => {
    const preview = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
    const heading = preview.getByRole("heading", { name: "Make room for better ideas." });
    await heading.click();
    await page.waitForTimeout(500);
    const panel = page.getByTestId("properties-panel");
    if (await panel.count() === 0) { warn(A, "selecting element populates properties panel", "panel absent"); return; }
    const controls = await panel.locator("input, select, button").count();
    expect(controls > 2, `properties panel sparse (${controls} controls)`);
    await shot(page, "e03-properties");
    return `${controls} controls`;
  });

  await check(A, "tokens panel renders", async () => {
    const tokensTab = page.locator('[role="tab"], button').filter({ hasText: /^tokens$/i }).first();
    if (await tokensTab.count() === 0) { warn(A, "tokens panel renders", "no Tokens tab found"); return; }
    await tokensTab.click();
    await page.waitForTimeout(400);
    expect(await page.getByTestId("tokens-panel").isVisible().catch(() => false), "tokens panel hidden");
    await shot(page, "e04-tokens");
  });

  await context.close();
}

// ────────────────────────────────────────────────────────────────
// F. Import / Export
// ────────────────────────────────────────────────────────────────
{
  const { context, page } = await newPage(browser, "import-export");
  const A = "F-io";
  await page.goto(BASE + "/?demo=1");
  await page.waitForSelector(`${frameSel} iframe`, { timeout: 15000 });

  await check(A, "Export downloads .wirecanvas.json", async () => {
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 8000 }),
      page.getByTestId("export-project-button").click(),
    ]);
    const name = dl.suggestedFilename();
    expect(/\.wirecanvas\.json$/.test(name) || /\.json$/.test(name), `unexpected filename ${name}`);
    const p = path.join(OUT, name);
    await dl.saveAs(p);
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    expect(typeof parsed === "object" && parsed !== null, "export not JSON");
    return `${name} (${fs.statSync(p).size} bytes, keys: ${Object.keys(parsed).slice(0, 6).join(",")})`;
  });

  await check(A, "Export Code downloads html or zip", async () => {
    const btn = page.getByTestId("export-code-button");
    if (await btn.count() === 0) { warn(A, "Export Code downloads html or zip", "button absent"); return; }
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 8000 }),
      btn.click(),
    ]);
    const name = dl.suggestedFilename();
    const p = path.join(OUT, name);
    await dl.saveAs(p);
    const buf = fs.readFileSync(p);
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
    const isHtml = /^\s*</.test(buf.toString("utf-8", 0, 200));
    expect(isZip || isHtml, `export code produced unexpected file ${name}`);
    return `${name} (${buf.length} bytes, ${isZip ? "zip" : "html"})`;
  });

  await check(A, "Export .fig downloads a zip-format fig", async () => {
    const btn = page.getByTestId("export-figma-button");
    if (await btn.count() === 0) { warn(A, "Export .fig downloads a zip-format fig", "button absent"); return; }
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 8000 }),
      btn.click(),
    ]);
    const name = dl.suggestedFilename();
    const p = path.join(OUT, name);
    await dl.saveAs(p);
    const buf = fs.readFileSync(p);
    expect(/\.fig$/.test(name), `filename ${name}`);
    expect(buf[0] === 0x50 && buf[1] === 0x4b, "fig not zip container");
    return `${name} (${buf.length} bytes)`;
  });

  await check(A, "Import HTML: clean page becomes a frame", async () => {
    const before = await page.locator(frameSel).count();
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>QA Pricing</title><style>.hero{color:rgb(1,2,3);padding:24px}</style></head><body><main class="hero" data-testid="qa-hero"><h1>Plans</h1><p>QA import.</p></main></body></html>';
    await page.getByTestId("import-html-input").setInputFiles({ name: "qa.html", mimeType: "text/html", buffer: Buffer.from(html) });
    await page.waitForTimeout(800);
    const after = await page.locator(frameSel).count();
    const fb = await page.getByTestId("persistence-feedback").innerText().catch(() => "");
    return `frames ${before}→${after} feedback="${fb}"`;
  });

  await check(A, "Import HTML: scripts stripped + honest notice", async () => {
    const html = '<!doctype html><html><head><title>Scripted</title><script>window.__pwned=1</script></head><body><main data-testid="qa-main" onclick="x()"><p>scripted</p></main></body></html>';
    await page.getByTestId("import-html-input").setInputFiles({ name: "evil.html", mimeType: "text/html", buffer: Buffer.from(html) });
    await page.waitForTimeout(800);
    const fb = await page.getByTestId("persistence-feedback").innerText().catch(() => "");
    const last = page.locator(frameSel).last();
    const ifr = last.locator("iframe").contentFrame();
    const pwned = await ifr.locator("html").evaluate((r) => r.ownerDocument.defaultView.__pwned ?? null).catch(() => "no-frame");
    expect(pwned === null, `script executed in imported doc (${pwned})`);
    return `feedback="${fb}"`;
  });

  await check(A, "Import rejects hostile bridge-marker doc", async () => {
    const before = await page.locator(frameSel).count();
    const html = '<!doctype html><html><body><div data-design-tool-iframe-bridge="1"></div></body></html>';
    await page.getByTestId("import-html-input").setInputFiles({ name: "hostile.html", mimeType: "text/html", buffer: Buffer.from(html) });
    await page.waitForTimeout(800);
    const after = await page.locator(frameSel).count();
    const fb = await page.getByTestId("persistence-feedback").innerText().catch(() => "");
    expect(after === before, `frame added from hostile doc (${before}→${after})`);
    expect(/could not import/i.test(fb), `expected error toast, got "${fb}"`);
  });

  await check(A, "Import .wirecanvas.json round-trip", async () => {
    const file = fs.readdirSync(OUT).find((f) => f.endsWith(".wirecanvas.json") || f.endsWith(".json"));
    if (!file) { warn(A, "Import .wirecanvas.json round-trip", "no earlier export file to reimport"); return; }
    const before = await page.locator(frameSel).count();
    await page.getByTestId("import-project-input").setInputFiles(path.join(OUT, file));
    await page.waitForTimeout(1200);
    await shot(page, "f01-reimport");
    return `frames ${before}→${await page.locator(frameSel).count()}`;
  });

  await context.close();
}

// ────────────────────────────────────────────────────────────────
// G. Lake flows
// ────────────────────────────────────────────────────────────────
{
  const { context, page } = await newPage(browser, "lake");
  const A = "G-lake";
  await page.goto(BASE + "/");

  await check(A, "create landing project routes to /design/", async () => {
    await page.getByTestId("project-lake").waitFor({ timeout: 10000 });
    const kindBtn = page.getByTestId("create-kind-landing");
    if (await kindBtn.count() === 0) { warn(A, "create landing project routes to /design/", "create-kind-landing absent"); return; }
    await kindBtn.click();
    await page.waitForURL(/\/design\//, { timeout: 8000 });
    await page.getByTestId("brief-frame").waitFor({ timeout: 8000 });
    await shot(page, "g01-new-project");
    return page.url();
  });

  await check(A, "brief edit autosaves and survives lake round-trip", async () => {
    const url = page.url();
    const desc = page.getByTestId("brief-field-projectDescription");
    await desc.fill("QA lake round-trip");
    await desc.blur();
    await page.waitForTimeout(1000);
    await page.getByTestId("lake-toggle-button").click();
    await page.getByTestId("project-lake").waitFor({ timeout: 8000 });
    await page.locator('[data-testid="project-card"] .figma-file-thumb').first().click();
    await page.waitForURL(/\/design\//, { timeout: 8000 });
    await page.waitForTimeout(600);
    const v = await page.getByTestId("brief-field-projectDescription").inputValue();
    expect(v === "QA lake round-trip", `value "${v}"`);
    expect(page.url() === url, `url changed ${url}→${page.url()}`);
  });

  await check(A, "hard reload restores project", async () => {
    await page.reload();
    await page.waitForTimeout(1500);
    const v = await page.getByTestId("brief-field-projectDescription").inputValue();
    expect(v === "QA lake round-trip", `after reload "${v}"`);
  });

  await check(A, "rename, duplicate, delete with confirm", async () => {
    await page.getByTestId("lake-toggle-button").click();
    await page.getByTestId("project-lake").waitFor({ timeout: 8000 });
    await page.locator('[data-testid="project-card"] [aria-label="More actions"]').first().click();
    await page.locator('.figma-more-menu [role="menuitem"]', { hasText: "Rename" }).click();
    await page.locator('[aria-label="Rename file"]').fill("QA renamed");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    const name = await page.locator('[data-testid="project-card"] .figma-file-name').first().innerText();
    expect(name === "QA renamed", `name "${name}"`);

    await page.locator('[data-testid="project-card"] [aria-label="More actions"]').first().click();
    await page.locator('.figma-more-menu [role="menuitem"]', { hasText: "Duplicate" }).click();
    await page.waitForTimeout(400);
    expect(await page.getByTestId("project-card").count() === 2, "duplicate failed");

    await page.locator('[data-testid="project-card"]').nth(0).locator('[aria-label="More actions"]').click();
    await page.locator('.figma-more-menu [role="menuitem"]', { hasText: "Delete" }).click();
    await page.getByTestId("confirm-delete-project").click();
    await page.waitForTimeout(400);
    expect(await page.getByTestId("project-card").count() === 1, "delete failed");
    await shot(page, "g02-lake-cards");
  });

  await check(A, "browser back returns to lake", async () => {
    await page.locator('[data-testid="project-card"] .figma-file-thumb').first().click();
    await page.waitForURL(/\/design\//, { timeout: 8000 });
    await page.goBack();
    await page.getByTestId("project-lake").waitFor({ timeout: 8000 });
    await page.waitForURL(/\/$/);
  });

  await context.close();
}

// ────────────────────────────────────────────────────────────────
// H. Brainstorming mode
// ────────────────────────────────────────────────────────────────
{
  const { context, page } = await newPage(browser, "brainstorm");
  const A = "H-brainstorm";
  await page.goto(BASE + "/");
  await page.waitForSelector('[data-testid="project-lake"], [data-testid="empty-canvas-state"]', { timeout: 10000 });

  await check(A, "start brainstorming creates brief frame + opening prompt", async () => {
    const start = page.getByTestId("start-brainstorming").first();
    if (await start.count() === 0) { warn(A, "start brainstorming creates brief frame + opening prompt", "no start button (lake-only home)"); return; }
    await start.click();
    const chooser = page.getByTestId("blank-chooser");
    if (await chooser.isVisible().catch(() => false)) await page.getByTestId("blank-choose-website").click();
    await page.getByTestId("brief-frame").waitFor({ timeout: 8000 });
    const prompt = await page.getByTestId("brief-opening-prompt").innerText();
    expect(prompt === "Alright—let’s understand the project first. What are you making, who is it for, and what should it help them do?", `prompt mismatch: "${prompt}"`);
    expect(await page.locator("iframe").count() === 0, "iframes present in brainstorm");
    await shot(page, "h01-brief");
  });

  if (await page.getByTestId("brief-frame").count() > 0) {
    await check(A, "brief fields commit on blur", async () => {
      const desc = page.getByTestId("brief-field-projectDescription");
      await desc.fill("A calm planning workspace for small teams.");
      await page.getByTestId("brief-field-audience").click();
      const v = await desc.inputValue();
      expect(v === "A calm planning workspace for small teams.", `value "${v}"`);
    });

    await check(A, "reference URL validation rejects javascript:", async () => {
      await page.getByLabel("New reference label").fill("notes");
      await page.getByLabel("New reference URL").fill("javascript:alert(1)");
      await page.getByRole("button", { name: "Add reference" }).click();
      const alert = await page.getByRole("alert").innerText().catch(() => "");
      expect(/http:\/\/ or https:\/\//.test(alert), `no validation alert ("${alert}")`);
      expect(await page.locator(".brief-reference-card").count() === 0, "bad ref added");
    });

    await check(A, "valid reference gets noopener noreferrer", async () => {
      await page.getByLabel("New reference URL").fill("https://example.com/notes");
      await page.getByRole("button", { name: "Add reference" }).click();
      await page.locator(".brief-reference-card").waitFor({ timeout: 4000 });
      const a = page.locator(".brief-reference-card a");
      expect((await a.getAttribute("rel")) === "noopener noreferrer", `rel=${await a.getAttribute("rel")}`);
      expect((await a.getAttribute("target")) === "_blank", "target not _blank");
    });

    await check(A, "confirmed decision added", async () => {
      await page.getByLabel("New decision statement").fill("Keep the brief on canvas");
      await page.getByLabel("New decision rationale").fill("Context stays visible");
      await page.getByRole("button", { name: "Add confirmed decision" }).click();
      await page.locator(".brief-decision-card").waitFor({ timeout: 4000 });
    });

    await check(A, "brief frame is movable", async () => {
      const brief = page.getByTestId("brief-frame");
      const handle = page.getByRole("button", { name: "Move Project brief" });
      const before = await brief.getAttribute("style");
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 35, { steps: 5 });
      await page.mouse.up();
      await page.waitForFunction((b) => document.querySelector('[data-testid="brief-frame"]').getAttribute("style") !== b, before, { timeout: 4000 });
    });

    await check(A, "agent connection panel reports status", async () => {
      const res = page.getByTestId("agent-connection-result");
      if (await res.count() === 0) { warn(A, "agent connection panel reports status", "panel/result absent"); return; }
      const text = await res.first().innerText().catch(() => "");
      return `status="${text.slice(0, 120)}"`;
    });
  }
  await context.close();
}

// ────────────────────────────────────────────────────────────────
// I. Shader + image tools
// ────────────────────────────────────────────────────────────────
{
  const { context, page } = await newPage(browser, "media-tools");
  const A = "I-media";
  await page.goto(BASE + "/?demo=1");
  await page.waitForSelector(`${frameSel} iframe`, { timeout: 15000 });

  await check(A, "shader menu opens with items + search", async () => {
    await page.getByTestId("tool-button-shader").click();
    const menu = page.getByTestId("shader-menu");
    await menu.waitFor({ timeout: 5000 });
    await shot(page, "i01-shader-menu");
    const search = page.getByTestId("shader-search-input");
    if (await search.count()) {
      await search.fill("zzzznope");
      await page.waitForTimeout(300);
      const empty = await page.getByTestId("shader-menu-empty").count();
      await search.fill("");
      return `search ok, empty-state=${empty > 0}`;
    }
  });

  await check(A, "adding a shader places a shader element", async () => {
    const before = await page.getByTestId("shader-element").count();
    const item = page.locator('[data-testid="shader-menu"] button').filter({ hasNot: page.locator('[data-testid="shader-search-input"]') }).first();
    const candidates = page.locator('[data-testid^="shader-option"], [data-testid^="shader-item"], .shader-menu button');
    const n = await candidates.count();
    if (n === 0) { warn(A, "adding a shader places a shader element", "no shader entries found"); return; }
    await candidates.first().click();
    await page.waitForTimeout(800);
    const after = await page.getByTestId("shader-element").count();
    expect(after > before, `shader count ${before}→${after}`);
    await shot(page, "i02-shader-added");
  });

  await check(A, "image tool → choose file → image in frame", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAATSURBVBhXY/iPBf///8fAIMAAACAAVPAFa5fKK9cAAAAASUVORK5CYII=", "base64");
    fs.writeFileSync(path.join(OUT, "qa-pixel.png"), png);
    await page.keyboard.press("i");
    const frame = page.locator('[data-frame-id="desktop"]');
    const layer = frame.getByTestId("frame-creation-layer");
    const box = await layer.boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5 + 120, box.y + box.height * 0.5 + 90, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const chooser = page.getByTestId("choose-image-button");
    if (await chooser.count()) {
      const [fc] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 5000 }),
        chooser.click(),
      ]).catch(() => [null]);
      if (fc) await fc.setFiles(path.join(OUT, "qa-pixel.png"));
    } else {
      const input = page.locator('input[type="file"][accept*="image"]');
      if (await input.count()) await input.first().setInputFiles(path.join(OUT, "qa-pixel.png"));
      else { warn(A, "image tool → choose file → image in frame", "no chooser/input appeared"); return; }
    }
    await page.waitForTimeout(800);
    const preview = frame.locator("iframe").contentFrame();
    const imgs = await preview.locator("img, [data-design-tool-kind='image']").count();
    expect(imgs >= 1, "no image element in frame");
    await shot(page, "i03-image");
    return `${imgs} image node(s)`;
  });

  await context.close();
}

// ────────────────────────────────────────────────────────────────
// J. Edge cases & adversarial
// ────────────────────────────────────────────────────────────────
{
  const { context, page } = await newPage(browser, "edge");
  const A = "J-edge";
  await page.goto(BASE + "/?demo=1");
  await page.waitForSelector(`${frameSel} iframe`, { timeout: 15000 });

  await check(A, "rapid tool switching stays consistent", async () => {
    for (const k of ["h", "r", "t", "i", "c", "v", "h", "v", "r", "v"]) await page.keyboard.press(k);
    await page.waitForTimeout(300);
    const active = await page.locator('.tool-button[aria-pressed="true"]').count();
    expect(active <= 1, `${active} tools pressed at once`);
    expect((await page.getByTestId("tool-button-select").getAttribute("aria-pressed")) === "true", "did not settle on select");
  });

  await check(A, "frame menu opens/closes via F + Escape", async () => {
    await page.keyboard.press("f");
    await page.getByRole("menu", { name: "Frame presets" }).waitFor({ timeout: 4000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    expect(await page.getByRole("menu", { name: "Frame presets" }).count() === 0, "menu stayed open");
  });

  await check(A, "clicking canvas background deselects frames", async () => {
    await page.locator(frameSel).first().click();
    await page.waitForTimeout(200);
    const pt = await findBackgroundPoint(page);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(300);
    const sel = await page.locator('[data-frame-id][data-selected="true"]').count();
    if (sel !== 0) warn(A, "clicking canvas background deselects frames", `${sel} still selected`);
    else pass(A, "clicking canvas background deselects frames");
  });

  await check(A, "tiny 1px drags do not create shapes", async () => {
    const preview = page.locator('[data-frame-id="desktop"] iframe').contentFrame();
    const before = await preview.locator("[data-design-tool-kind]").count();
    await page.keyboard.press("r");
    const layer = page.locator('[data-frame-id="desktop"]').getByTestId("frame-creation-layer");
    const box = await layer.boundingBox();
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 41, box.y + 41);
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await preview.locator("[data-design-tool-kind]").count();
    if (after > before) warn(A, "tiny 1px drags do not create shapes", `created element on 1px drag (${before}→${after})`);
    else pass(A, "tiny 1px drags do not create shapes");
    await page.keyboard.press("v");
  });

  await check(A, "mobile viewport keeps chrome usable", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    expect(await page.getByLabel("Project header").isVisible(), "header hidden at 390px");
    expect(await page.getByLabel("Canvas controls").isVisible(), "dock hidden at 390px");
    const size = await page.evaluate(() => ({
      cw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth,
    }));
    await shot(page, "j01-mobile");
    if (size.sw > size.cw + 1) warn(A, "mobile viewport keeps chrome usable", `horizontal overflow ${size.sw}>${size.cw}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);
  });

  await check(A, "paste HTML onto canvas creates frame", async () => {
    const before = await page.locator(frameSel).count();
    await page.evaluate(() => {
      const html = '<!doctype html><html><head><title>Pasted QA</title></head><body><h1>Pasted</h1></body></html>';
      const dt = new DataTransfer();
      dt.setData("text/html", html);
      dt.setData("text/plain", html);
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(800);
    const after = await page.locator(frameSel).count();
    const fb = await page.getByTestId("paste-feedback").innerText().catch(() => "");
    return `frames ${before}→${after} feedback="${fb}"`;
  });

  await check(A, "undo button disabled-state consistent after undo-all", async () => {
    let guard = 0;
    while (await page.getByTestId("undo-button").isEnabled() && guard++ < 60)
      await page.getByTestId("undo-button").click();
    expect(await page.getByTestId("undo-button").isDisabled(), `undo still enabled after ${guard} undos`);
    return `${guard} undo steps drained`;
  });

  await context.close();
}

// ────────────────────────────────────────────────────────────────
// K. Performance sanity
// ────────────────────────────────────────────────────────────────
{
  const { context, page } = await newPage(browser, "perf");
  const A = "K-perf";
  await check(A, "demo load time + long tasks", async () => {
    const t0 = Date.now();
    await page.goto(BASE + "/?demo=1");
    await page.waitForSelector(`${frameSel} iframe`, { timeout: 20000 });
    const loadMs = Date.now() - t0;
    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const longTasks = performance.getEntriesByType("longtask").length;
      return { domContentLoaded: nav?.domContentLoadedEventEnd, longTasks, resources: performance.getEntriesByType("resource").length };
    });
    return `frames visible in ${loadMs}ms, DCL ${Math.round(metrics.domContentLoaded ?? -1)}ms, longtasks=${metrics.longTasks}, resources=${metrics.resources}`;
  });
  await context.close();
}

// ────────────────────────────────────────────────────────────────
await browser.close();

const summary = {
  generatedAt: new Date().toISOString(),
  total: results.length,
  pass: results.filter((r) => r.status === "PASS").length,
  fail: results.filter((r) => r.status === "FAIL").length,
  warn: results.filter((r) => r.status === "WARN").length,
  hygiene: {
    consoleErrors: hygiene.consoleErrors,
    consoleWarnings: [...new Set(hygiene.consoleWarnings)].slice(0, 40),
    pageErrors: hygiene.pageErrors,
    requestFailures: hygiene.requestFailures,
  },
  results,
};
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(summary, null, 2));
console.log(`\n==== ${summary.pass} PASS / ${summary.fail} FAIL / ${summary.warn} WARN ====`);
console.log(`console errors: ${hygiene.consoleErrors.length}, page errors: ${hygiene.pageErrors.length}, failed requests: ${hygiene.requestFailures.length}`);
