import { injectBridgeRuntime } from "../bridge/inject";
import type { BridgeRuntimeConfig } from "../bridge/runtime";
import type { DocumentMode } from "../editor/model";
import { injectTokenTheme } from "./token-theme";
import { injectWireframeTheme } from "./wireframe-theme";

/**
 * Builds the iframe source while leaving canonical editor HTML untouched.
 * Token CSS applies to design mode only; wireframe frames keep the neutral
 * grayscale theme and never receive token variables.
 */
export function renderFrameDocument(
  srcDoc: string,
  mode: DocumentMode | undefined,
  bridgeSession: BridgeRuntimeConfig,
  tokenCss?: string,
): string {
  const themedSource = mode === "wireframe"
    ? injectWireframeTheme(srcDoc)
    : tokenCss
      ? injectTokenTheme(srcDoc, tokenCss)
      : srcDoc;
  return injectBridgeRuntime(themedSource, bridgeSession);
}
