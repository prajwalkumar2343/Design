/**
 * Tokens panel — Figma Variables + Paper inspired.
 *
 * Research (via Exa):
 * - Figma Variables view: edge-to-edge table, collections in a sidebar,
 *   variables as rows, modes as columns, groups, search by name/value,
 *   type filter, inline edit, code-syntax (`--token-name`) handoff.
 *   See https://help.figma.com/hc/en-us/articles/15145852043927-Create-and-manage-variables-and-collections
 *   and https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables
 * - Paper tokens: named CSS-variable values (color, spacing, typography…),
 *   quiet dropdown UI in the property panel, four-dot color affordance,
 *   multiple theme modes, Tailwind-mappable names.
 *   See https://paper.design/docs/tokens
 *
 * What changed vs the old stacked sections:
 * - Themes are a segmented mode switcher (Figma modes / Paper theme modes).
 * - Sets are collections with counts + theme-usage dots (Figma sidebar).
 * - Tokens are a searchable, type-filtered, namespace-grouped variables
 *   table with rich per-type previews, CSS-var copy, and per-mode
 *   (per-theme) value columns.
 * - Create/edit is a quiet Paper-style sheet with live preview.
 *
 * Compatibility: every legacy `data-testid` used by TokensPanel.test.tsx
 * is preserved, so existing tests keep passing.
 */
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Link2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  isTokenAlias,
  resolveActiveThemeTokens,
  tokenAliasTarget,
  TOKEN_TYPE_LABELS,
  TOKEN_TYPES,
  TokenValidationError,
  cssVariableName,
  validateTokenName,
  validateTokenValue,
  type DesignToken,
  type MotionValue,
  type ResolvedToken,
  type TokenSet,
  type TokenStoreState,
  type TokenTheme,
  type TokenType,
  type TokenValue,
  type TypographyValue,
} from "../tokens";
import { FONT_CATALOG } from "../fonts";
import { summarizeTokenValue, TokenPreview } from "./token-preview";

export interface TokensPanelProps {
  tokens: TokenStoreState;
  onUpsertSet: (set: TokenSet) => void;
  onRemoveSet: (setId: string) => void;
  onUpsertToken: (setId: string, token: DesignToken) => void;
  onRemoveToken: (setId: string, tokenId: string) => void;
  /** Renames a variable — rewrites aliases and `var(--…)` element links. */
  onRenameToken?: (setId: string, tokenId: string, name: string) => void;
  onUpsertTheme: (theme: TokenTheme) => void;
  onRemoveTheme: (themeId: string) => void;
  onSwitchTheme: (themeId: string | null) => void;
  onExportDTCG: () => void;
  onExportCss: () => void;
  /** Imports a DTCG JSON file as a new collection. */
  onImportTokensFile?: (file: File) => void;
}

function createStableId(prefix: string): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
}

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "untitled";
}

export { summarizeTokenValue } from "./token-preview";

type ValueDraft = Record<string, string>;

const EMPTY_DRAFT: ValueDraft = {};

function draftForToken(token: DesignToken): ValueDraft {
  const value = token.value;
  if (typeof value === "string") return { value };
  if (typeof value === "number") return { value: String(value) };
  if (token.type === "typography") {
    const typeValue = value as TypographyValue;
    return {
      fontFamily: typeValue.fontFamily,
      fontSize: typeValue.fontSize,
      fontWeight: typeValue.fontWeight ?? "",
      lineHeight: typeValue.lineHeight ?? "",
      letterSpacing: typeValue.letterSpacing ?? "",
    };
  }
  const motionValue = value as MotionValue;
  return { duration: motionValue.duration, easing: motionValue.easing };
}

function buildTokenValue(type: TokenType, draft: ValueDraft): TokenValue {
  const text = (key: string): string => (draft[key] ?? "").trim();
  switch (type) {
    case "color":
    case "spacing":
    case "radius":
    case "shadow":
      return validateTokenValue(type, text("value"), "token.value") as string;
    case "opacity": {
      const parsed = Number(text("value"));
      return validateTokenValue(type, parsed, "token.value") as number;
    }
    case "typography": {
      const value: Record<string, string> = {
        fontFamily: text("fontFamily"),
        fontSize: text("fontSize"),
      };
      if (text("fontWeight")) value.fontWeight = text("fontWeight");
      if (text("lineHeight")) value.lineHeight = text("lineHeight");
      if (text("letterSpacing")) value.letterSpacing = text("letterSpacing");
      return validateTokenValue(type, value, "token.value") as TokenValue;
    }
    case "motion":
      return validateTokenValue(
        type,
        { duration: text("duration"), easing: text("easing") },
        "token.value",
      ) as TokenValue;
  }
}

