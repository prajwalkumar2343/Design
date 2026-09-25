#!/usr/bin/env node

// Push HTML/CSS into a running Canvas workspace over the agent bridge
// (vite-plugin-canvas-agent.ts). The dev or preview server must be running;
// on preview builds the app tab needs ?agent=1 to enable its poller.
//
//   node push-design.mjs --html hero.html --css hero.css --name "Hero"
//   node push-design.mjs --id hero --html hero-v2.html        # replace
//   node push-design.mjs --list
//   node push-design.mjs --remove hero
//   echo '{"op":"push","fragment":"<h1>Hi</h1>"}' | node push-design.mjs --stdin
//
// Emits the op result as JSON on stdout; diagnostics go to stderr. Nonzero
// exit means the canvas did not accept the op.

import { readFile } from "node:fs/promises";

const RESULT_TIMEOUT_MS = 25_000;

function parseArguments(argv) {
  const options = { url: "http://127.0.0.1:5173", stdin: false, list: false };
  const flags = new Map([
    ["--url", "url"],
    ["--html", "html"],
    ["--css", "css"],
    ["--fragment", "fragment"],
    ["--name", "name"],
    ["--id", "id"],
    ["--document", "documentId"],
    ["--x", "x"],
    ["--y", "y"],
    ["--width", "width"],
    ["--height", "height"],
    ["--background", "background"],
    ["--remove", "remove"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--stdin") {
      options.stdin = true;
      continue;
    }
    if (flag === "--list") {
      options.list = true;
      continue;
    }
    if (!flags.has(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    options[flags.get(flag)] = value;
    index += 1;
  }

  const url = new URL(options.url);
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) {
    throw new Error("--url must point to a loopback host");
  }
  return { ...options, url: url.toString() };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

async function buildOp(options) {
  if (options.list) return { op: "list" };
  if (options.remove) return { op: "remove", frameId: options.remove };

  const op = { op: "push" };
  for (const key of ["html", "css", "fragment"]) {
    if (options[key]) op[key] = await readFile(options[key], "utf8");
  }
  for (const key of ["name", "id", "documentId", "background"]) {
    if (options[key]) op[key] = options[key];
  }
  for (const key of ["x", "y", "width", "height"]) {
    if (options[key] !== undefined) {
      const value = Number(options[key]);
      if (!Number.isFinite(value)) throw new Error(`--${key} must be a number`);
      op[key] = value;
    }
  }
  if (!op.html && !op.css && !op.fragment) {
    throw new Error("push requires --html, --css, --fragment, or --stdin");
  }
  return op;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const op = options.stdin ? JSON.parse(await readStdin()) : await buildOp(options);
  const base = `${options.url.replace(/\/$/, "")}/__canvas-agent`;

  let enqueue;
  try {
    const response = await fetch(`${base}/op`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(op),
    });
    enqueue = await response.json();
    if (!response.ok) {
      throw new Error(enqueue?.error?.message ?? `op rejected (${response.status})`);
    }
  } catch (error) {
    if (error?.cause?.code === "ECONNREFUSED" || error?.code === "ECONNREFUSED") {
      throw new Error(`No Canvas server at ${options.url} — start it with npm run dev`);
    }
    throw error;
  }

  const resultResponse = await fetch(
    `${base}/result?seq=${enqueue.seq}&timeout=${RESULT_TIMEOUT_MS}`,
  );
  const payload = await resultResponse.json();
  if (payload.error) {
    process.stdout.write(`${JSON.stringify({ ok: false, seq: enqueue.seq, ...payload }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const result = payload.result;
  process.stdout.write(`${JSON.stringify({ seq: enqueue.seq, ...result }, null, 2)}\n`);
  if (!result?.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`push-design: ${error.message}\n`);
  process.exitCode = 1;
});
