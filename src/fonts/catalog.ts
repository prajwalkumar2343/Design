/**
 * Curated canvas font catalog.
 *
 * Every family ships inside the project as a Fontsource package under the
 * SIL Open Font License 1.1 (each package carries its LICENSE file), so the
 * fonts are legally bundled — no CDN, no generic system stacks. Files are
 * imported as `?inline` data URIs so they can be embedded directly into the
 * sandboxed `srcDoc` frame documents (an opaque-origin iframe cannot fetch
 * app-origin font files due to font-CORS rules; data URIs always work).
 */
import bricolageGrotesqueWght from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?inline";
import frauncesWght from "@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2?inline";
import frauncesWghtItalic from "@fontsource-variable/fraunces/files/fraunces-latin-wght-italic.woff2?inline";
import geistWght from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline";
import geistMonoWght from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?inline";
import instrumentSansWght from "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?inline";
import interWght from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline";
import jetbrainsMonoWght from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?inline";
import manropeWght from "@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2?inline";
import newsreaderWght from "@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2?inline";
import newsreaderWghtItalic from "@fontsource-variable/newsreader/files/newsreader-latin-wght-italic.woff2?inline";
import outfitWght from "@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2?inline";
import playfairDisplayWght from "@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2?inline";
import playfairDisplayWghtItalic from "@fontsource-variable/playfair-display/files/playfair-display-latin-wght-italic.woff2?inline";
import plusJakartaSansWght from "@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2?inline";
import soraWght from "@fontsource-variable/sora/files/sora-latin-wght-normal.woff2?inline";
import sourceSerif4Wght from "@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2?inline";
import sourceSerif4WghtItalic from "@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-italic.woff2?inline";
import spaceGroteskWght from "@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?inline";
import syneWght from "@fontsource-variable/syne/files/syne-latin-wght-normal.woff2?inline";
import unboundedWght from "@fontsource-variable/unbounded/files/unbounded-latin-wght-normal.woff2?inline";
import urbanistWght from "@fontsource-variable/urbanist/files/urbanist-latin-wght-normal.woff2?inline";
import dmSerifDisplay400 from "@fontsource/dm-serif-display/files/dm-serif-display-latin-400-normal.woff2?inline";
import dmSerifDisplay400Italic from "@fontsource/dm-serif-display/files/dm-serif-display-latin-400-italic.woff2?inline";
import ibmPlexMono400 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?inline";
import ibmPlexMono700 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2?inline";
import instrumentSerif400 from "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2?inline";
import instrumentSerif400Italic from "@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2?inline";
import spaceMono400 from "@fontsource/space-mono/files/space-mono-latin-400-normal.woff2?inline";
import spaceMono700 from "@fontsource/space-mono/files/space-mono-latin-700-normal.woff2?inline";

export type FontCategory = "Sans" | "Serif" | "Mono" | "Display";

export interface FontFaceSource {
  /** `data:` URI of the woff2 payload. */
  src: string;
  /** @font-face weight descriptor — a "min max" range for variable files. */
  weight: string;
  style: "normal" | "italic";
}

export interface FontOption {
  id: string;
  /** Exact family name declared by the generated @font-face rules. */
  name: string;
  /** Full font-family value committed to node styles (name + fallbacks). */
  stack: string;
  category: FontCategory;
  license: "OFL-1.1";
  faces: FontFaceSource[];
}

const SANS_FALLBACK = "ui-sans-serif, system-ui, sans-serif";
const SERIF_FALLBACK = "ui-serif, Georgia, serif";
const MONO_FALLBACK = 'ui-monospace, "SF Mono", monospace';

function option(
  id: string,
  name: string,
  category: FontCategory,
  fallback: string,
  faces: FontFaceSource[],
): FontOption {
  return { id, name, category, license: "OFL-1.1", stack: `"${name}", ${fallback}`, faces };
}

const variable = (src: string, weight: string, style: "normal" | "italic" = "normal"): FontFaceSource => ({ src, weight, style });
const staticFace = (src: string, weight: string, style: "normal" | "italic" = "normal"): FontFaceSource => ({ src, weight, style });

