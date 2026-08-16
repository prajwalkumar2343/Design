import { injectBridgeRuntime } from "../bridge/inject";
import type { BridgeRuntimeConfig } from "../bridge/runtime";
import type { DocumentMode } from "../editor/model";
import { injectWireframeTheme } from "./wireframe-theme";

/** Builds the iframe source while leaving canonical editor HTML untouched. */
export function renderFrameDocument(
  srcDoc: string,
  mode: DocumentMode | undefined,
  bridgeSession: BridgeRuntimeConfig,
): string {
  const themedSource = mode === "wireframe" ? injectWireframeTheme(srcDoc) : srcDoc;
  return injectBridgeRuntime(themedSource, bridgeSession);
}
