import {
  appendVectorPayloadToDocument,
  assembleCanvasFig,
  createEmptyFigDoc,
  createFigZip,
  encodeFigParts,
  makeSolidPaint,
  type FigNode,
} from "openfig-core";
import { ZstdCodec } from "zstd-codec";
import type { FrameEntity, NodeEntity } from "../editor/model";
import type { OverlayBridgeTargetState } from "../overlay/useNodeOverlayGestures";

export const FIGMA_FILE_NAME = "brainstorm-session.fig" as const;
export const FIGMA_FILE_MIME_TYPE = "application/octet-stream" as const;

export interface FigmaExportInput {
  frames: FrameEntity[];
  nodes: Record<string, NodeEntity>;
  bridgeTargets: Record<string, OverlayBridgeTargetState>;
}

const THUMBNAIL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAYAAADl5PURAAACaUlEQVR4nO3UoREAIBDAsN9/Uxx3DABjIBoRX9U5e12AovkdAPCLAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQ9WzOc/PiAJNQAAAAASUVORK5CYII=";

const DETACH_STYLE_GUID = { sessionID: 0xffffffff, localID: 0xffffffff };

interface ZstdSimple {
  compress(input: Uint8Array, level?: number): Uint8Array;
}

let zstdPromise: Promise<ZstdSimple> | null = null;

function loadZstd(): Promise<ZstdSimple> {
  if (!zstdPromise) {
    zstdPromise = new Promise((resolve) => {
      ZstdCodec.run((zstd: { Simple: new () => ZstdSimple }) => {
        resolve(new zstd.Simple());
      });
    });
  }
  return zstdPromise;
}

function base64ToBytes(base64: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of base64) {
    if (character === "=") break;
    const value = alphabet.indexOf(character);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(output);
}

/**
 * Fractional sibling index for `parentIndex.position`. The alphabet is
 * printable ASCII `!`..`~` and comparison is lexicographic, so a continuation
 * marker reserves the top character to keep longer keys sorting last.
 */
