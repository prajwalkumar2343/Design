import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { parseFig } from "openfig-core";

const wireframeProject = {
  kind: "wirecanvas-project",
  schemaVersion: 1,
  state: {
    session: {
      kind: "brainstorm-session",
      schemaVersion: 1,
      lifecycle: "briefing",
      sessionId: "imported-session",
      revision: 1,
      briefFrame: {
        id: "imported-brief",
        kind: "brief",
        name: "Project brief",
        x: -640,
        y: 0,
        width: 520,
        height: 720,
        revision: 1,
        content: {
          projectDescription: "Restored wireframe project",
          audience: "People reviewing the first pass",
          goals: [],
          successCriteria: [],
          requiredFeatures: [],
          requiredContent: [],
          visualDirection: "Quiet grayscale layout",
          constraints: [],
          references: [],
          openQuestions: [],
          confirmedDecisions: [],
        },
      },
      selection: { type: "brief-frame", briefFrameId: "imported-brief" },
    },
    documents: [
      {
        id: "wireframe-document",
        name: "Wireframe",
        mode: "wireframe",
        srcDoc: "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"></head><body><main class=\"layout\"><h1>Restored wireframe</h1><p>Semantic content</p></main><style>.layout{display:grid;gap:16px;max-width:640px}</style></body></html>",
        revision: 1,
        rootNodeIds: [],
        pageIds: ["wireframe-page"],
      },
    ],
    pages: [
      {
        id: "wireframe-page",
        documentId: "wireframe-document",
        name: "Wireframe page",
        frameIds: ["wireframe-frame"],
      },
    ],
    frames: [
      {
        id: "wireframe-frame",
        pageId: "wireframe-page",
        documentId: "wireframe-document",
        name: "Wireframe",
        x: 0,
        y: 0,
        width: 720,
        height: 560,
        background: "#ffffff",
      },
    ],
    nodes: [],
    activePageId: "wireframe-page",
    selection: {
      frameIds: ["wireframe-frame"],
      nodeIds: [],
      primaryFrameId: "wireframe-frame",
      primaryNodeId: null,
    },
    activeTool: "select",
  },
};

test.describe("WireCanvas project persistence", () => {
  test("exports a project file and imports it into a blank canvas", async ({ browser, page }) => {
    await page.goto("/");
    await page.getByTestId("start-brainstorming").click();
    await page.getByTestId("brief-field-projectDescription").fill("Portable canvas project");
    await page.getByTestId("brief-field-audience").click();

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-project-button").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("brainstorm-session.wirecanvas.json");
    const path = await download.path();
    if (!path) throw new Error("Export download has no temporary path");

    const blankPage = await browser.newPage();
    await blankPage.goto("/");
    await blankPage.getByTestId("import-project-input").setInputFiles(path);
    await expect(blankPage.getByTestId("brief-field-projectDescription")).toHaveValue("Portable canvas project");
    await expect(blankPage.getByTestId("persistence-feedback")).toContainText("imported successfully");
    await blankPage.close();
  });

  test("restores a brief and wireframe frame from a project file", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("import-project-input").setInputFiles({
      name: "restored.wirecanvas.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(wireframeProject)),
    });

    await expect(page.getByTestId("brief-field-projectDescription")).toHaveValue("Restored wireframe project");
    await expect(page.locator('[data-frame-id="wireframe-frame"]')).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(1);
    await expect(page.getByTestId("persistence-feedback")).toContainText("imported successfully");
  });

  test("exports the canvas as a Figma .fig file with mapped frames and shapes", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("start-brainstorming").click();
    await page.getByTestId("brief-field-projectDescription").fill("Figma export canvas");
    await page.getByTestId("brief-field-audience").click();

    await page.getByTestId("add-frame-button").click();
    await page.getByRole("menu", { name: "Frame presets" }).waitFor();
    await page.getByTestId("frame-category-mobile").click();
    await page.getByTestId("add-mobile-frame").click();
    const frame = page.locator('[data-frame-id]').filter({ has: page.locator("iframe") }).last();

    await page.getByTestId("tool-button-rectangle").click();
    const creationLayer = frame.getByTestId("frame-creation-layer");
    const box = await creationLayer.boundingBox();
    if (!box) throw new Error("The active frame creation layer is unavailable");
    const start = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.4 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 120, start.y + 80, { steps: 4 });
    await page.mouse.up();

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-figma-button").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("brainstorm-session.fig");
    const path = await download.path();
    if (!path) throw new Error("Figma export download has no temporary path");

    const bytes = readFileSync(path);
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    const doc = parseFig(new Uint8Array(bytes));
    expect(doc.header.prelude).toBe("fig-kiwi");
    expect(doc.meta).toMatchObject({ file_name: "brainstorm-session" });
    expect(doc.thumbnail && doc.thumbnail.length).toBeGreaterThan(100);

    const frameNode = doc.nodes.find((child) => child.type === "FRAME");
    expect(frameNode).toBeTruthy();
    const children = frameNode ? (doc.childrenMap.get(`${frameNode.guid.sessionID}:${frameNode.guid.localID}`) ?? []) : [];
    expect(children.some((child) => child.type === "ROUNDED_RECTANGLE")).toBe(true);
  });

  test("shows malformed-file feedback without losing current work", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("start-brainstorming").click();
    const description = page.getByTestId("brief-field-projectDescription");
    await description.fill("Keep this work");
    await page.getByTestId("brief-field-audience").click();

    await page.getByTestId("import-project-input").setInputFiles({
      name: "broken.wirecanvas.json",
      mimeType: "application/json",
      buffer: Buffer.from("{broken"),
    });

    await expect(page.getByTestId("persistence-feedback")).toHaveAttribute("role", "alert");
    await expect(description).toHaveValue("Keep this work");
  });
});
