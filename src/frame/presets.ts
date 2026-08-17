import type { CanvasFrame, Point } from "../canvas/types";
import { demoDocument } from "../demo/documents";

export type DeviceCategory = "mobile" | "tablet" | "desktop";

export interface FramePreset {
  id: string;
  category: DeviceCategory;
  group: string;
  label: string;
  detail: string;
  width: number;
  height: number;
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
): FramePreset {
  return { id, category, group, label, detail, width, height };
}

export const FRAME_PRESETS: FramePreset[] = [
  // Mobile · Standard
  preset("mobile", "mobile", "Standard", "Mobile", "390 × 844 · standard 6″", 390, 844),

  // Mobile · iPhone 12
  preset("iphone-12", "mobile", "iPhone", "iPhone 12", "390 × 844 · 6.1″", 390, 844),
  preset("iphone-12-mini", "mobile", "iPhone", "iPhone 12 mini", "375 × 812 · 5.4″", 375, 812),
  preset("iphone-12-pro", "mobile", "iPhone", "iPhone 12 Pro", "390 × 844 · 6.1″", 390, 844),
  preset("iphone-12-pro-max", "mobile", "iPhone", "iPhone 12 Pro Max", "428 × 926 · 6.7″", 428, 926),

  // Mobile · iPhone 13
  preset("iphone-13", "mobile", "iPhone", "iPhone 13", "390 × 844 · 6.1″", 390, 844),
  preset("iphone-13-mini", "mobile", "iPhone", "iPhone 13 mini", "375 × 812 · 5.4″", 375, 812),
  preset("iphone-13-pro", "mobile", "iPhone", "iPhone 13 Pro", "390 × 844 · 6.1″", 390, 844),
  preset("iphone-13-pro-max", "mobile", "iPhone", "iPhone 13 Pro Max", "428 × 926 · 6.7″", 428, 926),

  // Mobile · iPhone 14
  preset("iphone-14", "mobile", "iPhone", "iPhone 14", "390 × 844 · 6.1″", 390, 844),
  preset("iphone-14-plus", "mobile", "iPhone", "iPhone 14 Plus", "428 × 926 · 6.7″", 428, 926),
  preset("iphone-14-pro", "mobile", "iPhone", "iPhone 14 Pro", "393 × 852 · 6.1″", 393, 852),
  preset("iphone-14-pro-max", "mobile", "iPhone", "iPhone 14 Pro Max", "430 × 932 · 6.7″", 430, 932),

  // Mobile · iPhone 15
  preset("iphone-15", "mobile", "iPhone", "iPhone 15", "393 × 852 · 6.1″", 393, 852),
  preset("iphone-15-plus", "mobile", "iPhone", "iPhone 15 Plus", "428 × 926 · 6.7″", 428, 926),
  preset("iphone-15-pro", "mobile", "iPhone", "iPhone 15 Pro", "393 × 852 · 6.1″", 393, 852),
  preset("iphone-15-pro-max", "mobile", "iPhone", "iPhone 15 Pro Max", "430 × 932 · 6.7″", 430, 932),

  // Mobile · iPhone 16
  preset("iphone-16", "mobile", "iPhone", "iPhone 16", "393 × 852 · 6.1″", 393, 852),
  preset("iphone-16-plus", "mobile", "iPhone", "iPhone 16 Plus", "430 × 932 · 6.7″", 430, 932),
  preset("iphone-16-pro", "mobile", "iPhone", "iPhone 16 Pro", "402 × 874 · 6.3″", 402, 874),
  preset("iphone-16-pro-max", "mobile", "iPhone", "iPhone 16 Pro Max", "440 × 956 · 6.9″", 440, 956),
  preset("iphone-16e", "mobile", "iPhone", "iPhone 16e", "390 × 844 · 6.1″", 390, 844),

  // Mobile · iPhone 17
  preset("iphone-17", "mobile", "iPhone", "iPhone 17", "402 × 874 · 6.3″", 402, 874),
  preset("iphone-17-air", "mobile", "iPhone", "iPhone 17 Air", "420 × 912 · 6.6″", 420, 912),
  preset("iphone-17-pro", "mobile", "iPhone", "iPhone 17 Pro", "402 × 874 · 6.3″", 402, 874),
  preset("iphone-17-pro-max", "mobile", "iPhone", "iPhone 17 Pro Max", "440 × 956 · 6.9″", 440, 956),
  preset("iphone-17e", "mobile", "iPhone", "iPhone 17e", "390 × 844 · 6.1″", 390, 844),

  // Mobile · Android
  preset("galaxy-s24", "mobile", "Android", "Galaxy S24", "360 × 780 · 6.2″", 360, 780),
  preset("galaxy-s24-plus", "mobile", "Android", "Galaxy S24+", "384 × 832 · 6.7″", 384, 832),
  preset("galaxy-s24-ultra", "mobile", "Android", "Galaxy S24 Ultra", "412 × 915 · 6.8″", 412, 915),
  preset("galaxy-z-fold6", "mobile", "Android", "Galaxy Z Fold6", "344 × 882 · 6.3″ cover", 344, 882),
  preset("pixel-9", "mobile", "Android", "Google Pixel 9", "412 × 915 · 6.3″", 412, 915),
  preset("oneplus-13", "mobile", "Android", "OnePlus 13", "412 × 915 · 6.8″", 412, 915),
  preset("xiaomi-15", "mobile", "Android", "Xiaomi 15", "393 × 873 · 6.4″", 393, 873),
  preset("android-legacy", "mobile", "Android", "Android legacy", "360 × 640 · classic", 360, 640),

  // Tablet · Standard
  preset("tablet", "tablet", "Standard", "Tablet", "820 × 1180 · 10.9″", 820, 1180),

  // Tablet · Apple iPad
  preset("ipad-mini", "tablet", "Apple iPad", "iPad mini", "744 × 1133 · 8.3″", 744, 1133),
  preset("ipad-9", "tablet", "Apple iPad", "iPad (9th gen)", "810 × 1080 · 10.2″", 810, 1080),
  preset("ipad-air-11", "tablet", "Apple iPad", "iPad Air 11″", "820 × 1180 · 10.9″", 820, 1180),
  preset("ipad-pro-11", "tablet", "Apple iPad", "iPad Pro 11″", "834 × 1194 · 11″", 834, 1194),
  preset("ipad-pro-129", "tablet", "Apple iPad", "iPad Pro 12.9″", "1024 × 1366 · 12.9″", 1024, 1366),
  preset("ipad-pro-13", "tablet", "Apple iPad", "iPad Pro 13″ (M4)", "1032 × 1376 · 13″", 1032, 1376),

  // Tablet · Android & Windows
  preset("galaxy-tab-s9", "tablet", "Android & Windows", "Galaxy Tab S9", "800 × 1280 · 11″", 800, 1280),
  preset("surface-pro-11", "tablet", "Android & Windows", "Surface Pro 11", "960 × 1440 · 13″", 960, 1440),

  // Desktop · Standard
  preset("desktop", "desktop", "Standard", "Desktop", "1440 × 900", 1440, 900),

  // Desktop · Common monitors
  preset("desktop-1280x720", "desktop", "Common monitors", "1280 × 720", "HD", 1280, 720),
  preset("desktop-1280x800", "desktop", "Common monitors", "1280 × 800", "WXGA", 1280, 800),
  preset("desktop-1366x768", "desktop", "Common monitors", "1366 × 768", "HD", 1366, 768),
  preset("desktop-1536x864", "desktop", "Common monitors", "1536 × 864", "HD+", 1536, 864),
  preset("desktop-1600x900", "desktop", "Common monitors", "1600 × 900", "HD+", 1600, 900),
  preset("desktop-1680x1050", "desktop", "Common monitors", "1680 × 1050", "WSXGA+", 1680, 1050),
  preset("desktop-1920x1080", "desktop", "Common monitors", "1920 × 1080", "Full HD", 1920, 1080),
  preset("desktop-1920x1200", "desktop", "Common monitors", "1920 × 1200", "WUXGA", 1920, 1200),
  preset("desktop-2560x1440", "desktop", "Common monitors", "2560 × 1440", "QHD", 2560, 1440),
  preset("desktop-3840x2160", "desktop", "Common monitors", "3840 × 2160", "4K UHD", 3840, 2160),

  // Desktop · Laptops
  preset("macbook-air-13", "desktop", "Laptops", "MacBook Air 13″", "1280 × 832", 1280, 832),
  preset("macbook-air-15", "desktop", "Laptops", "MacBook Air 15″", "1440 × 932", 1440, 932),
  preset("macbook-pro-14", "desktop", "Laptops", "MacBook Pro 14″", "1512 × 982", 1512, 982),
  preset("macbook-pro-16", "desktop", "Laptops", "MacBook Pro 16″", "1728 × 1117", 1728, 1117),
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
    srcDoc: demoDocument,
    background: "#f3f0e9",
  };
}
