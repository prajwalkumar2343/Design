import type { CanvasFrame, Point } from "../canvas/types";
import { demoDocument } from "../demo/documents";

export type DeviceCategory = "mobile" | "tablet" | "desktop";

export type DeviceChromeType = "notch" | "dynamic-island" | "punch-hole" | "none";

export interface DeviceChrome {
  type: DeviceChromeType;
  /** Visual width of the cutout (px in viewport units, before scaling) */
  width?: number;
  /** Visual height of the cutout */
  height?: number;
  /** Corner radius of the hardware bezel */
  bezelRadius?: number;
  /** Position variant for punch-hole: center vs offset */
  punchPosition?: "center" | "left";
}

export interface FramePreset {
  id: string;
  category: DeviceCategory;
  group: string;
  label: string;
  detail: string;
  width: number;
  height: number;
  chrome: DeviceChrome;
  /** Human readable hardware note, e.g. "Notch · Face ID" */
  hardwareNote?: string;
}

export interface FramePresetGroup {
  title: string;
  items: FramePreset[];
}

export interface FramePresetSection {
  category: DeviceCategory;
  title: string;
  groups: FramePresetGroup[];
}

function preset(
  id: string,
  category: DeviceCategory,
  group: string,
  label: string,
  detail: string,
  width: number,
  height: number,
  chrome: DeviceChrome,
  hardwareNote?: string,
): FramePreset {
  return { id, category, group, label, detail, width, height, chrome, hardwareNote };
}

// Chrome presets — accurate per Apple HIG / physical measurements
// iPhone X/XS/11 Pro notch: 209×30 pt at 375pt width, corner radii 6/20 pt. Scaled to viewport.
// iPhone 13/14 notch: 20% narrower (≈160×30) — Apple reduced width for 13 generation.
// Dynamic Island (14 Pro → 17): 126×37.33 pt pill, 19pt radius, 11pt top inset.
// Punch-hole (Android): 12pt diameter, centered 12pt from top, as per Material guidelines.
const notch: DeviceChrome = { type: "notch", width: 209, height: 30, bezelRadius: 48 };
const notchMini: DeviceChrome = { type: "notch", width: 209, height: 30, bezelRadius: 44 };
const notch13: DeviceChrome = { type: "notch", width: 160, height: 30, bezelRadius: 48 };
const notch13Mini: DeviceChrome = { type: "notch", width: 160, height: 28, bezelRadius: 44 };
const notchLarge: DeviceChrome = { type: "notch", width: 209, height: 30, bezelRadius: 54 };
const notch13Large: DeviceChrome = { type: "notch", width: 160, height: 30, bezelRadius: 54 };
const dynamicIsland: DeviceChrome = { type: "dynamic-island", width: 126, height: 37, bezelRadius: 52 };
const dynamicIslandLarge: DeviceChrome = { type: "dynamic-island", width: 126, height: 37, bezelRadius: 56 };
const dynamicIslandSmall: DeviceChrome = { type: "dynamic-island", width: 126, height: 37, bezelRadius: 50 };
const punchHole: DeviceChrome = { type: "punch-hole", width: 12, height: 12, bezelRadius: 28, punchPosition: "center" };
const punchHoleLarge: DeviceChrome = { type: "punch-hole", width: 12, height: 12, bezelRadius: 30, punchPosition: "center" };
const noChrome: DeviceChrome = { type: "none", bezelRadius: 16 };
const desktopChrome: DeviceChrome = { type: "none", bezelRadius: 10 };