function positionAt(index: number): string {
  const first = 0x21;
  const last = 0x7d;
  const base = last - first + 1;
  const more = "~";
  let out = "";
  let remaining = index;
  while (remaining >= base) {
    out += more;
    remaining -= base;
  }
  return out + String.fromCharCode(first + remaining);
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

function identityTransform(): { m00: number; m01: number; m02: number; m10: number; m11: number; m12: number } {
  return { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
}

function translateTransform(x: number, y: number): { m00: number; m01: number; m02: number; m10: number; m11: number; m12: number } {
  return { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y };
}

function fillPaints(fill: string | undefined, fallback: string): unknown[] | undefined {
  const value = !fill || fill === "none" ? fallback : fill;
  if (!value || value === "none") return undefined;
  return [makeSolidPaint(value)];
}

function strokePaints(
  stroke: string | undefined,
  width: number,
): { strokePaints?: unknown[]; strokeWeight: number } {
  if (!stroke || stroke === "none") return { strokeWeight: 0 };
  return { strokePaints: [makeSolidPaint(stroke)], strokeWeight: width };
}

function baseNode(
  node: Record<string, unknown>,
  guid: { sessionID: number; localID: number },
  name: string,
  type: string,
  parentGuid: { sessionID: number; localID: number },
  position: string,
  bounds: Bounds,
): FigNode {
  return {
    ...node,
    guid,
    type,
    name,
    phase: "CREATED",
    parentIndex: { guid: parentGuid, position },
    size: { x: bounds.width, y: bounds.height },
    transform: translateTransform(bounds.x, bounds.y),
    visible: true,
    opacity: 1,
    blendMode: "PASS_THROUGH",
  } as FigNode;
}

function convertShapeNode(
  node: NodeEntity,
  entry: OverlayBridgeTargetState | undefined,
  guid: { sessionID: number; localID: number },
  parentGuid: { sessionID: number; localID: number },
  position: string,
  doc: ReturnType<typeof createEmptyFigDoc>,
): void {
  const inspection = entry?.inspection;
  const attributes = inspection?.attributes ?? {};
  const kind = attributes["data-design-tool-kind"];
  if (!kind) return;

  const parseJson = (raw: string | undefined): unknown => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  };

  const bounds = parseJson(attributes["data-design-tool-bounds"]) as Bounds | null;
  if (!bounds || typeof bounds.width !== "number" || typeof bounds.height !== "number") return;

  const fill = attributes["data-design-tool-fill"];
  const stroke = attributes["data-design-tool-stroke"];
  const strokeWidth = Number(attributes["data-design-tool-stroke-width"] || 2);
  const radius = Number(attributes["data-design-tool-radius"] || 0);
  const name = node.name || kind;

  if (kind === "rectangle") {
    doc.message.nodeChanges.push(baseNode(
      {
        cornerRadius: radius,
        rectangleTopLeftCornerRadius: radius,
        rectangleTopRightCornerRadius: radius,
        rectangleBottomLeftCornerRadius: radius,
        rectangleBottomRightCornerRadius: radius,
        ...(fillPaints(fill, "#d9d9d9") ? { fillPaints: fillPaints(fill, "#d9d9d9") as never } : {}),
        ...(() => {
          const st = strokePaints(stroke, strokeWidth);
          return {
            ...(st.strokePaints ? { strokePaints: st.strokePaints as never } : {}),
            strokeWeight: st.strokeWeight,
          };
        })(),
        strokeAlign: "INSIDE",
        strokeJoin: "MITER",
      },
      guid,
      name,
      "ROUNDED_RECTANGLE",
      parentGuid,
      position,
      bounds,
    ));
    return;
  }

  if (kind === "ellipse") {
    doc.message.nodeChanges.push(baseNode(
      {
        ...(fillPaints(fill, "#d9d9d9") ? { fillPaints: fillPaints(fill, "#d9d9d9") as never } : {}),
        ...(() => {
          const st = strokePaints(stroke, strokeWidth);
          return {
            ...(st.strokePaints ? { strokePaints: st.strokePaints as never } : {}),
            strokeWeight: st.strokeWeight,
          };
        })(),
        strokeAlign: "INSIDE",
        strokeJoin: "MITER",
      },
      guid,
      name,
      "ELLIPSE",
      parentGuid,
      position,
      bounds,
    ));
    return;
  }

  if (kind === "polygon" || kind === "star") {
    doc.message.nodeChanges.push(baseNode(
      {
        ...(kind === "polygon"
          ? { count: 5 }
          : { starInnerScale: 0.382 }),
        ...(fillPaints(fill, "#d9d9d9") ? { fillPaints: fillPaints(fill, "#d9d9d9") as never } : {}),
        ...(() => {
          const st = strokePaints(stroke, strokeWidth);
          return {
            ...(st.strokePaints ? { strokePaints: st.strokePaints as never } : {}),
            strokeWeight: st.strokeWeight,
          };
        })(),
        strokeAlign: "INSIDE",
        strokeJoin: "MITER",
      },
      guid,
      name,
      kind === "polygon" ? "REGULAR_POLYGON" : "STAR",
      parentGuid,
      position,
      bounds,
    ));
    return;
  }

  if (kind === "line") {
    const points = parseJson(attributes["data-design-tool-points"]) as Point[] | null;
    if (!Array.isArray(points) || points.length < 2) return;
    const start = points[0];
    const end = points[points.length - 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    doc.message.nodeChanges.push({
      guid,
      type: "LINE",
      name,
      phase: "CREATED",
      parentIndex: { guid: parentGuid, position },
      size: { x: length, y: 0 },
      transform: {
        m00: cosine,
        m01: -sine,
        m02: start.x,
        m10: sine,
        m11: cosine,
        m12: start.y,
      },
      visible: true,
      opacity: 1,
      blendMode: "PASS_THROUGH",
      ...(() => {
        const st = strokePaints(stroke ?? "#222222", strokeWidth);
        return {
          ...(st.strokePaints ? { strokePaints: st.strokePaints as never } : {}),
          strokeWeight: st.strokeWeight,
        };
      })(),
      strokeAlign: "CENTER",
      strokeCap: "ROUND",
      strokeJoin: "ROUND",
    });
    return;
  }

  if (kind === "arrow") {
    const points = parseJson(attributes["data-design-tool-points"]) as Point[] | null;
    if (!Array.isArray(points) || points.length < 2) return;
    const start = points[0];
    const end = points[points.length - 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return;
    const unitX = dx / length;
    const unitY = dy / length;
    const perpX = -unitY;
    const perpY = unitX;
    const halfWidth = Math.max(1, strokeWidth / 2);
    const headLength = Math.max(10, halfWidth * 6);
    const baseX = end.x - unitX * headLength;
    const baseY = end.y - unitY * headLength;
    const arrowWidth = halfWidth * 3;
    const local: Point[] = [
      { x: start.x + perpX * halfWidth, y: start.y + perpY * halfWidth },
      { x: start.x - perpX * halfWidth, y: start.y - perpY * halfWidth },
      { x: baseX - perpX * halfWidth, y: baseY - perpY * halfWidth },
      { x: baseX - perpX * arrowWidth, y: baseY - perpY * arrowWidth },
      { x: end.x, y: end.y },
      { x: baseX + perpX * arrowWidth, y: baseY + perpY * arrowWidth },
      { x: baseX + perpX * halfWidth, y: baseY + perpY * halfWidth },
    ];
    const minX = Math.min(...local.map((point) => point.x));
    const minY = Math.min(...local.map((point) => point.y));
    const maxX = Math.max(...local.map((point) => point.x));
    const maxY = Math.max(...local.map((point) => point.y));
    const arrowBounds = {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
    const commands = [
      { type: "M" as const, x: local[0].x - arrowBounds.x, y: local[0].y - arrowBounds.y },
      ...local.slice(1).map((point) => ({ type: "L" as const, x: point.x - arrowBounds.x, y: point.y - arrowBounds.y })),
      { type: "Z" as const },
    ];
    const payload = appendVectorPayloadToDocument(doc, {
      width: arrowBounds.width,
      height: arrowBounds.height,
      fillPaths: [{ commands }],
    });
    doc.message.nodeChanges.push(baseNode(
      {
        ...(fillPaints(stroke ?? "#222222", "#222222")
          ? { fillPaints: fillPaints(stroke ?? "#222222", "#222222") as never }
          : {}),
        ...payload,
      },
      guid,
      name,
      "VECTOR",
      parentGuid,
      position,
      arrowBounds,
    ));
    return;
  }

  if (kind === "text") {
    // Figma rejects empty text runs; a single space keeps the layer importable.
    const rawCharacters = inspection?.text ?? "";
    const characters = rawCharacters === "" ? " " : rawCharacters;
    doc.message.nodeChanges.push(baseNode(
      {
        textData: { characters },
        fontName: { family: "Inter", style: "Regular", postscript: "Inter-Regular" },
        styleIdForText: { guid: DETACH_STYLE_GUID },
        fontSize: 16,
        lineHeight: { value: 1.5, units: "RAW" },
        letterSpacing: { value: 0, units: "RAW" },
        textAlignHorizontal: "LEFT",
        textAlignVertical: "TOP",
        textAutoResize: "HEIGHT",
        ...(fillPaints(fill ?? "#171717", "#171717")
          ? { fillPaints: fillPaints(fill ?? "#171717", "#171717") as never }
          : {}),
        strokeWeight: 0,
        strokeAlign: "OUTSIDE",
        strokeJoin: "MITER",
        textTracking: 0,
      },
      guid,
      name,
      "TEXT",
      parentGuid,
      position,
      bounds,
    ));
    return;
  }

  // Images and legacy paths are not yet represented in the .fig export.
}

export async function serializeFigmaProject(input: FigmaExportInput): Promise<Uint8Array> {
  const doc = createEmptyFigDoc();
  const page = doc.nodes.find((node) => node.type === "CANVAS" && node.name === "Page 1");
  if (!page) throw new Error("The Figma template has no page canvas");

  const frames = [...input.frames].sort(
    (left, right) => left.pageId.localeCompare(right.pageId) || left.y - right.y || left.x - right.x,
  );

  const frameGuids = new Map<string, { sessionID: number; localID: number }>();
  let nextLocalId = 1;
  const allocate = () => ({ sessionID: 1, localID: nextLocalId++ });

  const documentNode = (doc.message.nodeChanges as unknown[]).find(
    (entry) => (entry as { type?: string }).type === "DOCUMENT",
  ) as unknown as Record<string, unknown> | undefined;
  if (documentNode && documentNode["documentColorProfile"] === undefined) {
    documentNode["documentColorProfile"] = "SRGB";
  }

  frames.forEach((frame, frameIndex) => {
    const guid = allocate();
    frameGuids.set(frame.id, guid);
    doc.message.nodeChanges.push({
      guid,
      type: "FRAME",
      name: frame.name,
      phase: "CREATED",
      parentIndex: { guid: page.guid, position: positionAt(frameIndex) },
      size: { x: frame.width, y: frame.height },
      transform: translateTransform(frame.x, frame.y),
      visible: true,
      opacity: 1,
      blendMode: "PASS_THROUGH",
      cornerRadius: 0,
      rectangleTopLeftCornerRadius: 0,
      rectangleTopRightCornerRadius: 0,
      rectangleBottomLeftCornerRadius: 0,
      rectangleBottomRightCornerRadius: 0,
      strokeWeight: 0,
      strokeAlign: "CENTER",
      strokeJoin: "MITER",
      frameMaskDisabled: false,
      ...(fillPaints(frame.background, "#ffffff")
        ? { fillPaints: fillPaints(frame.background, "#ffffff") as never }
        : {}),
    });
  });

  frames.forEach((frame) => {
    const frameGuid = frameGuids.get(frame.id);
    if (!frameGuid) return;
    const children = Object.values(input.nodes)
      .filter((node) => node.frameId === frame.id)
      .sort((left, right) => left.id.localeCompare(right.id));
    children.forEach((node, childIndex) => {
      convertShapeNode(
        node,
        input.bridgeTargets[`${frame.id}:${node.id}`],
        allocate(),
        frameGuid,
        positionAt(childIndex),
        doc,
      );
    });
  });

  // Real Figma exports always carry these envelope fields; the empty template omits them.
  const message = doc.message as unknown as Record<string, unknown>;
  if (message["sessionID"] === undefined) message["sessionID"] = 0;
  if (message["ackID"] === undefined) message["ackID"] = 0;
  if (!Array.isArray(message["blobs"])) message["blobs"] = [];

  const parts = encodeFigParts(doc);
  const zstd = await loadZstd();
  const messageCompressed = zstd.compress(parts.messageRaw, 3);
  const canvasFig = assembleCanvasFig({
    prelude: parts.prelude,
    version: parts.version,
    schemaCompressed: parts.schemaCompressed,
    messageCompressed,
    passThrough: parts.passThrough,
  });

  const exportedAt = new Date().toISOString();
  return createFigZip({
    canvasFig,
    meta: {
      client_meta: {
        background_color: { r: 1, g: 1, b: 1, a: 1 },
        thumbnail_size: { width: 320, height: 180 },
      },
      file_name: "brainstorm-session",
      developer_related_links: [],
      exported_at: exportedAt,
      version: "1",
    },
    thumbnail: base64ToBytes(THUMBNAIL_PNG_BASE64),
    images: new Map(),
  });
}
