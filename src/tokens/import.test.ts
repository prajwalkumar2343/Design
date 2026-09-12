import { describe, expect, it } from "vitest";
import { buildImportedTokenSet, parseDTCGTokens } from "./import";
import { validateTokenSet } from "./validation";

const SAMPLE = JSON.stringify({
  $meta: { name: "Marketing" },
  color: {
    $type: "color",
    brand: {
      primary: { $value: "#e5484d", $description: "Signature red." },
      hover: { $value: "{color.brand.primary}" },
    },
    surface: { $value: "#ffffff" },
  },
  spacing: {
    $type: "dimension",
    md: { $value: "16px" },
    gutter: { $value: "24px" },
  },
  radius: {
    $type: "dimension",
    md: { $value: "8px" },
  },
  typography: {
    $type: "typography",
    body: {
      $value: { fontFamily: "Inter", fontSize: "16px", fontWeight: "400", lineHeight: "1.5" },
    },
  },
  motion: {
    $type: "transition",
    base: { $value: { duration: "200ms", timingFunction: "ease-out" } },
  },
  shadow: {
    $type: "shadow",
    card: { $value: "0 4px 12px rgba(0,0,0,0.12)" },
  },
  opacity: {
    $type: "opacity",
    dim: { $value: 0.4 },
  },
});

describe("parseDTCGTokens", () => {
  it("flattens nested DTCG groups into dot-path tokens", () => {
    const { tokens, name, warnings } = parseDTCGTokens(SAMPLE);
    expect(name).toBe("Marketing");
    expect(warnings).toEqual([]);
    const byName = new Map(tokens.map((token) => [token.name, token]));
    expect(byName.get("color.brand.primary")).toMatchObject({ type: "color", value: "#e5484d" });
    expect(byName.get("color.brand.primary")?.description).toBe("Signature red.");
    expect(byName.get("spacing.md")).toMatchObject({ type: "spacing", value: "16px" });
    expect(byName.get("radius.md")).toMatchObject({ type: "radius", value: "8px" });
    expect(byName.get("typography.body")?.value).toMatchObject({ fontFamily: "Inter", fontSize: "16px" });
    expect(byName.get("motion.base")?.value).toEqual({ duration: "200ms", easing: "ease-out" });
    expect(byName.get("opacity.dim")).toMatchObject({ type: "opacity", value: 0.4 });
    expect(byName.get("shadow.card")).toMatchObject({ type: "shadow" });
  });

  it("keeps {path} alias values intact", () => {
    const { tokens } = parseDTCGTokens(SAMPLE);
    const alias = tokens.find((token) => token.name === "color.brand.hover");
    expect(alias?.value).toBe("{color.brand.primary}");
    expect(alias?.type).toBe("color");
  });

  it("accepts legacy non-$ keys and infers types", () => {
    const legacy = JSON.stringify({
      color: { brand: { value: "#112233", type: "color" } },
      space: { md: { value: "12px" } },
    });
    const { tokens } = parseDTCGTokens(legacy);
    const byName = new Map(tokens.map((token) => [token.name, token]));
    expect(byName.get("color.brand")).toMatchObject({ type: "color", value: "#112233" });
    expect(byName.get("space.md")?.type).toBe("spacing");
  });

  it("skips invalid entries with warnings instead of failing", () => {
    const doc = JSON.stringify({
      color: {
        $type: "color",
        good: { $value: "#ffffff" },
        bad: { $value: "not a color!!" },
      },
    });
    const { tokens, warnings } = parseDTCGTokens(doc);
    expect(tokens.map((token) => token.name)).toEqual(["color.good"]);
    expect(warnings.some((warning) => warning.includes("color.bad"))).toBe(true);
  });

  it("rejects non-JSON and empty documents", () => {
    expect(() => parseDTCGTokens("")).toThrowError(/empty/);
    expect(() => parseDTCGTokens("not json")).toThrowError(/JSON/);
    expect(() => parseDTCGTokens("[]")).toThrowError(/object/);
    expect(() => parseDTCGTokens("{}")).toThrowError(/no \$value|No tokens/i);
  });
});

describe("buildImportedTokenSet", () => {
  it("produces a valid set with collision-free ids", () => {
    const imported = parseDTCGTokens(SAMPLE);
    const set = buildImportedTokenSet(imported, new Set());
    expect(() => validateTokenSet(set, "imported")).not.toThrow();
    expect(set.id).toBe("marketing");
    expect(Object.keys(set.tokens)).toHaveLength(imported.tokens.length);

    const second = buildImportedTokenSet(imported, new Set(["marketing"]));
    expect(second.id).toBe("marketing-2");
  });
});
