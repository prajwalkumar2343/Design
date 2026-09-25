#!/usr/bin/env node
// Canvas perf benchmark: seeds N frames over the agent bridge, then measures
// mounted iframe count, pan/wheel FPS (rAF throughput), long-task time, and JS
// heap. Run against `npm run dev` for both a baseline and a candidate build.
//
//   node qa/perf-bench.mjs --url http://127.0.0.1:5199 --frames 300
//
// Requires a dev server (the agent bridge poller is DEV-gated) or a preview
// server opened with ?agent=1.

import { chromium } from "@playwright/test";

function parseArgs(argv) {
  const options = { url: "http://127.0.0.1:5173", frames: 300, label: "run", reuse: false, prefix: "bench" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--frames") options.frames = Number(value);
    else if (flag === "--url") options.url = value;
    else if (flag === "--label") options.label = value;
    else if (flag === "--prefix") options.prefix = value;
    else if (flag === "--reuse") options.reuse = true;
    else if (flag === "--seed-only") options.seedOnly = true;
  }
  return options;
}

const FRAME_HTML = (i) => `<!doctype html>
<html><head><style>
  body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #fff; }
  .card { margin: 16px; padding: 20px; border: 1px solid #ddd; border-radius: 12px; }
  h1 { font-size: 18px; margin: 0 0 8px; } p { font-size: 13px; color: #555; margin: 0 0 12px; }
  button { padding: 8px 14px; border-radius: 8px; border: 0; background: #17171c; color: #fff; }
  .row { display: flex; gap: 8px; margin-top: 12px; }
  .chip { padding: 4px 10px; border-radius: 999px; background: #f0f0f4; font-size: 11px; }
</style></head><body>
  <div class="card"><h1>Frame ${i}</h1><p>Benchmark card ${i} with a few nodes.</p>
  <button>Action ${i}</button><div class="row"><span class="chip">alpha</span><span class="chip">beta</span></div></div>
</body></html>`;

async function seedFrames(page, baseUrl, count, prefix = "bench") {
  // Grid layout — wide enough that zoomed-in views only see a slice.
  const cols = Math.ceil(Math.sqrt(count) * 1.6);
  const w = 420, h = 320, gap = 140;
  const t0 = Date.now();
  // The bridge inbox caps at MAX_INBOX ops — seed in waves and wait for the
  // page to apply each batch before pushing more, or ops get dropped.
  const batchSize = 150;
  let enqueued = 0;
  for (let start = 0; start < count; start += batchSize) {
    const end = Math.min(start + batchSize, count);
    const results = await Promise.all(
      Array.from({ length: end - start }, (_, k) => {
        const i = start + k;
        const op = {
          op: "push",
          id: `${prefix}-${i}`,
          name: `${prefix} ${i}`,
          html: FRAME_HTML(i),
          x: (i % cols) * (w + gap),
          y: Math.floor(i / cols) * (h + gap),
          width: w,
          height: h,
        };
        return fetch(`${baseUrl}/__canvas-agent/op`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(op),
        }).then((r) => r.json());
      }),
    );
    enqueued += results.filter((r) => r.seq).length;
    const lastSeq = results.map((r) => r.seq ?? 0).reduce((a, b) => Math.max(a, b), 0);
    if (lastSeq > 0) {
      // Long-poll until the last op of this wave reports its result.
      const deadline = Date.now() + 120000;
      for (;;) {
        const res = await fetch(`${baseUrl}/__canvas-agent/result?seq=${lastSeq}&timeout=1000`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (res && res.result) break;
        if (Date.now() > deadline) break;
      }
    }
  }
  return { enqueued, enqueueMs: Date.now() - t0 };
}

async function waitForFrames(page, expected, timeoutMs) {
  const start = Date.now();
  await page.waitForFunction(
    (n) => document.querySelectorAll(".canvas-frame").length >= n,
    expected,
    { timeout: timeoutMs },
  );
  return Date.now() - start;
}

async function sampleBench(page) {
  return page.evaluate(() => ({
    raf: window.__bench?.raf ?? 0,
    longMs: window.__bench?.longMs ?? 0,
    longN: window.__bench?.longN ?? 0,
    iframes: document.querySelectorAll("iframe.frame-document").length,
    frames: document.querySelectorAll(".canvas-frame").length,
    heap: performance.memory?.usedJSHeapSize ?? 0,
  }));
}

