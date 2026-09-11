/**
 * Token file exports: W3C DTCG JSON plus a CSS variables file.
 * Both derive from the resolved active theme so exports match the canvas.
 */
import { buildTokenCssFile, serializeDTCGDocument, type TokenStoreState } from "../tokens";

export interface TokenExportFile {
  filename: string;
  text: string;
  mimeType: string;
}

export function buildDTCGExportFile(store: TokenStoreState): TokenExportFile {
  return {
    filename: "tokens.json",
    text: serializeDTCGDocument(store),
    mimeType: "application/json",
  };
}

export function buildTokenCssExportFile(store: TokenStoreState): TokenExportFile {
  const theme = store.activeThemeId ? store.themes[store.activeThemeId] : undefined;
  return {
    filename: "tokens.css",
    text: buildTokenCssFile(store, theme?.name),
    mimeType: "text/css;charset=utf-8",
  };
}

/** True when the store holds anything worth exporting. */
export function hasExportableTokens(store: TokenStoreState): boolean {
  return Object.keys(store.sets).length > 0;
}
