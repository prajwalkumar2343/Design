#!/usr/bin/env node

import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

function parseArguments(argv) {
  const options = { url: "http://127.0.0.1:5173", frame: null, output: null };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--url", "--frame", "--output"].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    options[flag.slice(2)] = value;
    index += 1;
  }

  if (!options.output) {
    throw new Error("--output is required");
  }

  const url = new URL(options.url);
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) {
    throw new Error("--url must point to a loopback host");
  }

  return { ...options, url: url.toString() };
}

function loadChromium(projectRoot) {
  const packagePath = path.join(projectRoot, "package.json");
  const projectRequire = createRequire(packagePath);
  try {
    return projectRequire("@playwright/test").chromium;
  } catch (error) {
    throw new Error(
      `Could not load @playwright/test from ${projectRoot}. Run npm install in the Canvas project first.`,
      { cause: error },
    );
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const projectRoot = process.cwd();
  const outputPath = path.resolve(projectRoot, options.output);
  const chromium = loadChromium(projectRoot);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(options.url, { waitUntil: "networkidle", timeout: 20_000 });
    await page.getByTestId("canvas-surface").waitFor({ state: "visible", timeout: 10_000 });
    await mkdir(path.dirname(outputPath), { recursive: true });

    if (options.frame) {
      const frames = page.locator("[data-frame-id]");
      const count = await frames.count();
      let target = null;
      for (let index = 0; index < count; index += 1) {
        const candidate = frames.nth(index);
        if ((await candidate.getAttribute("data-frame-id")) === options.frame) {
          target = candidate;
          break;
        }
      }
      if (!target) {
        throw new Error(`Frame not found: ${options.frame}`);
      }
      await target.screenshot({ path: outputPath, animations: "disabled" });
    } else {
      await page.screenshot({ path: outputPath, fullPage: true, animations: "disabled" });
    }

    process.stdout.write(`${JSON.stringify({ ok: true, output: outputPath, frame: options.frame })}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`capture-canvas: ${error.message}\n`);
  process.exitCode = 1;
});
