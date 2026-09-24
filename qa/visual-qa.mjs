// Visual QA sweep — screenshots every surface + clicks every button, looking
// for dead controls and visual glitches. Run: node qa/visual-qa.mjs
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE ?? "http://localhost:5173";
const OUT = path.resolve(process.cwd(), "qa/evidence-visual");
fs.mkdirSync(OUT, { recursive: true });

const findings = [];
const note = (area, sev, text) => { findings.push({ area, sev, text }); console.log(`[${sev}] ${area}: ${text}`); };
let idx = 0;
async function shot(page, name) {
  idx += 1;
  const file = `${String(idx).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, file) }).catch(() => {});
  return file;
}

const hygiene = { errors: [], warnings: [], pageErrors: [], failedReqs: [] };
function attach(page, tag) {
  page.on("console", (m) => {
    if (m.type() === "error") hygiene.errors.push(`[${tag}] ${m.text()}`);
    if (m.type() === "warning") hygiene.warnings.push(`[${tag}] ${m.text()}`);
  });
  page.on("pageerror", (e) => hygiene.pageErrors.push(`[${tag}] ${e.message}`));
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (u.includes("posthog") || u.includes("us.i.posthog")) return; // analytics offline in QA
    hygiene.failedReqs.push(`[${tag}] ${u} :: ${r.failure()?.errorText}`);
  });
}

// Signature of "something happened" after a click: DOM mutation, toast, dialog,
// menu, navigation, focus change, aria state flip, or network request.
async function clickAndWatch(page, locator, name, { settle = 500 } = {}) {
  const before = await page.evaluate(() => ({
    url: location.href,
    dialogs: document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"],[role="alert"],[data-testid*="toast"],.toast').length,
    active: document.activeElement?.tagName + "." + (document.activeElement?.getAttribute("data-testid") ?? ""),
    pressed: document.querySelectorAll('[aria-pressed="true"]').length,
    expanded: document.querySelectorAll('[aria-expanded="true"]').length,
  }));
  const box = await locator.boundingBox().catch(() => null);
  if (!box) { note("dead-click", "FAIL", `${name}: not visible / no box`); return; }
  let mutated = false;
  const obs = page.evaluate(() => new Promise((res) => {
    const o = new MutationObserver((m) => { if (m.length > 0) { res(true); o.disconnect(); } });
    o.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    setTimeout(() => { o.disconnect(); res(false); }, 900);
  }));
  await locator.click({ timeout: 4000 }).catch((e) => note("dead-click", "FAIL", `${name}: click threw ${String(e).slice(0, 120)}`));
  mutated = await obs;
  await page.waitForTimeout(settle);
  const after = await page.evaluate(() => ({
    url: location.href,
    dialogs: document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"],[role="alert"],[data-testid*="toast"],.toast').length,
    active: document.activeElement?.tagName + "." + (document.activeElement?.getAttribute("data-testid") ?? ""),
    pressed: document.querySelectorAll('[aria-pressed="true"]').length,
    expanded: document.querySelectorAll('[aria-expanded="true"]').length,
  }));
  const changed = mutated
    || after.url !== before.url
    || after.dialogs !== before.dialogs
    || after.active !== before.active
    || after.pressed !== before.pressed
    || after.expanded !== before.expanded;
  return { changed, before, after };
}

const browser = await chromium.launch({ headless: true });

// ═══════════════════════════════ LAKE ═══════════════════════════════
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  attach(page, "lake");
  await page.goto(BASE + "/");
  await page.waitForSelector('[data-testid="project-lake"], [data-testid="empty-canvas-state"], .project-lake, main', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await shot(page, "lake-01-landing");

  // Inventory every button-ish control on the lake.
  const controls = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, [role="button"], input[type="checkbox"], select, [role="tab"], a[href]')];
    return els.filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    }).map((el, i) => ({
      i,
      tag: el.tagName,
      testid: el.getAttribute("data-testid") ?? "",
      label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 60),
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      cls: (el.className ?? "").toString().slice(0, 60),
    }));
  });
  console.log(`LAKE controls: ${controls.length}`);
  for (const c of controls) console.log(`  ${c.disabled ? "⛔" : "  "} [${c.tag}] ${c.testid || c.cls} "${c.label}"`);
  fs.writeFileSync(path.join(OUT, "lake-controls.json"), JSON.stringify(controls, null, 2));

  // Click each enabled control, watch for response, then restore state.
  for (const c of controls) {
    if (c.disabled) continue;
    const sel = c.testid ? `[data-testid="${c.testid}"]` : null;
    if (!sel) continue;
    const loc = page.locator(sel).first();
    if (!(await loc.count())) continue;
    // skip destructive confirm chains for now — exercised separately
    const r = await clickAndWatch(page, loc, `lake:${c.testid}`);
    if (r && !r.changed) note("lake", "FAIL", `inactive button: ${c.testid} "${c.label}" — click produced no observable change`);
    await shot(page, `lake-click-${c.testid}`);
    // Restore: dismiss any menu/dialog that opened
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }

  // Specific flows
  await page.goto(BASE + "/");
  await page.waitForTimeout(800);
  await shot(page, "lake-02-after-sweep");
  await ctx.close();
}

// ═══════════════════════════════ CANVAS (demo) ═══════════════════════════════
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  attach(page, "canvas");
  await page.goto(BASE + "/?demo=1");
  await page.waitForSelector("[data-frame-id] iframe", { timeout: 20000 });
  await page.waitForTimeout(1500);
  await shot(page, "canvas-01-landing");

  const controls = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, [role="button"], [role="tab"]')];
    return els.filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    }).map((el) => ({
      testid: el.getAttribute("data-testid") ?? "",
      label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 60),
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      cls: (el.className ?? "").toString().slice(0, 60),
    }));
  });
  console.log(`CANVAS controls: ${controls.length}`);
  for (const c of controls) console.log(`  ${c.disabled ? "⛔" : "  "} ${c.testid || c.cls} "${c.label}"`);
  fs.writeFileSync(path.join(OUT, "canvas-controls.json"), JSON.stringify(controls, null, 2));

  for (const c of controls) {
    if (c.disabled || !c.testid) continue;
    if (/^tool-button-(hand|rectangle|text|image|comment|frame|shader)$/.test(c.testid)) {
      // tool arms — verify aria-pressed flips
      const loc = page.getByTestId(c.testid).first();
      await loc.click();
      await page.waitForTimeout(250);
      const pressed = await loc.getAttribute("aria-pressed");
      if (pressed !== "true") note("canvas", "FAIL", `tool ${c.testid} did not arm (aria-pressed=${pressed})`);
      await page.getByTestId("tool-button-select").click();
      await page.waitForTimeout(150);
      continue;
    }
    const loc = page.getByTestId(c.testid).first();
    if (!(await loc.count())) continue;
    const r = await clickAndWatch(page, loc, `canvas:${c.testid}`);
    if (r && !r.changed) note("canvas", "FAIL", `inactive button: ${c.testid} "${c.label}"`);
    await shot(page, `canvas-click-${c.testid}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    // make sure select tool is active again
    const sel = await page.getByTestId("tool-button-select").getAttribute("aria-pressed").catch(() => null);
    if (sel !== "true") { await page.getByTestId("tool-button-select").click().catch(() => {}); }
  }
  await shot(page, "canvas-02-after-sweep");
  await ctx.close();
}

fs.writeFileSync(path.join(OUT, "findings.json"), JSON.stringify({
  _meta: {
    generatedBy: "qa/visual-qa.mjs",
    coverage: "Results from the visual-qa.mjs lake and canvas sweep only (screenshots 01-32, lake-controls.json, canvas-controls.json). The other drivers in qa/ print diagnostics to stdout and save screenshots but write nothing here. See qa/evidence-visual/README.md.",
  },
  findings,
  hygiene,
}, null, 2));
console.log("\n═══ FINDINGS ═══");
for (const f of findings) console.log(`[${f.sev}] ${f.area}: ${f.text}`);
console.log("\n═══ HYGIENE ═══");
console.log("console errors:", hygiene.errors.length, hygiene.errors.slice(0, 10));
console.log("page errors:", hygiene.pageErrors.length, hygiene.pageErrors.slice(0, 10));
console.log("failed requests:", hygiene.failedReqs.length, hygiene.failedReqs.slice(0, 10));
await browser.close();