export const FRAME_PRESETS: FramePreset[] = [
  // Mobile · Standard — modern Android punch-hole as default
  preset("mobile", "mobile", "Standard", "Mobile", "390 × 844 · punch-hole 6″", 390, 844, punchHole, "Center punch-hole · 6″"),

  // Mobile · iPhone 12 (all notch)
  preset("iphone-12", "mobile", "iPhone", "iPhone 12", "390 × 844 · 6.1″", 390, 844, notch, "Notch · Face ID"),
  preset("iphone-12-mini", "mobile", "iPhone", "iPhone 12 mini", "375 × 812 · 5.4″", 375, 812, notchMini, "Notch · compact"),
  preset("iphone-12-pro", "mobile", "iPhone", "iPhone 12 Pro", "390 × 844 · 6.1″", 390, 844, notch, "Notch · Face ID"),
  preset("iphone-12-pro-max", "mobile", "iPhone", "iPhone 12 Pro Max", "428 × 926 · 6.7″", 428, 926, notchLarge, "Notch · Face ID · large"),

  // Mobile · iPhone 13 (20% narrower notch vs 12)
  preset("iphone-13", "mobile", "iPhone", "iPhone 13", "390 × 844 · 6.1″", 390, 844, notch13, "Notch · 20% narrower"),
  preset("iphone-13-mini", "mobile", "iPhone", "iPhone 13 mini", "375 × 812 · 5.4″", 375, 812, notch13Mini, "Notch · compact · narrower"),
  preset("iphone-13-pro", "mobile", "iPhone", "iPhone 13 Pro", "390 × 844 · 6.1″", 390, 844, notch13, "Notch · Pro · narrower"),
  preset("iphone-13-pro-max", "mobile", "iPhone", "iPhone 13 Pro Max", "428 × 926 · 6.7″", 428, 926, notch13Large, "Notch · Pro · large · narrower"),

  // Mobile · iPhone 14
  // 14 / Plus keep the reduced notch (same as 13), Pro series moves to Dynamic Island
  preset("iphone-14", "mobile", "iPhone", "iPhone 14", "390 × 844 · 6.1″", 390, 844, notch13, "Notch · Face ID · narrower"),
  preset("iphone-14-plus", "mobile", "iPhone", "iPhone 14 Plus", "428 × 926 · 6.7″", 428, 926, notch13Large, "Notch · Face ID · large · narrower"),
  preset("iphone-14-pro", "mobile", "iPhone", "iPhone 14 Pro", "393 × 852 · 6.1″", 393, 852, dynamicIsland, "Dynamic Island"),
  preset("iphone-14-pro-max", "mobile", "iPhone", "iPhone 14 Pro Max", "430 × 932 · 6.7″", 430, 932, dynamicIslandLarge, "Dynamic Island · large"),

  // Mobile · iPhone 15 — all Dynamic Island
  preset("iphone-15", "mobile", "iPhone", "iPhone 15", "393 × 852 · 6.1″", 393, 852, dynamicIsland, "Dynamic Island"),
  preset("iphone-15-plus", "mobile", "iPhone", "iPhone 15 Plus", "428 × 926 · 6.7″", 428, 926, dynamicIslandLarge, "Dynamic Island · large"),
  preset("iphone-15-pro", "mobile", "iPhone", "iPhone 15 Pro", "393 × 852 · 6.1″", 393, 852, dynamicIsland, "Dynamic Island · Pro"),
  preset("iphone-15-pro-max", "mobile", "iPhone", "iPhone 15 Pro Max", "430 × 932 · 6.7″", 430, 932, dynamicIslandLarge, "Dynamic Island · Pro · large"),

  // Mobile · iPhone 16
  preset("iphone-16", "mobile", "iPhone", "iPhone 16", "393 × 852 · 6.1″", 393, 852, dynamicIsland, "Dynamic Island"),
  preset("iphone-16-plus", "mobile", "iPhone", "iPhone 16 Plus", "430 × 932 · 6.7″", 430, 932, dynamicIslandLarge, "Dynamic Island · large"),
  preset("iphone-16-pro", "mobile", "iPhone", "iPhone 16 Pro", "402 × 874 · 6.3″", 402, 874, dynamicIslandSmall, "Dynamic Island · Pro · 6.3″"),
  preset("iphone-16-pro-max", "mobile", "iPhone", "iPhone 16 Pro Max", "440 × 956 · 6.9″", 440, 956, dynamicIslandLarge, "Dynamic Island · Pro · 6.9″"),
  preset("iphone-16e", "mobile", "iPhone", "iPhone 16e", "390 × 844 · 6.1″", 390, 844, notch, "Notch · budget"),

  // Mobile · iPhone 17 — all Dynamic Island, new 17 Air is ultra-thin with smaller pill
  preset("iphone-17", "mobile", "iPhone", "iPhone 17", "402 × 874 · 6.3″", 402, 874, dynamicIslandSmall, "Dynamic Island · 6.3″"),
  preset("iphone-17-air", "mobile", "iPhone", "iPhone 17 Air", "420 × 912 · 6.6″", 420, 912, { type: "dynamic-island", width: 112, height: 32, bezelRadius: 52 }, "Dynamic Island · Air · ultra-thin"),
  preset("iphone-17-pro", "mobile", "iPhone", "iPhone 17 Pro", "402 × 874 · 6.3″", 402, 874, dynamicIslandSmall, "Dynamic Island · Pro"),
  preset("iphone-17-pro-max", "mobile", "iPhone", "iPhone 17 Pro Max", "440 × 956 · 6.9″", 440, 956, dynamicIslandLarge, "Dynamic Island · Pro · large"),
  preset("iphone-17e", "mobile", "iPhone", "iPhone 17e", "390 × 844 · 6.1″", 390, 844, notch, "Notch · budget"),

  // Mobile · Android — center punch-hole (modern) except legacy
  preset("galaxy-s24", "mobile", "Android", "Galaxy S24", "360 × 780 · 6.2″", 360, 780, punchHole, "Center punch-hole · 6.2″"),
  preset("galaxy-s24-plus", "mobile", "Android", "Galaxy S24+", "384 × 832 · 6.7″", 384, 832, punchHoleLarge, "Center punch-hole · 6.7″"),
  preset("galaxy-s24-ultra", "mobile", "Android", "Galaxy S24 Ultra", "412 × 915 · 6.8″", 412, 915, punchHoleLarge, "Center punch-hole · 6.8″"),
  preset("galaxy-z-fold6", "mobile", "Android", "Galaxy Z Fold6", "344 × 882 · 6.3″ cover", 344, 882, { type: "punch-hole", width: 10, height: 10, bezelRadius: 26, punchPosition: "center" }, "Under-display · cover"),
  preset("pixel-9", "mobile", "Android", "Google Pixel 9", "412 × 915 · 6.3″", 412, 915, punchHole, "Center punch-hole · Pixel"),
  preset("oneplus-13", "mobile", "Android", "OnePlus 13", "412 × 915 · 6.8″", 412, 915, punchHoleLarge, "Center punch-hole · 6.8″"),
  preset("xiaomi-15", "mobile", "Android", "Xiaomi 15", "393 × 873 · 6.4″", 393, 873, punchHole, "Center punch-hole · 6.4″"),
  preset("android-legacy", "mobile", "Android", "Android legacy", "360 × 640 · classic", 360, 640, noChrome, "No cutout · classic"),

  // Tablet · Standard
  preset("tablet", "tablet", "Standard", "Tablet", "820 × 1180 · 10.9″", 820, 1180, noChrome, "No cutout"),

  // Tablet · Apple iPad — no notch / no island, optional center camera punch on Pro
  preset("ipad-mini", "tablet", "Apple iPad", "iPad mini", "744 × 1133 · 8.3″", 744, 1133, noChrome, "No cutout · Touch ID"),
  preset("ipad-9", "tablet", "Apple iPad", "iPad (9th gen)", "810 × 1080 · 10.2″", 810, 1080, noChrome, "Home button · classic"),
  preset("ipad-air-11", "tablet", "Apple iPad", "iPad Air 11″", "820 × 1180 · 10.9″", 820, 1180, noChrome, "Top button · Touch ID"),
  preset("ipad-pro-11", "tablet", "Apple iPad", "iPad Pro 11″", "834 × 1194 · 11″", 834, 1194, { type: "punch-hole", width: 10, height: 10, bezelRadius: 24, punchPosition: "center" }, "Center punch · Face ID"),
  preset("ipad-pro-129", "tablet", "Apple iPad", "iPad Pro 12.9″", "1024 × 1366 · 12.9″", 1024, 1366, { type: "punch-hole", width: 10, height: 10, bezelRadius: 24, punchPosition: "center" }, "Center punch · Face ID"),
  preset("ipad-pro-13", "tablet", "Apple iPad", "iPad Pro 13″ (M4)", "1032 × 1376 · 13″", 1032, 1376, { type: "punch-hole", width: 10, height: 10, bezelRadius: 26, punchPosition: "center" }, "Center punch · Face ID · M4"),

  // Tablet · Android & Windows — punch or none
  preset("galaxy-tab-s9", "tablet", "Android & Windows", "Galaxy Tab S9", "800 × 1280 · 11″", 800, 1280, punchHole, "Center punch-hole"),
  preset("surface-pro-11", "tablet", "Android & Windows", "Surface Pro 11", "960 × 1440 · 13″", 960, 1440, noChrome, "No cutout · kickstand"),

  // Desktop · Standard
  preset("desktop", "desktop", "Standard", "Desktop", "1440 × 900", 1440, 900, desktopChrome, "No cutout"),
  // Desktop · Common monitors
  preset("desktop-1280x720", "desktop", "Common monitors", "1280 × 720", "HD", 1280, 720, desktopChrome),
  preset("desktop-1280x800", "desktop", "Common monitors", "1280 × 800", "WXGA", 1280, 800, desktopChrome),
  preset("desktop-1366x768", "desktop", "Common monitors", "1366 × 768", "HD", 1366, 768, desktopChrome),
  preset("desktop-1536x864", "desktop", "Common monitors", "1536 × 864", "HD+", 1536, 864, desktopChrome),
  preset("desktop-1600x900", "desktop", "Common monitors", "1600 × 900", "HD+", 1600, 900, desktopChrome),
  preset("desktop-1680x1050", "desktop", "Common monitors", "1680 × 1050", "WSXGA+", 1680, 1050, desktopChrome),
  preset("desktop-1920x1080", "desktop", "Common monitors", "1920 × 1080", "Full HD", 1920, 1080, desktopChrome),
  preset("desktop-1920x1200", "desktop", "Common monitors", "1920 × 1200", "WUXGA", 1920, 1200, desktopChrome),
  preset("desktop-2560x1440", "desktop", "Common monitors", "2560 × 1440", "QHD", 2560, 1440, desktopChrome),
  preset("desktop-3840x2160", "desktop", "Common monitors", "3840 × 2160", "4K UHD", 3840, 2160, desktopChrome),

  // Desktop · Laptops
  preset("macbook-air-13", "desktop", "Laptops", "MacBook Air 13″", "1280 × 832", 1280, 832, desktopChrome, "No cutout · notch on device, not viewport"),
  preset("macbook-air-15", "desktop", "Laptops", "MacBook Air 15″", "1440 × 932", 1440, 932, desktopChrome),
  preset("macbook-pro-14", "desktop", "Laptops", "MacBook Pro 14″", "1512 × 982", 1512, 982, desktopChrome),
  preset("macbook-pro-16", "desktop", "Laptops", "MacBook Pro 16″", "1728 × 1117", 1728, 1117, desktopChrome),
];