/** Order within a category is the order shown in the picker. */
export const FONT_CATALOG: FontOption[] = [
  option("inter", "Inter", "Sans", SANS_FALLBACK, [variable(interWght, "100 900")]),
  option("geist", "Geist", "Sans", SANS_FALLBACK, [variable(geistWght, "100 900")]),
  option("instrument-sans", "Instrument Sans", "Sans", SANS_FALLBACK, [variable(instrumentSansWght, "400 700")]),
  option("space-grotesk", "Space Grotesk", "Sans", SANS_FALLBACK, [variable(spaceGroteskWght, "300 700")]),
  option("bricolage-grotesque", "Bricolage Grotesque", "Sans", SANS_FALLBACK, [variable(bricolageGrotesqueWght, "200 800")]),
  option("sora", "Sora", "Sans", SANS_FALLBACK, [variable(soraWght, "100 800")]),
  option("manrope", "Manrope", "Sans", SANS_FALLBACK, [variable(manropeWght, "200 800")]),
  option("outfit", "Outfit", "Sans", SANS_FALLBACK, [variable(outfitWght, "100 900")]),
  option("plus-jakarta-sans", "Plus Jakarta Sans", "Sans", SANS_FALLBACK, [variable(plusJakartaSansWght, "200 800")]),
  option("urbanist", "Urbanist", "Sans", SANS_FALLBACK, [variable(urbanistWght, "100 900")]),
  option("instrument-serif", "Instrument Serif", "Serif", SERIF_FALLBACK, [
    staticFace(instrumentSerif400, "400"),
    staticFace(instrumentSerif400Italic, "400", "italic"),
  ]),
  option("fraunces", "Fraunces", "Serif", SERIF_FALLBACK, [
    variable(frauncesWght, "100 900"),
    variable(frauncesWghtItalic, "100 900", "italic"),
  ]),
  option("newsreader", "Newsreader", "Serif", SERIF_FALLBACK, [
    variable(newsreaderWght, "200 800"),
    variable(newsreaderWghtItalic, "200 800", "italic"),
  ]),
  option("source-serif-4", "Source Serif 4", "Serif", SERIF_FALLBACK, [
    variable(sourceSerif4Wght, "200 900"),
    variable(sourceSerif4WghtItalic, "200 900", "italic"),
  ]),
  option("playfair-display", "Playfair Display", "Serif", SERIF_FALLBACK, [
    variable(playfairDisplayWght, "400 900"),
    variable(playfairDisplayWghtItalic, "400 900", "italic"),
  ]),
  option("dm-serif-display", "DM Serif Display", "Serif", SERIF_FALLBACK, [
    staticFace(dmSerifDisplay400, "400"),
    staticFace(dmSerifDisplay400Italic, "400", "italic"),
  ]),
  option("geist-mono", "Geist Mono", "Mono", MONO_FALLBACK, [variable(geistMonoWght, "100 900")]),
  option("jetbrains-mono", "JetBrains Mono", "Mono", MONO_FALLBACK, [variable(jetbrainsMonoWght, "100 800")]),
  option("ibm-plex-mono", "IBM Plex Mono", "Mono", MONO_FALLBACK, [
    staticFace(ibmPlexMono400, "400"),
    staticFace(ibmPlexMono700, "700"),
  ]),
  option("space-mono", "Space Mono", "Mono", MONO_FALLBACK, [
    staticFace(spaceMono400, "400"),
    staticFace(spaceMono700, "700"),
  ]),
  option("unbounded", "Unbounded", "Display", SANS_FALLBACK, [variable(unboundedWght, "200 900")]),
  option("syne", "Syne", "Display", SANS_FALLBACK, [variable(syneWght, "400 800")]),
];

export const FONT_CATEGORIES: FontCategory[] = ["Sans", "Serif", "Mono", "Display"];

/**
 * First family of a CSS font-family list, unquoted — `"Space Grotesk",
 * ui-sans-serif` → `Space Grotesk`. Null when the value is empty.
 */
export function primaryFontName(fontFamily: string | null | undefined): string | null {
  if (!fontFamily) return null;
  const first = fontFamily.split(",")[0]?.trim() ?? "";
  const unquoted = first.replace(/^["']+|["']+$/g, "").trim();
  return unquoted.length > 0 ? unquoted : null;
}

/** Catalog entry matching the primary family of a font-family value. */
export function matchFontOption(fontFamily: string | null | undefined): FontOption | null {
  const primary = primaryFontName(fontFamily);
  if (!primary) return null;
  const needle = primary.toLowerCase();
  return FONT_CATALOG.find((option) => option.name.toLowerCase() === needle) ?? null;
}
