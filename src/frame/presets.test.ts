import { describe, expect, it } from "vitest";
import { createFrameFromPreset, FRAME_PRESETS, FRAME_PRESET_SECTIONS } from "./presets";

describe("createFrameFromPreset", () => {
  it("centers the requested viewport at the world position", () => {
    const preset = FRAME_PRESETS.find((candidate) => candidate.id === "mobile")!;
    const frame = createFrameFromPreset({
      preset,
      position: { x: 1000, y: 800 },
      sequence: 5,
    });

    expect(frame).toMatchObject({
      id: "mobile-5",
      name: "Mobile · 390 × 844",
      x: 805,
      y: 378,
      width: 390,
      height: 844,
    });
    expect(frame.srcDoc).toContain("<!doctype html>");
  });

  it("does not repeat dimensions in the name when the label already shows them", () => {
    const preset = FRAME_PRESETS.find((candidate) => candidate.id === "desktop-1920x1080")!;
    const frame = createFrameFromPreset({
      preset,
      position: { x: 0, y: 0 },
      sequence: 1,
    });

    expect(frame.name).toBe("1920 × 1080");
  });
});

describe("FRAME_PRESETS", () => {
  it("keeps the standard mobile, tablet, and desktop presets first in their sections", () => {
    const ids = FRAME_PRESETS.map((preset) => preset.id);
    expect(ids.indexOf("mobile")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("tablet")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("desktop")).toBeGreaterThanOrEqual(0);
  });

  it("covers every iPhone model from 12 to 17", () => {
    const iphoneLabels = FRAME_PRESETS
      .filter((preset) => preset.group === "iPhone")
      .map((preset) => preset.label);

    for (const label of ["iPhone 12", "iPhone 13", "iPhone 14", "iPhone 15", "iPhone 16", "iPhone 17"]) {
      expect(iphoneLabels.some((candidate) => candidate.startsWith(label))).toBe(true);
    }
    expect(iphoneLabels).toContain("iPhone 12 mini");
    expect(iphoneLabels).toContain("iPhone 12 Pro Max");
    expect(iphoneLabels).toContain("iPhone 14 Plus");
    expect(iphoneLabels).toContain("iPhone 17 Air");
    expect(iphoneLabels).toContain("iPhone 17e");
  });

  it("includes popular Android phones and tablets", () => {
    const androidPhones = FRAME_PRESETS.filter((preset) => preset.group === "Android");
    expect(androidPhones.length).toBeGreaterThanOrEqual(5);
    expect(androidPhones.map((preset) => preset.label)).toContain("Galaxy S24");
    expect(androidPhones.map((preset) => preset.label)).toContain("Google Pixel 9");

    const tabletGroups = FRAME_PRESET_SECTIONS.find((section) => section.category === "tablet")!;
    expect(tabletGroups.groups.some((group) => group.title === "Apple iPad")).toBe(true);
  });

  it("groups presets into mobile, tablet, and desktop sections", () => {
    expect(FRAME_PRESET_SECTIONS.map((section) => section.category)).toEqual([
      "mobile",
      "tablet",
      "desktop",
    ]);
    for (const section of FRAME_PRESET_SECTIONS) {
      const items = section.groups.flatMap((group) => group.items);
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.category === section.category)).toBe(true);
    }
  });

  it("gives every preset a unique id and positive dimensions", () => {
    const ids = FRAME_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of FRAME_PRESETS) {
      expect(preset.width).toBeGreaterThan(0);
      expect(preset.height).toBeGreaterThan(0);
      const dimensions = `${preset.width} × ${preset.height}`;
      expect(preset.detail.includes(dimensions) || preset.label.includes(dimensions)).toBe(true);
    }
  });
});