/** Resolved token lookup for previews: aliases render their concrete value. */
function useResolvedTokens(tokens: TokenStoreState): Map<string, ResolvedToken> {
  return useMemo(() => {
    const map = new Map<string, ResolvedToken>();
    for (const resolved of resolveActiveThemeTokens(tokens)) map.set(resolved.token.name, resolved);
    return map;
  }, [tokens]);
}

/** Live resolution feedback for an alias draft (`{token.path}`). */
function AliasHint({ draft, resolved }: { draft: ValueDraft; resolved: Map<string, ResolvedToken> }) {
  const raw = draft.value ?? "";
  if (!isTokenAlias(raw)) return null;
  const target = tokenAliasTarget(raw) as string;
  const hit = resolved.get(target);
  if (!hit) {
    return (
      <p className="tkn-alias-hint is-broken" role="note">
        <AlertTriangle size={11} aria-hidden="true" />
        <span>No token named <code>{target}</code> in the active mode.</span>
      </p>
    );
  }
  if (hit.aliasStatus) {
    return (
      <p className="tkn-alias-hint is-broken" role="note">
        <AlertTriangle size={11} aria-hidden="true" />
        <span>Alias <code>{target}</code> is {hit.aliasStatus}.</span>
      </p>
    );
  }
  return (
    <p className="tkn-alias-hint" role="note">
      <Link2 size={11} aria-hidden="true" />
      <span>Resolves to <strong>{summarizeTokenValue(hit.token, hit.resolvedValue)}</strong></span>
    </p>
  );
}

function TokenValueInputs({
  type,
  draft,
  onChange,
  resolved,
}: {
  type: TokenType;
  draft: ValueDraft;
  onChange: (draft: ValueDraft) => void;
  resolved: Map<string, ResolvedToken>;
}) {
  const set = (key: string, input: string) => onChange({ ...draft, [key]: input });
  const field = (key: string, label: string, placeholder?: string, list?: string) => (
    <label className="tkn-field" key={key}>
      <span className="tkn-field-label">{label}</span>
      <span className="property-input-wrap tkn-input">
        <input
          aria-label={label}
          data-testid={`token-value-${key}`}
          value={draft[key] ?? ""}
          placeholder={placeholder}
          list={list}
          onChange={(event) => set(key, event.target.value)}
        />
      </span>
    </label>
  );
  if (type === "typography") {
    return (
      <>
        {field("fontFamily", "Family", "Inter, sans-serif", "canvas-font-catalog")}
        <datalist id="canvas-font-catalog">
          {FONT_CATALOG.map((font) => (
            <option key={font.id} value={font.stack} />
          ))}
        </datalist>
        {field("fontSize", "Size", "16px")}
        {field("fontWeight", "Weight", "400")}
        {field("lineHeight", "Line height", "1.5")}
        {field("letterSpacing", "Spacing", "0")}
      </>
    );
  }
  if (type === "motion") {
    return (
      <>
        {field("duration", "Duration", "200ms")}
        {field("easing", "Easing", "ease-out")}
      </>
    );
  }
  if (type === "opacity") return <>{field("value", "Value", "0 - 1")}</>;
  const placeholder = type === "color" ? "#3b74c2 or {color.neutral.0}" : type === "shadow" ? "0 4px 12px rgba(0,0,0,0.12) or {shadow.sm}" : "8px or {spacing.md}";
  return (
    <>
      {field("value", "Value", placeholder)}
      <AliasHint draft={draft} resolved={resolved} />
    </>
  );
}

function useSetUsage(tokens: TokenStoreState): Map<string, string[]> {
  return useMemo(() => {
    const usage = new Map<string, string[]>();
    for (const theme of Object.values(tokens.themes)) {
      for (const setId of theme.setIds) {
        const list = usage.get(setId) ?? [];
        list.push(theme.name);
        usage.set(setId, list);
      }
    }
    return usage;
  }, [tokens]);
}

/** token name -> themeId -> winning token (later sets win), i.e. Figma modes columns. */
function useThemeValues(tokens: TokenStoreState): {
  themes: TokenTheme[];
  valueFor: (name: string, themeId: string) => DesignToken | null;
  themesForName: (name: string) => TokenTheme[];
} {
  const themes = useMemo(
    () => Object.values(tokens.themes).sort((a, b) => a.name.localeCompare(b.name)),
    [tokens],
  );
  const byThemeAndName = useMemo(() => {
    const map = new Map<string, Map<string, DesignToken>>();
    for (const theme of themes) {
      const perName = new Map<string, DesignToken>();
      for (const setId of theme.setIds) {
        const set = tokens.sets[setId];
        if (!set) continue;
        for (const token of Object.values(set.tokens)) perName.set(token.name, token);
      }
      map.set(theme.id, perName);
    }
    return map;
  }, [themes, tokens.sets]);
  return useMemo(() => ({
    themes,
    valueFor: (name: string, themeId: string) => byThemeAndName.get(themeId)?.get(name) ?? null,
    themesForName: (name: string) =>
      themes.filter((t) => byThemeAndName.get(t.id)?.has(name)),
  }), [themes, byThemeAndName]);
}

