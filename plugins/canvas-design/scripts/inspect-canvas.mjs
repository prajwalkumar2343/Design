#!/usr/bin/env node

import { createRequire } from "node:module";
import path from "node:path";

function parseArguments(argv) {
  const options = { url: "http://127.0.0.1:5173", frame: null, selector: null };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--url", "--frame", "--selector"].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    options[flag.slice(2)] = value;
    index += 1;
  }

  if (options.selector && !options.frame) {
    throw new Error("--selector requires --frame");
  }

  const url = new URL(options.url);
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) {
    throw new Error("--url must point to a loopback host");
  }

  return { ...options, url: url.toString() };
}

function loadChromium(projectRoot) {
  const projectRequire = createRequire(path.join(projectRoot, "package.json"));
  try {
    return projectRequire("@playwright/test").chromium;
  } catch (error) {
    throw new Error(
      `Could not load @playwright/test from ${projectRoot}. Run npm install in the Canvas project first.`,
      { cause: error },
    );
  }
}

async function inspectElement(frameLocator, selector) {
  const documentFrame = frameLocator.locator("iframe").contentFrame();
  const element = documentFrame.locator(selector).first();
  await element.waitFor({ state: "attached", timeout: 5_000 });

  return element.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      tagName: node.tagName.toLowerCase(),
      text: node.textContent?.trim().slice(0, 500) ?? "",
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      styles: {
        color: style.color,
        backgroundColor: style.backgroundColor,
        display: style.display,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        margin: style.margin,
        padding: style.padding,
        position: style.position,
      },
    };
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const chromium = loadChromium(process.cwd());
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(options.url, { waitUntil: "networkidle", timeout: 20_000 });
    await page.getByTestId("canvas-surface").waitFor({ state: "visible", timeout: 10_000 });

    const frames = page.locator("[data-frame-id]");
    const summaries = await frames.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        const iframe = node.querySelector("iframe");
        return {
          id: node.getAttribute("data-frame-id"),
          name: node.getAttribute("aria-label"),
          selected: node.getAttribute("data-selected") === "true",
          live: iframe !== null,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          iframeTitle: iframe?.title ?? null,
        };
      }),
    );

    let element = null;
    if (options.frame) {
      const index = summaries.findIndex((summary) => summary.id === options.frame);
      if (index === -1) {
        throw new Error(`Frame not found: ${options.frame}`);
      }
      if (options.selector) {
        if (!summaries[index].live) {
          throw new Error(`Frame is not currently live: ${options.frame}`);
        }
        element = await inspectElement(frames.nth(index), options.selector);
      }
    }

    process.stdout.write(
      `${JSON.stringify({ ok: true, url: options.url, frames: summaries, element }, null, 2)}\n`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`inspect-canvas: ${error.message}\n`);
  process.exitCode = 1;
});
