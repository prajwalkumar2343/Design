// Verifies live iframes survive a canvas-surface resize. Live DOM edits can
// only persist if the iframe's DOCUMENT survives — which requires (a) the
// element isn't removed/reparented and (b) its srcdoc attribute isn't
// rewritten. Both are observable from the parent even though the sandboxed
// document itself is opaque-origin.
import { chromium } from "@playwright/test";

const URL_BASE = "http://127.0.0.1:5299";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
await page.goto(`${URL_BASE}/?demo=1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".canvas-surface", { timeout: 30000 });
await page.waitForTimeout(2000);

await page.evaluate(async (base) => {
  for (let i = 0; i < 6; i++) {
    await fetch(`${base}/__canvas-agent/op`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "push", id: `rz-${i}`, name: `RZ${i}`,
        html: `<!doctype html><html><body><div style="padding:20px"><h1>F${i}</h1></div></body></html>`,
        x: i * 560, y: 0, width: 420, height: 320,
      }),
    });
  }
}, URL_BASE);

await page.waitForFunction(() => document.querySelectorAll("iframe.frame-document").length > 0, { timeout: 30000 });
await page.waitForFunction(() => {
  const live = document.querySelectorAll("iframe.frame-document").length;
  const ready = document.querySelectorAll('.canvas-frame[data-bridge-status="ready"] iframe.frame-document').length;
  return live > 0 && live === ready;
}, { timeout: 30000 });
await page.waitForTimeout(800);

const before = await page.evaluate(() => {
  const iframes = [...document.querySelectorAll("iframe.frame-document")];
  iframes.forEach((f, i) => { f.dataset.probeTag = `tag-${i}`; });
  window.__stats = { removed: 0, added: 0, srcdocWrites: 0 };
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "childList") {
        m.removedNodes.forEach((n) => {
          if (n.nodeType === 1 && (n.matches?.("iframe.frame-document") || n.querySelector?.("iframe.frame-document"))) window.__stats.removed++;
        });
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1 && (n.matches?.("iframe.frame-document") || n.querySelector?.("iframe.frame-document"))) window.__stats.added++;
        });
      } else if (m.type === "attributes" && m.target.matches?.("iframe.frame-document")) {
        window.__stats.srcdocWrites++;
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["srcdoc"] });
  return { iframeCount: iframes.length };
});
console.log("before resize:", before);

await page.setViewportSize({ width: 1200, height: 800 });
await page.waitForTimeout(1200);
await page.setViewportSize({ width: 1600, height: 1000 });
await page.waitForTimeout(1500);

const after = await page.evaluate(() => ({
  iframeCount: document.querySelectorAll("iframe.frame-document").length,
  taggedAlive: [...document.querySelectorAll("iframe.frame-document")].filter((f) => f.dataset.probeTag).length,
  readyCount: document.querySelectorAll('.canvas-frame[data-bridge-status="ready"] iframe.frame-document').length,
  ...window.__stats,
}));
console.log("after resizes:", after);

const ok = after.iframeCount === before.iframeCount
  && after.taggedAlive === before.iframeCount
  && after.removed === 0 && after.srcdocWrites === 0;
console.log(ok ? "PASS: iframes and their documents survived resizes" : "FAIL: iframes torn down or documents reloaded");
await browser.close();
process.exit(ok ? 0 : 1);
