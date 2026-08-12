import type { CanvasFrame, Point } from "../canvas/types";
import { demoDocument } from "../demo/documents";

export interface FramePreset {
  id: "desktop" | "tablet" | "mobile";
  label: string;
  detail: string;
  width: number;
  height: number;
}

export const FRAME_PRESETS: FramePreset[] = [
  {
    id: "desktop",
    label: "Desktop",
    detail: "1440 × 900",
    width: 1440,
    height: 900,
  },
  {
    id: "tablet",
    label: "Tablet",
    detail: "820 × 1180",
    width: 820,
    height: 1180,
  },
  {
    id: "mobile",
    label: "Mobile",
    detail: "390 × 844",
    width: 390,
    height: 844,
  },
];

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
  return {
    id: `${preset.id}-${sequence}`,
    name: `${preset.label} · ${preset.width} × ${preset.height}`,
    documentId: "fieldwork",
    x: Math.round(position.x - preset.width / 2),
    y: Math.round(position.y - preset.height / 2),
    width: preset.width,
    height: preset.height,
    srcDoc: demoDocument,
    background: "#f3f0e9",
  };
}
