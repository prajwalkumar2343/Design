// Captures real WebGL renders of every registered shader into
// src/assets/shader-thumbs/<id>.webp — the shader menu shows these snapshots
// instead of mounting 31 live contexts at once.
//
// Usage: node scripts/capture-shader-thumbs.mjs [base-url] [shader-id ...]
// Defaults to the dev server at http://localhost:5173; extra args limit the
// capture to those shader ids.
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src/assets/shader-thumbs");
const base = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const only = new Set(process.argv.slice(3));
const SETTLE_MS = 1500; // let animated shaders develop a representative frame

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 384, height: 240 } });
page.on("console", (msg) => {
  if (msg.type() === "error") console.error(`  [browser] ${msg.text()}`);
});

await page.goto(`${base}/?shader-thumb=index`);
await page.waitForSelector("[data-shader-id]", { timeout: 15000 });
const allIds = await page.$$eval("[data-shader-id]", (els) => els.map((el) => el.dataset.shaderId));
const ids = only.size > 0 ? allIds.filter((id) => only.has(id)) : allIds;
console.log(`capturing ${ids.length} shader thumbnails from ${base}`);

const failed = [];
for (const id of ids) {
  try {
    await page.goto(`${base}/?shader-thumb=${id}`);
    await page.waitForSelector('[data-testid="shader-thumb-target"] canvas', { timeout: 15000 });
    await page.waitForTimeout(SETTLE_MS);
    const png = join(outDir, `${id}.png`);
    await page.locator('[data-testid="shader-thumb-target"]').screenshot({ path: png });
    execFileSync("cwebp", ["-q", "92", png, "-o", join(outDir, `${id}.webp`)], { stdio: "pipe" });
    rmSync(png);
    console.log(`  ✓ ${id}`);
  } catch (err) {
    failed.push(id);
    console.error(`  ✗ ${id}: ${err.message}`);
  }
}

await browser.close();
if (failed.length > 0) {
  console.error(`failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log("done");