function buildSections(presets: readonly FramePreset[]): FramePresetSection[] {
  const categories: ReadonlyArray<{ category: DeviceCategory; title: string }> = [
    { category: "mobile", title: "Mobile" },
    { category: "tablet", title: "Tablet" },
    { category: "desktop", title: "Desktop" },
  ];
  return categories.flatMap(({ category, title }) => {
    const groups = new Map<string, FramePreset[]>();
    for (const item of presets) {
      if (item.category !== category) continue;
      const items = groups.get(item.group) ?? [];
      items.push(item);
      groups.set(item.group, items);
    }
    return groups.size === 0
      ? []
      : [{
          category,
          title,
          groups: Array.from(groups, ([groupTitle, items]) => ({ title: groupTitle, items })),
        }];
  });
}

export const FRAME_PRESET_SECTIONS: FramePresetSection[] = buildSections(FRAME_PRESETS);

interface CreateFrameOptions {
  preset: FramePreset;
  position: Point;
  sequence: number;
}

export function createFrameFromPreset({
  preset,
  position,
  sequence,
}: CreateFrameOptions): CanvasFrame {
  const hasDimensions = /^\d+\s*×\s*\d+$/.test(preset.label);
  return {
    id: `${preset.id}-${sequence}`,
    name: hasDimensions
      ? preset.label
      : `${preset.label} · ${preset.width} × ${preset.height}`,
    documentId: "fieldwork",
    x: Math.round(position.x - preset.width / 2),
    y: Math.round(position.y - preset.height / 2),
    width: preset.width,
    height: preset.height,
    category: preset.category,
    chrome: preset.chrome,
    srcDoc: demoDocument,
    background: "#f3f0e9",
  };
}
