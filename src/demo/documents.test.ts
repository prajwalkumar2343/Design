import { describe, expect, it } from "vitest";

import { demoDocument, initialFrames } from "./documents";
import { luminaStationDocument } from "./lumina-station";

describe("demo documents", () => {
  it("ships unique self-contained frames wired to their documents", () => {
    expect(new Set(initialFrames.map((frame) => frame.id)).size).toBe(initialFrames.length);
    for (const frame of initialFrames) {
      expect(frame.srcDoc.trim().toLowerCase().startsWith("<!doctype html>")).toBe(true);
      expect(frame.width).toBeGreaterThan(0);
      expect(frame.height).toBeGreaterThan(0);
    }
  });

  it("keeps the four Fieldwork viewport frames on one shared document", () => {
    const fieldwork = initialFrames.filter((frame) => frame.documentId === "fieldwork");

    expect(fieldwork.map((frame) => frame.id)).toEqual(["desktop", "tablet", "mobile", "mobile-large"]);
    for (const frame of fieldwork) {
      expect(frame.srcDoc).toBe(demoDocument);
    }
    const sorted = [...fieldwork].sort((a, b) => a.x - b.x);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index].x).toBeGreaterThanOrEqual(sorted[index - 1].x + sorted[index - 1].width);
    }
  });

  it("places the Lumina Station document on its own page", () => {
    const lumina = initialFrames.filter((frame) => frame.documentId === "lumina-station");

    expect(lumina).toHaveLength(1);
    expect(lumina[0].srcDoc).toBe(luminaStationDocument);
    expect(lumina[0].pageId).toBe("lumina-page");
    expect(lumina[0].y).toBeGreaterThan(0);
  });
});
