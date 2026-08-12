function formatPixels(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** Adds a screen-space translation while preserving the current transform. */
export function prependTranslationTransform(
  currentTransform: string | null | undefined,
  delta: { x: number; y: number },
): string | null {
  const existing = currentTransform?.trim();
  const hasExisting = Boolean(existing && existing !== "none");
  if (Math.abs(delta.x) < 0.01 && Math.abs(delta.y) < 0.01) {
    return hasExisting ? existing! : null;
  }
  const translation = `translate(${formatPixels(delta.x)}px, ${formatPixels(delta.y)}px)`;
  return hasExisting ? `${translation} ${existing}` : translation;
}
