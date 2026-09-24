/**
 * react-export-verify.mjs — end-to-end proof for the React export feature.
 *
 *   1. Drives the real app: starts a brainstorm session, imports the repo's
 *      fieldwork demo document plus a compact inline fixture, clicks
 *      export-react-button, saves the downloaded zip.
 *   2. Unzips the export, runs `npm install` + `npm run build`, and serves the
 *      built app with `vite preview`.
 *   3. Renders each source srcDoc from a file:// page and the exported React
 *      app via its hash routes, saves side-by-side screenshots, and asserts
 *      computed-style equality on representative selectors.
 *
 * Usage: APP_URL=http://127.0.0.1:5199 node qa/react-export-verify.mjs
 * Requires `npm run dev` running on APP_URL and Playwright installed.
 */
import { execFileSync, execSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:5199";
const OUT = path.resolve("tmp/react-export-evidence");
const WORK = path.join(tmpdir(), `react-export-verify-${Date.now()}`);

let failures = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  failures += 1;
}

function unzip(zipPath, dest) {
  // The export is a STORE zip (no compression): parse local headers.
  const buf = readFileSync(zipPath);
  const files = new Map();
  let offset = 0;
  while (offset < buf.length - 4) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const dataLen = buf.readUInt32LE(offset + 18);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString();
    const dataStart = offset + 30 + nameLen + extraLen;
    files.set(name, buf.subarray(dataStart, dataStart + dataLen));
    offset = dataStart + dataLen;
  }
  if (files.size === 0) throw new Error("No local file headers found in zip");
  mkdirSync(dest, { recursive: true });
  for (const [name, data] of files) {
    const target = path.join(dest, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  return [...files.keys()];
}

async function exportZip(page) {
  await page.goto(`${APP_URL}/`);
  const startButton = page.getByTestId("start-brainstorming");
  try {
    await startButton.waitFor({ timeout: 15000 });
  } catch {
    // A stale dep-optimize pass can 504 the module graph and leave a blank
    // page; one reload lands on the rebuilt graph.
    await page.reload();
    await startButton.waitFor({ timeout: 30000 });
  }
  await startButton.click();
  if (await page.getByTestId("blank-chooser").isVisible().catch(() => false)) {
    await page.getByTestId("blank-choose-website").click();
  }
  await page.getByTestId("brief-field-projectDescription").fill("Verify react export");
  await page.getByTestId("brief-field-audience").click();

  // Pull the real demo document through the dev server's module transform.
  // The second doc is a compact inline fixture: lumina-station exceeds the
  // app's 2 MB import ceiling, and a doc we author gives the style probes
  // literal expected values.
  const fieldwork = await page.evaluate(async () => {
    const mod = await import("/src/demo/documents.ts");
    return mod.demoDocument;
  });
  const docs = [
    { name: "fieldwork.html", src: fieldwork },
    { name: "meridian.html", src: MERIDIAN_DOC },
  ];

  for (const doc of docs) {
    await page.getByTestId("import-html-input").setInputFiles({
      name: doc.name,
      mimeType: "text/html",
      buffer: Buffer.from(doc.src, "utf-8"),
    });
    await page.waitForTimeout(500);
    const toasts = await page.locator(".persistence-feedback, [role='status']").allInnerTexts().catch(() => []);
    const latest = toasts.filter((t) => /import/i.test(t)).at(-1) ?? "";
    if (!latest.includes("Imported")) {
      throw new Error(`import of ${doc.name} did not land; latest toast: "${latest}"`);
    }
  }

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-react-button").click();
  const download = await downloadPromise;
  const zipPath = path.join(WORK, download.suggestedFilename());
  await download.saveAs(zipPath);
  console.log(`downloaded ${download.suggestedFilename()}`);
  return { zipPath, docs };
}

// Compact second page: distinctive literal styles so the probes compare
// raw-srcDoc vs exported React render on values we fully control.
const MERIDIAN_DOC = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Meridian</title>
<style>
  body { margin: 0; background: #101820; color: #f2efe9; font-family: Georgia, serif; }
  .brand { color: #ff7a1a; font-family: "Courier New", monospace; letter-spacing: 0.2em; }
  .hero-lede { color: #9fb7c9; font-size: 22px; }
</style>
</head>
<body>
  <header class="brand">MERIDIAN</header>
  <p class="hero-lede">A compact second page.</p>
</body>
</html>`;

// {doc, selector, props} — doc indexes docs[] in import order (== export
// order); the slug is resolved from the generated App.tsx at runtime.
const STYLE_PROBES = [
  { doc: 0, selector: "h1", props: ["color", "fontSize", "fontFamily"] },
  { doc: 0, selector: ".eyebrow", props: ["color", "textTransform", "letterSpacing"] },
  { doc: 0, selector: ".page", props: ["backgroundColor"] },
  { doc: 1, selector: ".brand", props: ["color", "fontFamily", "letterSpacing"] },
  { doc: 1, selector: ".hero-lede", props: ["color", "fontSize"] },
];

async function computedStyles(page, selector, props) {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return null;
  return el.evaluate(
    (node, keys) => Object.fromEntries(keys.map((k) => [k, getComputedStyle(node)[k]])),
    props,
  );
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(WORK, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const { zipPath, docs } = await exportZip(page);
  const projectDir = path.join(WORK, "project");
  const entries = unzip(zipPath, projectDir);
  console.log(`unzipped ${entries.length} files`);
  writeFileSync(path.join(OUT, "file-list.txt"), `${entries.join("\n")}\n`);

  const appTsx = readFileSync(path.join(projectDir, "src/App.tsx"), "utf-8");
  const slugs = [...appTsx.matchAll(/slug: "([^"]+)"/g)].map((m) => m[1]);
  if (slugs.length === 0) {
    // Single-page export renders directly; no hash routes exist.
    slugs.push("");
  }
  const slugByDoc = docs.map((_, i) => slugs[i] ?? "");

  console.log("npm install …");
  execSync("npm install --no-audit --no-fund", { cwd: projectDir, stdio: "inherit" });
  console.log("npm run build …");
  execSync("npm run build", { cwd: projectDir, stdio: "inherit" });

  const port = 4599;
  const preview = spawn(
    "npx", ["vite", "preview", "--port", String(port), "--host", "127.0.0.1", "--strictPort"],
    { cwd: projectDir, stdio: "pipe" },
  );
  await new Promise((resolve) => setTimeout(resolve, 3000));

  try {
    for (const [i, slug] of slugs.entries()) {
      const rawFile = path.join(WORK, `source-${i}.html`);
      writeFileSync(rawFile, docs[i].src);

      const rawPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await rawPage.goto(`file://${rawFile}`);
      await rawPage.waitForTimeout(700);
      await rawPage.screenshot({ path: path.join(OUT, `source-${slug || i}.png`) });
      await rawPage.close();

      const reactPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await reactPage.goto(`http://127.0.0.1:${port}/${slug ? `#/${slug}` : ""}`);
      await reactPage.waitForTimeout(900);
      await reactPage.screenshot({ path: path.join(OUT, `react-${slug || i}.png`) });
      await reactPage.close();
    }

    for (const probe of STYLE_PROBES) {
      const slug = slugByDoc[probe.doc];
      const src = docs[probe.doc]?.src;
      const label = slug || `doc-${probe.doc}`;
      if (!src || slug === undefined) { fail(`probe ${label} not found in exported docs`); continue; }
      const rawFile = path.join(WORK, `probe-${label}.html`);
      writeFileSync(rawFile, src);

      const rawPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await rawPage.goto(`file://${rawFile}`);
      const expected = await computedStyles(rawPage, probe.selector, probe.props);
      await rawPage.close();

      const reactPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await reactPage.goto(`http://127.0.0.1:${port}/#/${slug}`);
      const actual = await computedStyles(reactPage, probe.selector, probe.props);
      await reactPage.close();

      if (expected === null) { fail(`${label} ${probe.selector}: missing in source`); continue; }
      if (actual === null) { fail(`${label} ${probe.selector}: missing in React render`); continue; }
      const diffs = probe.props.filter((k) => expected[k] !== actual[k]);
      if (diffs.length === 0) {
        console.log(`OK   ${label} ${probe.selector} ${JSON.stringify(expected)}`);
      } else {
        fail(`${label} ${probe.selector} differs on ${diffs.join(", ")}: ` +
          `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
      }
    }
  } finally {
    preview.kill();
    await browser.close();
  }

  console.log(`evidence in ${OUT}`);
  console.log(failures === 0 ? "react export verification PASSED" : `react export verification FAILED (${failures})`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