// Drag-pan across the surface (space+drag) while counting rAF callbacks.
async function measurePan(page, seconds = 2.5) {
  const box = await page.locator(".canvas-surface").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.keyboard.down(" ");
  const before = await sampleBench(page);
  const t0 = Date.now();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const steps = Math.ceil(seconds * 30);
  for (let i = 0; i < steps; i += 1) {
    const t = i / steps;
    await page.mouse.move(
      cx + Math.sin(t * Math.PI * 4) * box.width * 0.3,
      cy + Math.cos(t * Math.PI * 3) * box.height * 0.25,
    );
    await page.waitForTimeout(1000 / 30);
  }
  await page.mouse.up();
  await page.keyboard.up(" ");
  const elapsed = (Date.now() - t0) / 1000;
  const after = await sampleBench(page);
  return {
    seconds: elapsed,
    fps: (after.raf - before.raf) / elapsed,
    longTaskMs: after.longMs - before.longMs,
    longTasks: after.longN - before.longN,
  };
}

async function measureWheelPan(page, seconds = 2.5) {
  const box = await page.locator(".canvas-surface").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await sampleBench(page);
  const t0 = Date.now();
  const steps = Math.ceil(seconds * 20);
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(60, 40);
    await page.waitForTimeout(1000 / 20);
  }
  const elapsed = (Date.now() - t0) / 1000;
  const after = await sampleBench(page);
  return {
    seconds: elapsed,
    fps: (after.raf - before.raf) / elapsed,
    longTaskMs: after.longMs - before.longMs,
    longTasks: after.longN - before.longN,
  };
}

async function zoomTo(page, deltaY, steps = 8) {
  const box = await page.locator(".canvas-surface").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(50);
  }
  await page.keyboard.up("Control");
  await page.waitForTimeout(300);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = options.url.replace(/\/$/, "");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__bench = { raf: 0, longMs: 0, longN: 0 };
    const loop = () => { window.__bench.raf += 1; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__bench.longMs += entry.duration;
          window.__bench.longN += 1;
        }
      }).observe({ entryTypes: ["longtask"] });
    } catch {}
  });

  const navT0 = Date.now();
  await page.goto(`${baseUrl}/?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".canvas-surface", { timeout: 30000 });
  const navMs = Date.now() - navT0;

  // Frames pushed by earlier bench runs replay from the server inbox on load —
  // wait for the replay to settle so applyMs measures only this run's ops.
  await page.waitForTimeout(3000);
  const beforeSeed = await sampleBench(page);

  const seed = options.reuse
    ? { enqueued: 0, enqueueMs: 0 }
    : await seedFrames(page, baseUrl, options.frames, options.prefix);

  // Wait for every pushed frame to exist in the DOM.
  const expected = beforeSeed.frames + (options.reuse ? 0 : options.frames);
  let applyMs = -1;
  try {
    applyMs = await waitForFrames(page, expected, 120000);
  } catch {
    /* timed out — report what we have */
  }

  // Let mounts/bridges settle.
  await page.waitForTimeout(2500);
  const afterSeed = await sampleBench(page);

  // Fit-all overview: worst case — every frame on screen at once.
  const panOverview = await measurePan(page);

  // Zoomed-in pan: typical editing view, only a slice of frames visible.
  await zoomTo(page, -240, 10);
  const panZoomed = await measurePan(page);
  const wheelPan = await measureWheelPan(page);
  const afterAll = await sampleBench(page);

  const report = {
    label: options.label,
    url: baseUrl,
    framesRequested: options.frames,
    navMs,
    seedEnqueueMs: seed.enqueueMs,
    applyMs,
    iframes: afterSeed.iframes,
    domFrames: afterSeed.frames,
    heapMB: Math.round(afterAll.heap / 1048576),
    panOverview,
    panZoomed,
    wheelPan,
    iframesEnd: afterAll.iframes,
  };
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(`perf-bench: ${error.message}`);
  process.exitCode = 1;
});
