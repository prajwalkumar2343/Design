import { expect, test } from "@playwright/test";

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