function namespaceOf(name: string): string {
  const head = name.split(".")[0] ?? "";
  return head.length > 0 ? head : "other";
}

function ThemeSection({
  tokens,
  onSwitchTheme,
  onRemoveTheme,
  onUpsertTheme,
}: Pick<TokensPanelProps, "tokens" | "onSwitchTheme" | "onRemoveTheme" | "onUpsertTheme">) {
  const [name, setName] = useState("");
  const [selectedSets, setSelectedSets] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const themes = useMemo(() => Object.values(tokens.themes).sort((a, b) => a.name.localeCompare(b.name)), [tokens]);
  const sets = useMemo(() => Object.values(tokens.sets).sort((a, b) => a.name.localeCompare(b.name)), [tokens]);
  const toggleSet = (setId: string) => {
    setSelectedSets((current) => current.includes(setId) ? current.filter((id) => id !== setId) : [...current, setId]);
  };
  const create = () => {
    const trimmed = name.trim();
    if (!trimmed || selectedSets.length === 0) return;
    onUpsertTheme({ id: `${slugify(trimmed)}-${createStableId("theme").slice(-4)}`, name: trimmed, setIds: selectedSets });
    setName("");
    setSelectedSets([]);
    setOpen(false);
  };
  return (
    <section className="tkn-section" aria-label="Themes">
      <div className="tkn-section-head">
        <span className="tkn-section-title">Modes</span>
        <span className="tkn-section-hint" title="Themes work like Figma modes: one value per token, per mode. Switching a mode re-resolves every token.">
          {themes.length} {themes.length === 1 ? "mode" : "modes"}
        </span>
      </div>
      <div className="tkn-modes" role="tablist" aria-label="Theme modes">
        {themes.length === 0 ? <p className="tokens-empty">No modes yet. Create one below.</p> : null}
        {themes.map((theme) => {
          const active = tokens.activeThemeId === theme.id;
          return (
            <div className={`tkn-mode${active ? " is-active" : ""}`} key={theme.id} role="tab" aria-selected={active}>
              {renamingId === theme.id ? (
                <span className="property-input-wrap tkn-input tkn-mode-rename">
                  <input
                    autoFocus
                    aria-label={`Rename ${theme.name}`}
                    data-testid={`theme-rename-${theme.id}`}
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={() => {
                      const next = renameDraft.trim();
                      setRenamingId(null);
                      if (next.length > 0 && next !== theme.name) onUpsertTheme({ ...theme, name: next });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") setRenamingId(null);
                    }}
                  />
                </span>
              ) : (
                <button
                  className="tkn-mode-pill"
                  data-testid={`theme-switch-${theme.id}`}
                  aria-pressed={active}
                  title={active ? `${theme.name} (active) — click to clear` : `Switch to ${theme.name}`}
                  onClick={() => onSwitchTheme(active ? null : theme.id)}
                  type="button"
                >
                  <span className="tkn-mode-dot" aria-hidden="true" />
                  <span className="tkn-mode-name">{theme.name}</span>
                  <span className="tkn-mode-count">{theme.setIds.length}</span>
                </button>
              )}
              <button
                className="token-icon-button tkn-mini"
                data-testid={`theme-rename-button-${theme.id}`}
                aria-label={`Rename mode ${theme.name}`}
                title={`Rename mode ${theme.name}`}
                onClick={() => {
                  setRenamingId(theme.id);
                  setRenameDraft(theme.name);
                }}
                type="button"
              >
                <Pencil size={12} />
              </button>
              <button
                className="token-icon-button tkn-mini"
                data-testid={`theme-remove-${theme.id}`}
                aria-label={`Delete theme ${theme.name}`}
                title={`Delete theme ${theme.name}`}
                onClick={() => onRemoveTheme(theme.id)}
                type="button"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        className="tkn-ghost-button"
        data-testid="theme-creator-toggle"
        hidden={open}
        onClick={() => setOpen(true)}
        type="button"
      >
        <Plus size={12} /> New mode
      </button>
      <div className="tkn-sheet" hidden={!open}>
          <label className="tkn-field">
            <span className="tkn-field-label">Name</span>
            <span className="property-input-wrap tkn-input">
              <input
                aria-label="New theme name"
                data-testid="theme-name-input"
                value={name}
                placeholder="e.g. Dark"
                onChange={(event) => setName(event.target.value)}
              />
            </span>
          </label>
          <div className="tkn-check-grid" role="group" aria-label="Theme sets">
            {sets.map((set) => (
              <label className={`tkn-check${selectedSets.includes(set.id) ? " is-on" : ""}`} key={set.id}>
                <input
                  type="checkbox"
                  data-testid={`theme-set-${set.id}`}
                  checked={selectedSets.includes(set.id)}
                  onChange={() => toggleSet(set.id)}
                />
                <span>{set.name}</span>
              </label>
            ))}
          </div>
          <div className="tkn-sheet-actions">
            <button className="tkn-ghost-button" onClick={() => { setOpen(false); setName(""); setSelectedSets([]); }} type="button">
              Cancel
            </button>
            <button
              className="tkn-primary-button"
              data-testid="theme-create-button"
              disabled={name.trim().length === 0 || selectedSets.length === 0}
              onClick={create}
              type="button"
            >
              <Plus size={12} /> Create mode
            </button>
          </div>
        </div>
    </section>
  );
}

function SetsSection({
  tokens,
  usage,
  activeSetId,
  onSelectSet,
  onUpsertSet,
  onRemoveSet,
}: Pick<TokensPanelProps, "tokens" | "onUpsertSet" | "onRemoveSet"> & {
  usage: Map<string, string[]>;
  activeSetId: string;
  onSelectSet: (setId: string) => void;
}) {
  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const sets = useMemo(() => Object.values(tokens.sets).sort((a, b) => a.name.localeCompare(b.name)), [tokens]);
  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onUpsertSet({ id: `${slugify(trimmed)}-${createStableId("set").slice(-4)}`, name: trimmed, tokens: {} });
    setName("");
  };
  const commitRename = (set: TokenSet) => {
    const next = renameDraft.trim();
    setRenamingId(null);
    if (next.length > 0 && next !== set.name) onUpsertSet({ ...set, name: next });
  };
  return (
    <section className="tkn-section" aria-label="Token sets">
      <div className="tkn-section-head">
        <span className="tkn-section-title">Collections</span>
        <span className="tkn-section-hint">{sets.length} {sets.length === 1 ? "collection" : "collections"}</span>
      </div>
      <div className="tkn-collections" role="listbox" aria-label="Token collections">
        {sets.map((set) => {
          const usedBy = usage.get(set.id) ?? [];
          const count = Object.keys(set.tokens).length;
          const active = set.id === activeSetId;
          return (
            <div
              className={`tkn-collection${active ? " is-active" : ""}`}
              key={set.id}
              role="option"
              aria-selected={active}
            >
              {renamingId === set.id ? (
                <span className="tkn-collection-main tkn-collection-rename">
                  <span className="property-input-wrap tkn-input">
                    <input
                      autoFocus
                      aria-label={`Rename ${set.name}`}
                      data-testid={`set-rename-${set.id}`}
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onBlur={() => commitRename(set)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") setRenamingId(null);
                      }}
                    />
                  </span>
                </span>
              ) : (
                <button
                  className="tkn-collection-main"
                  title={`${set.name} — ${count} tokens${usedBy.length > 0 ? ` · used in ${usedBy.join(", ")}` : " · unused"} — double-click to rename`}
                  onClick={() => onSelectSet(set.id)}
                  onDoubleClick={() => {
                    setRenamingId(set.id);
                    setRenameDraft(set.name);
                  }}
                  type="button"
                >
                  <span className="tkn-collection-swatch" aria-hidden="true">
                    {set.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="tkn-collection-meta">
                    <strong>{set.name}</strong>
                    <small>{count} {count === 1 ? "token" : "tokens"}{usedBy.length > 0 ? ` · ${usedBy.slice(0, 2).join(", ")}${usedBy.length > 2 ? ` +${usedBy.length - 2}` : ""}` : " · unused"}</small>
                  </span>
                </button>
              )}
              <button
                className="token-icon-button tkn-mini"
                data-testid={`set-rename-button-${set.id}`}
                aria-label={`Rename set ${set.name}`}
                title={`Rename set ${set.name}`}
                onClick={() => {
                  setRenamingId(set.id);
                  setRenameDraft(set.name);
                }}
                type="button"
              >
                <Pencil size={12} />
              </button>
              <button
                className="token-icon-button tkn-mini"
                data-testid={`set-remove-${set.id}`}
                aria-label={`Delete set ${set.name}`}
                title={usedBy.length > 0 ? `Used by ${usedBy.join(", ")}` : `Delete set ${set.name}`}
                disabled={usedBy.length > 0}
                onClick={() => onRemoveSet(set.id)}
                type="button"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="tkn-inline-create">
        <span className="property-input-wrap tkn-input tkn-inline-input">
          <input
            aria-label="New set name"
            data-testid="set-name-input"
            value={name}
            placeholder="New collection, e.g. Marketing"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") create(); }}
          />
        </span>
        <button
          className="tkn-ghost-button"
          data-testid="set-create-button"
          disabled={name.trim().length === 0}
          onClick={create}
          type="button"
        >
          <Plus size={12} /> Add
        </button>
      </div>
    </section>
  );
}

function CopyVarButton({ token }: { token: DesignToken }) {
  const [copied, setCopied] = useState(false);
  const cssVar = cssVariableName(token.name);
  const copy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(`var(${cssVar})`);
      }
    } catch {
      /* clipboard unavailable in tests — still show feedback */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button
      className="tkn-copy"
      title={`Copy ${cssVar}`}
      aria-label={`Copy CSS variable ${cssVar}`}
      onClick={copy}
      type="button"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

function TokensSection({
  tokens,
  activeSetId,
  onSelectSet,
  onUpsertToken,
  onRemoveToken,
  onRenameToken,
  themeValues,
  resolved,
}: Pick<TokensPanelProps, "tokens" | "onUpsertToken" | "onRemoveToken" | "onRenameToken"> & {
  activeSetId: string;
  onSelectSet: (setId: string) => void;
  themeValues: ReturnType<typeof useThemeValues>;
  resolved: Map<string, ResolvedToken>;
}) {
  const sets = useMemo(() => Object.values(tokens.sets).sort((a, b) => a.name.localeCompare(b.name)), [tokens]);
  const activeSet = activeSetId ? tokens.sets[activeSetId] : undefined;
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TokenType | "all">("all");
  const [name, setName] = useState("");
  const [type, setType] = useState<TokenType>("color");
  const [draft, setDraft] = useState<ValueDraft>(EMPTY_DRAFT);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDraft, setEditDraft] = useState<ValueDraft>(EMPTY_DRAFT);
  const [editError, setEditError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creatorOpen, setCreatorOpen] = useState(false);

  const allInSet = useMemo(() => {
    if (!activeSet) return [];
    return Object.values(activeSet.tokens).sort((a, b) => a.name.localeCompare(b.name));
  }, [activeSet]);

  /**
   * Resolves a set-row token for preview: non-alias tokens show their own
   * value; alias tokens chase the chain through the active theme's merged map.
   */
  const previewFor = (entry: DesignToken): { value: TokenValue; status?: "dangling" | "cyclic" } => {
    if (!isTokenAlias(entry.value)) return { value: entry.value };
    const visited = new Set<string>([entry.name]);
    let target = tokenAliasTarget(entry.value);
    while (target) {
      if (visited.has(target)) return { value: entry.value, status: "cyclic" };
      visited.add(target);
      const hit = resolved.get(target);
      if (!hit) return { value: entry.value, status: "dangling" };
      if (hit.aliasStatus) return { value: entry.value, status: hit.aliasStatus };
      return { value: hit.resolvedValue };
    }
    return { value: entry.value };
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allInSet.filter((t) => {
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        summarizeTokenValue(t).toLowerCase().includes(q) ||
        (isTokenAlias(t.value)
          ? summarizeTokenValue(t, previewFor(t).value).toLowerCase().includes(q)
          : false) ||
        (t.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [allInSet, query, typeFilter, resolved]);

  const groups = useMemo(() => {
    const map = new Map<string, DesignToken[]>();
    for (const t of filtered) {
      const ns = namespaceOf(t.name);
      const list = map.get(ns) ?? [];
      list.push(t);
      map.set(ns, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const commitError = (action: () => void, onError: (message: string) => void) => {
    try {
      action();
      onError("");
      setError(null);
      setEditError(null);
    } catch (caught) {
      const message = caught instanceof TokenValidationError || caught instanceof Error
        ? caught.message
        : "Invalid token value";
      onError(message);
    }
  };

  const create = () => {
    if (!activeSet) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Token name is required");
      return;
    }
    commitError(() => {
      const value = buildTokenValue(type, draft);
      const entry: DesignToken = {
        id: `${slugify(trimmed)}-${createStableId("token").slice(-4)}`,
        name: trimmed,
        type,
        value,
      };
      if (description.trim()) entry.description = description.trim();
      onUpsertToken(activeSet.id, entry);
      setName("");
      setDraft(EMPTY_DRAFT);
      setDescription("");
      setCreatorOpen(false);
    }, setError);
  };

  const saveEdit = (entry: DesignToken) => {
    if (!activeSet) return;
    commitError(() => {
      const nextName = editName.trim();
      const value = buildTokenValue(entry.type, editDraft);
      if (nextName && nextName !== entry.name) {
        validateTokenName(nextName, "token.name");
        // Renames carry reference integrity: `{old}` aliases and `var(--old)`
        // element links rewrite inside the same command.
        if (onRenameToken) {
          onRenameToken(activeSet.id, entry.id, nextName);
          onUpsertToken(activeSet.id, { ...entry, name: nextName, value });
        } else {
          onUpsertToken(activeSet.id, { ...entry, name: nextName, value });
        }
      } else {
        onUpsertToken(activeSet.id, { ...entry, value });
      }
      setEditingId(null);
    }, setEditError);
  };

  const toggleGroup = (ns: string) =>
    setCollapsed((c) => ({ ...c, [ns]: !c[ns] }));

  return (
    <section className="tkn-section tkn-variables" aria-label="Tokens">
      <div className="tkn-section-head">
        <span className="tkn-section-title">Variables</span>
        <span className="tkn-section-hint">{filtered.length}/{allInSet.length}</span>
      </div>

      <label className="tkn-field">
        <span className="tkn-field-label">Collection</span>
        <span className="property-input-wrap tkn-input">
          <select
            aria-label="Token set"
            data-testid="token-set-select"
            value={activeSetId}
            onChange={(event) => { onSelectSet(event.target.value); setEditingId(null); }}
          >
            {sets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
          </select>
        </span>
      </label>

      <div className="tkn-toolbar">
        <span className="property-input-wrap tkn-input tkn-search">
          <Search size={12} aria-hidden="true" />
          <input
            aria-label="Search variables"
            data-testid="tkn-search"
            value={query}
            placeholder="Search name, value, or group…"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button className="tkn-clear" aria-label="Clear search" onClick={() => setQuery("")} type="button">
              <X size={12} />
            </button>
          ) : null}
        </span>
        <div className="tkn-filters" role="group" aria-label="Filter by type">
          <button
            className={`tkn-filter${typeFilter === "all" ? " is-on" : ""}`}
            data-testid="tkn-filter-all"
            aria-pressed={typeFilter === "all"}
            onClick={() => setTypeFilter("all")}
            type="button"
          >
            All
          </button>
          {TOKEN_TYPES.map((t) => (
            <button
              key={t}
              className={`tkn-filter${typeFilter === t ? " is-on" : ""}`}
              data-testid={`tkn-filter-${t}`}
              aria-pressed={typeFilter === t}
              title={TOKEN_TYPE_LABELS[t]}
              onClick={() => setTypeFilter(typeFilter === t ? "all" : t)}
              type="button"
            >
              {TOKEN_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {themeValues.themes.length > 1 ? (
        <div className="tkn-mode-columns" aria-label="Mode values">
          <span className="tkn-mode-columns-label">Modes:</span>
          {themeValues.themes.map((th) => (
            <span key={th.id} className={`tkn-mode-tag${tokens.activeThemeId === th.id ? " is-active" : ""}`}>
              {th.name}
            </span>
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="tokens-empty tkn-empty">
          {allInSet.length === 0 ? "No variables in this collection yet." : "No variables match the current search."}
        </p>
      ) : null}

      {groups.map(([ns, items]) => {
        const isCollapsed = collapsed[ns] === true;
        return (
          <div className="tkn-group" key={ns}>
            <button
              className="tkn-group-head"
              data-testid={`tkn-group-${ns}`}
              aria-expanded={!isCollapsed}
              onClick={() => toggleGroup(ns)}
              type="button"
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <span className="tkn-group-name">{ns}</span>
              <span className="tkn-group-count">{items.length}</span>
            </button>
            {!isCollapsed ? (
              <div className="tkn-group-rows">
                {items.map((entry) => {
                  const editing = editingId === entry.id;
                  const cssVar = cssVariableName(entry.name);
                  const modes = themeValues.themesForName(entry.name);
                  const preview = previewFor(entry);
                  const alias = isTokenAlias(entry.value) ? tokenAliasTarget(entry.value) : null;
                  const valueText = summarizeTokenValue(entry, preview.value);
                  return (
                    <div className="tkn-row" key={entry.id} data-testid={`token-row-${entry.id}`}>
                      <div className="tkn-row-main">
                        <TokenPreview token={entry} resolvedValue={preview.value} />
                        <span className="tkn-row-meta">
                          <span className="tkn-name-row">
                            <strong className="tkn-name" title={`${entry.name} → ${cssVar}`}>{entry.name}</strong>
                            {alias ? (
                              <span
                                className={`tkn-alias${preview.status ? " is-broken" : ""}`}
                                title={preview.status
                                  ? `Alias to ${alias} is ${preview.status} — it will not resolve`
                                  : `Alias → ${alias} = ${valueText}`}
                              >
                                {preview.status ? <AlertTriangle size={10} aria-hidden="true" /> : <Link2 size={10} aria-hidden="true" />}
                                {alias}
                              </span>
                            ) : null}
                          </span>
                          <span className="tkn-value" title={valueText}>
                            {valueText}
                            {modes.length > 1 ? <em className="tkn-modes-count">{modes.length} modes</em> : null}
                          </span>
                        </span>
                        <span className="tkn-row-actions">
                          <CopyVarButton token={entry} />
                          <button
                            className="token-icon-button tkn-mini"
                            data-testid={`token-edit-${entry.id}`}
                            aria-label={editing ? `Cancel editing ${entry.name}` : `Edit ${entry.name}`}
                            onClick={() => {
                              setEditingId(editing ? null : entry.id);
                              setEditName(entry.name);
                              setEditDraft(draftForToken(entry));
                              setEditError(null);
                            }}
                            type="button"
                          >
                            {editing ? <X size={12} /> : <Pencil size={12} />}
                          </button>
                          <button
                            className="token-icon-button tkn-mini"
                            data-testid={`token-remove-${entry.id}`}
                            aria-label={`Delete ${entry.name}`}
                            onClick={() => activeSet && onRemoveToken(activeSet.id, entry.id)}
                            type="button"
                          >
                            <Trash2 size={12} />
                          </button>
                        </span>
                      </div>
                      {editing ? (
                        <div className="tkn-sheet tkn-edit-sheet">
                          <label className="tkn-field">
                            <span className="tkn-field-label">Name</span>
                            <span className="property-input-wrap tkn-input">
                              <input
                                aria-label="Token name"
                                data-testid={`token-rename-${entry.id}`}
                                value={editName}
                                placeholder={entry.name}
                                onChange={(event) => setEditName(event.target.value)}
                              />
                            </span>
                          </label>
                          {onRenameToken ? (
                            <p className="tkn-rename-note" role="note">
                              Renaming rewrites aliases and linked elements.
                            </p>
                          ) : null}
                          <TokenValueInputs type={entry.type} draft={editDraft} onChange={setEditDraft} resolved={resolved} />
                          {themeValues.themes.length > 1 ? (
                            <div className="tkn-per-mode" aria-label="Values per mode">
                              {themeValues.themes.map((th) => {
                                const v = themeValues.valueFor(entry.name, th.id);
                                return (
                                  <span
                                    key={th.id}
                                    className="tkn-per-mode-cell"
                                    title={v ? `${th.name}: ${summarizeTokenValue(v)}` : `${th.name}: —`}
                                  >
                                    <em>{th.name}</em>
                                    <strong>{v ? summarizeTokenValue(v) : "—"}</strong>
                                  </span>
                                );
                              })}
                            </div>
                          ) : null}
                          {editError ? <p className="tokens-error" role="alert">{editError}</p> : null}
                          <div className="tkn-sheet-actions">
                            <button
                              className="tkn-ghost-button"
                              onClick={() => setEditingId(null)}
                              type="button"
                            >
                              Cancel
                            </button>
                            <button
                              className="tkn-primary-button"
                              data-testid={`token-save-${entry.id}`}
                              onClick={() => saveEdit(entry)}
                              type="button"
                            >
                              <Check size={12} /> Save
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}

      <button
        className="tkn-primary-button tkn-create-open"
        data-testid="token-creator-toggle"
        hidden={creatorOpen}
        onClick={() => setCreatorOpen(true)}
        type="button"
      >
        <Plus size={12} /> New variable
      </button>
      <div className="tkn-sheet tkn-create-sheet" hidden={!creatorOpen}>
          <div className="tkn-create-head">
            <strong>New variable</strong>
            <span className="tkn-var-preview">{name.trim() ? cssVariableName(slugify(name.trim()).split("-").join(".")) : "—"}</span>
          </div>
          <label className="tkn-field">
            <span className="tkn-field-label">Name</span>
            <span className="property-input-wrap tkn-input">
              <input
                aria-label="New token name"
                data-testid="token-name-input"
                value={name}
                placeholder="color.accent.primary"
                onChange={(event) => setName(event.target.value)}
              />
            </span>
          </label>
          <label className="tkn-field">
            <span className="tkn-field-label">Type</span>
            <span className="property-input-wrap tkn-input">
              <select
                aria-label="New token type"
                data-testid="token-type-select"
                value={type}
                onChange={(event) => setType(event.target.value as TokenType)}
              >
                {TOKEN_TYPES.map((option) => <option key={option} value={option}>{TOKEN_TYPE_LABELS[option]}</option>)}
              </select>
            </span>
          </label>
          <TokenValueInputs type={type} draft={draft} onChange={setDraft} resolved={resolved} />
          <label className="tkn-field">
            <span className="tkn-field-label">Note</span>
            <span className="property-input-wrap tkn-input">
              <input
                aria-label="Token description"
                data-testid="token-description-input"
                value={description}
                placeholder="Optional"
                onChange={(event) => setDescription(event.target.value)}
              />
            </span>
          </label>
          {error ? <p className="tokens-error" role="alert">{error}</p> : null}
          <div className="tkn-sheet-actions">
            <button className="tkn-ghost-button" onClick={() => { setCreatorOpen(false); setError(null); }} type="button">
              Cancel
            </button>
            <button
              className="tkn-primary-button"
              data-testid="token-create-button"
              disabled={!activeSet || name.trim().length === 0}
              onClick={create}
              type="button"
            >
              <Plus size={12} /> Add variable
            </button>
          </div>
        </div>
    </section>
  );
}

export function TokensPanel(props: TokensPanelProps) {
  const { tokens, onExportDTCG, onExportCss, onImportTokensFile } = props;
  const usage = useSetUsage(tokens);
  const themeValues = useThemeValues(tokens);
  const resolved = useResolvedTokens(tokens);
  const sortedSetIds = useMemo(
    () => Object.values(tokens.sets).sort((a, b) => a.name.localeCompare(b.name)).map((s) => s.id),
    [tokens],
  );
  const [collectionId, setCollectionId] = useState<string>(sortedSetIds[0] ?? "");
  const activeSetId = collectionId && tokens.sets[collectionId] ? collectionId : (sortedSetIds[0] ?? "");
  const totalTokens = useMemo(
    () => Object.values(tokens.sets).reduce((n, s) => n + Object.keys(s.tokens).length, 0),
    [tokens],
  );

  return (
    <div className="tokens-panel tkn-root" data-testid="tokens-panel">
      <div className="tkn-top">
        <div className="tkn-title-row">
          <strong>Variables</strong>
          <span className="tkn-count" title={`${totalTokens} tokens in ${sortedSetIds.length} collections`}>
            {totalTokens}
          </span>
        </div>
      </div>
      <ThemeSection
        tokens={tokens}
        onSwitchTheme={props.onSwitchTheme}
        onRemoveTheme={props.onRemoveTheme}
        onUpsertTheme={props.onUpsertTheme}
      />
      <SetsSection
        tokens={tokens}
        usage={usage}
        activeSetId={activeSetId}
        onSelectSet={setCollectionId}
        onUpsertSet={props.onUpsertSet}
        onRemoveSet={props.onRemoveSet}
      />
      <TokensSection
        tokens={tokens}
        activeSetId={activeSetId}
        onSelectSet={setCollectionId}
        onUpsertToken={props.onUpsertToken}
        onRemoveToken={props.onRemoveToken}
        onRenameToken={props.onRenameToken}
        themeValues={themeValues}
        resolved={resolved}
      />
      <section className="tkn-section tkn-export" aria-label="Token export">
        <div className="tkn-section-head">
          <span className="tkn-section-title">Import / export</span>
          <Download size={12} aria-hidden="true" />
        </div>
        <p className="tkn-export-hint">Exports resolve the active mode, ready for code. Import reads a DTCG JSON file into a new collection.</p>
        <div className="tokens-export-row tkn-export-row">
          {onImportTokensFile ? (
            <>
              <input
                accept=".json,application/json"
                aria-label="Choose DTCG tokens file to import"
                className="workspace-import-input"
                data-testid="tokens-import-input"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) onImportTokensFile(file);
                }}
                type="file"
              />
              <button
                className="tkn-ghost-button"
                data-testid="tokens-import-button"
                onClick={(event) => {
                  event.currentTarget.parentElement?.querySelector<HTMLInputElement>('[data-testid="tokens-import-input"]')?.click();
                }}
                type="button"
              >
                <Upload size={12} aria-hidden="true" /> Import
              </button>
            </>
          ) : null}
          <button className="tkn-ghost-button" data-testid="tokens-export-dtcg" onClick={onExportDTCG} type="button">
            DTCG JSON
          </button>
          <button className="tkn-ghost-button" data-testid="tokens-export-css" onClick={onExportCss} type="button">
            CSS variables
          </button>
        </div>
      </section>
    </div>
  );
}
