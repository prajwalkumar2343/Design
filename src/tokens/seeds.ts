/**
 * Seed token sets and themes: a neutral core scale plus light, dark, and one
 * brand theme. Used for fresh editor state and test fixtures.
 */
import type { DesignToken, TokenSet, TokenStoreState, TokenTheme } from "./model";

function token(
  id: string,
  name: string,
  type: DesignToken["type"],
  value: DesignToken["value"],
  description?: string,
): DesignToken {
  const entry: DesignToken = { id, name, type, value };
  if (description !== undefined) entry.description = description;
  return entry;
}

function setFromTokens(set: Omit<TokenSet, "tokens"> & { items: DesignToken[] }): TokenSet {
  const tokens: TokenSet["tokens"] = {};
  for (const item of set.items) tokens[item.id] = item;
  // Canonical key order (id, name, tokens, description?) matches
  // validateTokenSet so seeded state round-trips byte-identical.
  const { items: _items, description, ...rest } = set;
  return description === undefined ? { ...rest, tokens } : { ...rest, tokens, description };
}

const SANS = "Inter, ui-sans-serif, system-ui, sans-serif";

function coreSet(): TokenSet {
  return setFromTokens({
    id: "core",
    name: "Core",
    description: "Neutral scales shared by every theme.",
    items: [
      token("core-neutral-0", "color.neutral.0", "color", "#ffffff", "Brightest neutral."),
      token("core-neutral-100", "color.neutral.100", "color", "#f5f5f4"),
      token("core-neutral-200", "color.neutral.200", "color", "#e7e5e4"),
      token("core-neutral-400", "color.neutral.400", "color", "#a8a29e"),
      token("core-neutral-600", "color.neutral.600", "color", "#57534e"),
      token("core-neutral-900", "color.neutral.900", "color", "#1c1917"),
      token("core-space-2xs", "spacing.2xs", "spacing", "4px"),
      token("core-space-xs", "spacing.xs", "spacing", "8px"),
      token("core-space-sm", "spacing.sm", "spacing", "12px"),
      token("core-space-md", "spacing.md", "spacing", "16px"),
      token("core-space-lg", "spacing.lg", "spacing", "24px"),
      token("core-space-xl", "spacing.xl", "spacing", "32px"),
      token("core-space-2xl", "spacing.2xl", "spacing", "48px"),
      token("core-radius-sm", "radius.sm", "radius", "4px"),
      token("core-radius-md", "radius.md", "radius", "8px"),
      token("core-radius-lg", "radius.lg", "radius", "16px"),
      token("core-radius-full", "radius.full", "radius", "9999px"),
      token("core-shadow-sm", "shadow.sm", "shadow", "0 1px 2px rgba(0, 0, 0, 0.08)"),
      token("core-shadow-md", "shadow.md", "shadow", "0 4px 12px rgba(0, 0, 0, 0.12)"),
      token("core-shadow-lg", "shadow.lg", "shadow", "0 12px 32px rgba(0, 0, 0, 0.16)"),
      token("core-motion-quick", "motion.quick", "motion", { duration: "120ms", easing: "ease-out" }),
      token("core-motion-base", "motion.base", "motion", { duration: "200ms", easing: "ease-in-out" }),
      token("core-motion-slow", "motion.slow", "motion", { duration: "360ms", easing: "cubic-bezier(0.22, 1, 0.36, 1)" }),
      token("core-opacity-scrim", "opacity.scrim", "opacity", 0.5),
      token("core-opacity-disabled", "opacity.disabled", "opacity", 0.38),
      token("core-opacity-subtle", "opacity.subtle", "opacity", 0.72),
      token("core-type-body", "typography.body", "typography", { fontFamily: SANS, fontSize: "16px", fontWeight: "400", lineHeight: "1.5" }),
      token("core-type-heading", "typography.heading", "typography", { fontFamily: SANS, fontSize: "28px", fontWeight: "650", lineHeight: "1.2" }),
      token("core-type-caption", "typography.caption", "typography", { fontFamily: SANS, fontSize: "13px", fontWeight: "400", lineHeight: "1.4" }),
    ],
  });
}

function lightSet(): TokenSet {
  return setFromTokens({
    id: "light",
    name: "Light",
    description: "Daylight surfaces and ink.",
    items: [
      token("light-surface-base", "color.surface.base", "color", "#ffffff"),
      token("light-surface-raised", "color.surface.raised", "color", "#f5f5f4"),
      token("light-ink-primary", "color.ink.primary", "color", "#1c1917"),
      token("light-ink-secondary", "color.ink.secondary", "color", "#57534e"),
      token("light-accent-primary", "color.accent.primary", "color", "#3b74c2"),
      token("light-accent-on", "color.accent.on-accent", "color", "#ffffff"),
    ],
  });
}

function darkSet(): TokenSet {
  return setFromTokens({
    id: "dark",
    name: "Dark",
    description: "Low-light surfaces and ink.",
    items: [
      token("dark-surface-base", "color.surface.base", "color", "#1c1917"),
      token("dark-surface-raised", "color.surface.raised", "color", "#292524"),
      token("dark-ink-primary", "color.ink.primary", "color", "#fafaf9"),
      token("dark-ink-secondary", "color.ink.secondary", "color", "#d6d3d1"),
      token("dark-accent-primary", "color.accent.primary", "color", "#6faee0"),
      token("dark-accent-on", "color.accent.on-accent", "color", "#10233a"),
    ],
  });
}

function brandSet(): TokenSet {
  return setFromTokens({
    id: "brand",
    name: "Brand",
    description: "Brand overrides layered over the light theme.",
    items: [
      token("brand-accent-primary", "color.accent.primary", "color", "#e5484d", "Signature brand red."),
      token("brand-accent-on", "color.accent.on-accent", "color", "#ffffff"),
      token("brand-radius-md", "radius.md", "radius", "10px", "Brand uses a slightly softer corner."),
    ],
  });
}

function theme(id: string, name: string, setIds: string[], description: string): TokenTheme {
  return { id, name, setIds, description };
}

/** Seeded store with light, dark, and brand themes; light is active. */
export function createSeedTokenStore(): TokenStoreState {
  const sets: TokenStoreState["sets"] = {};
  for (const set of [coreSet(), lightSet(), darkSet(), brandSet()]) sets[set.id] = set;
  const themes: TokenStoreState["themes"] = {};
  for (const item of [
    theme("light", "Light", ["core", "light"], "Default daylight theme."),
    theme("dark", "Dark", ["core", "dark"], "Low-light theme."),
    theme("brand", "Brand", ["core", "light", "brand"], "Light theme with brand overrides."),
  ]) {
    themes[item.id] = item;
  }
  return { sets, themes, activeThemeId: "light", revision: 0 };
}
