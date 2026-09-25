import { describe, expect, it } from "vitest";
import { buildTokenCssFile, serializeDTCGDocument } from "./css";
import { createEmptyTokenStore } from "./model";
import type { DesignToken, TokenStoreState } from "./model";

function storeWith(tokens: DesignToken[]): TokenStoreState {
  return {
    sets: {
      s: {
        id: "s",
        name: "S",
        tokens: Object.fromEntries(tokens.map((token) => [token.id, token])),
      },
    },
    themes: { t: { id: "t", name: "Theme T", setIds: ["s"] } },
    activeThemeId: "t",
    revision: 0,
  };
}

const STORE = storeWith([
  { id: "a", name: "color.accent", type: "color", value: "#e5484d" },
  { id: "b", name: "motion.base", type: "motion", value: { duration: "200ms", easing: "ease-out" } },
  {
    id: "c",
    name: "typography.body",
    type: "typography",
    value: { fontFamily: "Inter", fontSize: "16px" },
  },
]);

describe("buildTokenCssFile", () => {
  it("prepends the generated header and sorts declarations by token name", () => {
    expect(buildTokenCssFile(STORE)).toBe(
      "/* Canvas design tokens: t (generated, do not edit by hand) */\n" +
        ":root {\n" +
        "  --color-accent: #e5484d;\n" +
        "  --motion-base-duration: 200ms;\n" +
        "  --motion-base-easing: ease-out;\n" +
        "  --typography-body-font-family: Inter;\n" +
        "  --typography-body-font-size: 16px;\n" +
        "}\n",
    );
  });

  it("honours an explicit label and degenerates to a bare header without a theme", () => {
    expect(buildTokenCssFile(STORE, "Docs")).toContain(
      "/* Canvas design tokens: Docs (generated, do not edit by hand) */",
    );
    expect(buildTokenCssFile(createEmptyTokenStore())).toBe(
      "/* Canvas design tokens: tokens (generated, do not edit by hand) */\n",
    );
  });
});

describe("serializeDTCGDocument", () => {
  it("serializes the grouped document with a trailing newline", () => {
    const store = storeWith([
      { id: "a", name: "color.accent", type: "color", value: "#e5484d", description: "Accent." },
      {
        id: "b",
        name: "motion.base",
        type: "motion",
        value: { duration: "200ms", easing: "ease-out" },
      },
    ]);
    expect(serializeDTCGDocument(store)).toBe(`{
  "$meta": {
    "theme": "Theme T",
    "generatedBy": "agent-native-design-canvas tokens"
  },
  "color": {
    "accent": {
      "$value": "#e5484d",
      "$type": "color",
      "description": "Accent."
    }
  },
  "motion": {
    "base": {
      "$value": {
        "duration": "200ms",
        "timingFunction": "ease-out"
      },
      "$type": "transition"
    }
  }
}
`);
  });

  it("emits an empty object for a store without an active theme", () => {
    expect(serializeDTCGDocument(createEmptyTokenStore())).toBe("{}\n");
  });
});
