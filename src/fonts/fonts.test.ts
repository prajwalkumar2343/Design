import { describe, expect, it } from "vitest";
import {
  FONT_CATALOG,
  FONT_CATEGORIES,
  FONT_FACES_MARKER,
  buildFontFaceCss,
  ensureCanvasFonts,
  fontFacesCssForFamilyValue,
  injectCanvasFonts,
  matchFontOption,
  primaryFontName,
  usedFontOptions,
} from "./index";

const DOC = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;

describe("font catalog", () => {
  it("bundles a curated OFL-licensed set — no generic-only entries", () => {
    expect(FONT_CATALOG.length).toBeGreaterThanOrEqual(15);
    for (const option of FONT_CATALOG) {
      expect(option.license).toBe("OFL-1.1");
      expect(FONT_CATEGORIES).toContain(option.category);
      expect(option.stack).toContain(`"${option.name}"`);
      expect(option.faces.length).toBeGreaterThan(0);
      for (const face of option.faces) {
        expect(face.src.startsWith("data:font/"), `${option.id} face must be an inline font payload`).toBe(true);
        expect(face.src.length).toBeGreaterThan(1000);
      }
    }
  });

  it("keeps ids unique and covers every category", () => {
    const ids = new Set(FONT_CATALOG.map((option) => option.id));
    expect(ids.size).toBe(FONT_CATALOG.length);
    for (const category of FONT_CATEGORIES) {
      expect(FONT_CATALOG.some((option) => option.category === category)).toBe(true);
    }
  });
});

describe("buildFontFaceCss", () => {
  it("emits one @font-face per face with family, style and weight", () => {
    const fraunces = FONT_CATALOG.find((option) => option.id === "fraunces")!;
    const css = buildFontFaceCss([fraunces]);
    expect(css.match(/@font-face/g)).toHaveLength(fraunces.faces.length);
    expect(css).toContain('font-family:"Fraunces"');
    expect(css).toContain("font-style:italic");
    expect(css).toContain('format("woff2")');
  });
});

describe("primaryFontName / matchFontOption", () => {
  it("reads the first family from a stack, quoted or not", () => {
    expect(primaryFontName('"Space Grotesk", ui-sans-serif, sans-serif')).toBe("Space Grotesk");
    expect(primaryFontName("Inter, sans-serif")).toBe("Inter");
    expect(primaryFontName("")).toBeNull();
    expect(primaryFontName(null)).toBeNull();
  });

  it("resolves catalog entries case-insensitively from a stack", () => {
    expect(matchFontOption('"Space Grotesk", ui-sans-serif, sans-serif')?.id).toBe("space-grotesk");
    expect(matchFontOption("syne, sans-serif")?.id).toBe("syne");
    expect(matchFontOption("Comic Sans MS, cursive")).toBeNull();
    expect(matchFontOption(null)).toBeNull();
  });
});

describe("injectCanvasFonts", () => {
  it("leaves documents that use no catalog fonts untouched", () => {
    const doc = DOC('<p style="font-family: monospace">hi</p>');
    expect(injectCanvasFonts(doc)).toBe(doc);
  });

  it("injects only the families the document names", () => {
    const doc = DOC('<h1 style="font-family: &quot;Fraunces&quot;, serif">Hi</h1>');
    const out = injectCanvasFonts(doc);
    expect(out).toContain(FONT_FACES_MARKER);
    expect(out).toContain('font-family:"Fraunces"');
    expect(out).not.toContain('font-family:"Sora"');
    expect(out).not.toContain('font-family:"Geist Mono"');
  });

  it("matches unquoted and single-quoted family references", () => {
    const doc = DOC("<p style=\"font-family: 'IBM Plex Mono', monospace\">x</p>");
    expect(injectCanvasFonts(doc)).toContain('font-family:"IBM Plex Mono"');
  });

  it("is idempotent", () => {
    const doc = DOC('<p style="font-family: Sora, sans-serif">x</p>');
    const once = injectCanvasFonts(doc);
    expect(injectCanvasFonts(once)).toBe(once);
  });
});

describe("usedFontOptions", () => {
  it("finds every catalog family present in the source", () => {
    const doc = DOC(
      '<p style="font-family: Sora">a</p><p style="font-family: &quot;Geist Mono&quot;">b</p>',
    );
    const names = usedFontOptions(doc).map((option) => option.id).sort();
    expect(names).toEqual(["geist-mono", "sora"]);
  });

  it("detects families declared through token css variables", () => {
    const doc = `<html><head><style>:root{--x-font-body:"Instrument Sans",sans-serif}</style></head><body><p>a</p></body></html>`;
    expect(usedFontOptions(doc).map((option) => option.id)).toEqual(["instrument-sans"]);
  });
});

describe("fontFacesCssForFamilyValue", () => {
  it("returns face css for catalog names in a committed stack", () => {
    const css = fontFacesCssForFamilyValue('"Fraunces", ui-serif, Georgia, serif');
    expect(css).toContain('@font-face{font-family:"Fraunces"');
    expect(css).toContain("data:font/woff2;base64,");
  });

  it("matches every catalog family in the stack, unquoted or quoted", () => {
    const css = fontFacesCssForFamilyValue("Geist Mono, Sora, monospace");
    expect(css).toContain('"Geist Mono"');
    expect(css).toContain('"Sora"');
  });

  it("returns null for off-catalog stacks and empty values", () => {
    expect(fontFacesCssForFamilyValue("Comic Sans MS, cursive")).toBeNull();
    expect(fontFacesCssForFamilyValue("")).toBeNull();
    expect(fontFacesCssForFamilyValue(null)).toBeNull();
  });

  it("emits no control characters so bridge payloads stay sendable", () => {
    const css = fontFacesCssForFamilyValue('"Sora", sans-serif');
    expect(css).not.toBeNull();
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u001f\u007f]/.test(css!)).toBe(false);
  });
});

describe("ensureCanvasFonts", () => {
  it("installs one style block with all faces, once", () => {
    const doc = new DOMParser().parseFromString(DOC(""), "text/html");
    ensureCanvasFonts(doc);
    ensureCanvasFonts(doc);
    const styles = doc.querySelectorAll(`style[${FONT_FACES_MARKER}]`);
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toContain('font-family:"Inter"');
    expect(styles[0]!.textContent).toContain('font-family:"Unbounded"');
  });
});
