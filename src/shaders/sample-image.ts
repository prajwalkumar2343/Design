import shaderFilterSampleUrl from "../assets/shader-filter-sample.jpg?url";
import type { ShaderId } from "./registry";

/**
 * Paper Shaders that filter a source image render nothing without one, so
 * they mount with a bundled sample. The same props back the gallery
 * thumbnail, the hover preview, and the placed canvas element — the snapshot
 * is exactly what placement produces.
 */
const IMAGE_FILTER_MOUNT_PROPS = Object.freeze({ image: shaderFilterSampleUrl });
const NO_MOUNT_PROPS = Object.freeze({});

const IMAGE_FILTER_SHADER_IDS: ReadonlySet<ShaderId> = new Set([
  "fluted-glass",
  "heatmap",
  "image-dithering",
  "lens-distortion",
]);

export function getShaderMountProps(shaderId: ShaderId): Readonly<Record<string, unknown>> {
  return IMAGE_FILTER_SHADER_IDS.has(shaderId) ? IMAGE_FILTER_MOUNT_PROPS : NO_MOUNT_PROPS;
}
