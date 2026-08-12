import { BRIDGE_RUNTIME_MARKER, createBridgeRuntimeSource, type BridgeRuntimeConfig } from "./runtime";

function bridgeScript(config: BridgeRuntimeConfig): string {
  return `<script ${BRIDGE_RUNTIME_MARKER}="1">${createBridgeRuntimeSource(config)}</script>`;
}

/** Injects once into arbitrary HTML without changing the iframe sandbox policy. */
export function injectBridgeRuntime(srcDoc: string, config: BridgeRuntimeConfig): string {
  const markerPattern = new RegExp(
    `<script\\b[^>]*\\b${BRIDGE_RUNTIME_MARKER}\\s*=`,
    "i",
  );
  if (markerPattern.test(srcDoc)) {
    return srcDoc;
  }

  const script = bridgeScript(config);
  const headOpen = /<head\b[^>]*>/i.exec(srcDoc);
  if (headOpen && headOpen.index !== undefined) {
    const insertionPoint = headOpen.index + headOpen[0].length;
    return `${srcDoc.slice(0, insertionPoint)}${script}${srcDoc.slice(insertionPoint)}`;
  }

  const htmlOpen = /<html\b[^>]*>/i.exec(srcDoc);
  if (htmlOpen && htmlOpen.index !== undefined) {
    const insertionPoint = htmlOpen.index + htmlOpen[0].length;
    return `${srcDoc.slice(0, insertionPoint)}<head>${script}</head>${srcDoc.slice(insertionPoint)}`;
  }

  return `${script}${srcDoc}`;
}
