# QA Report — Canvas (agent-native design tool)

**Date:** 2026-09-12 · **Scope:** working tree (uncommitted changes on `main` @ fabdbbd) · **Build under test:** Vite dev server `localhost:5199` + production preview `127.0.0.1:4173` · **Method:** automated suite + exploratory session driving real Chromium (Playwright, project’s own e2e harness), console/pageerror/request capture, screenshots in `qa/evidence/`.

## 1. Automated baseline

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ clean |
| `npm run build` | ✅ clean |
| Unit (`vitest`) | ✅ **722/722** (80 files) |
| E2E (`playwright`, preview build) | ❌ **79/80** — 1 failure |
| Exploratory driver (79 checks) | 56 pass · 18 fail* · 5 warn |

\* Most driver fails traced to driver artifacts (headed-mode click targeting on a below-fold demo heading, wrong menu selectors, missing export buttons in demo mode). After triage, **6 real defects** remain, detailed in §3.

## 2. The e2e failure

`tests/e2e/glass.spec.ts:67` — *“tracks the applied level on a created text layer so the slider reads back”* — `glass-level-increment` never becomes visible after selecting a created text layer. Root cause found, see **D2** below.

## 3. Confirmed defects

### D1 — Keyboard shortcuts die while a frame’s document holds focus — **HIGH**
After clicking any element inside a live frame, `document.activeElement` is the `IFRAME`. The iframe bridge forwards only `Delete`/`Backspace` and ⌘/Ctrl-modified keydowns to the parent (`bridge/runtime.ts:1860` → `CanvasSurface.tsx:1335`). All other keys are swallowed:

- Tool keys `V H F R T I S C` → nothing (verified: `r` after node-select leaves `tool-button-select` active, no creation layer renders)
- `Escape` → nothing (multi-selection stayed: 2 outlines before and after 2×Escape)
- `0` (fit all) → nothing

Same keys work instantly once focus returns to canvas chrome. In a shortcut-driven canvas this is the most user-visible defect found — select a layer, press `T`, and the tool appears unresponsive.

*Fix direction:* forward the full shortcut set through the bridge `keydown` path, gated on `frameTextEditRef`/typing state (already tracked), mirroring `resolveEditorShortcut`.

### D2 — Glass controls missing on text layers (e2e suite red) — **MEDIUM**
`elementProfile()` (`src/components/panel-model.ts:146`) classifies tool-created text divs (`data-design-tool-kind="text"`) as profile `"text"`. The `"text"` branch of `NodeDesignPanel` (`PropertiesPanel.tsx:932`) renders Position/Typography/Fill/Opacity — **no `{glassSection}`** — while `button`, `shape`, and the generic default all include it. Before the font-catalog work added that attribute fallback, created text `<div>`s profiled as `generic` and *did* get the glass section.

Effect: the committed e2e contract (`glass.spec.ts:67`) fails; users cannot apply/read glass on text layers. Images also lack glass (no test coverage). Fix = render `glassSection` in the `"text"` branch (or formally change the contract).

### D3 — Degenerate elements created on ~1px drags — **LOW-MEDIUM**
A pointerdown + 1px move + up inside a creation layer inserts a real ~1–3px `[data-design-tool-created]` element. No minimum-size/drag-threshold guard. Produces invisible junk layers and noise in undo history. Verified: element count 0→1 after a 1px drag.

### D4 — `Escape` does not dismiss the shape-variant menu — **LOW**
`handleEscape` (`CanvasSurface.tsx:3226`) closes the frame and shader menus but not the dock-local shape menu. It stays open on Escape; the next click on the shape button then *closes* it (toggle from stale state) — perceived as a dead first click. Inconsistent with the other two menus.

### D5 — Malformed project route returns raw server 404 — **LOW**
`/design/%` (invalid percent-encoding) gets HTTP 404 from the server before the SPA loads — user sees a bare browser error page, not the app’s `project-not-found` state. `/design/a%20b` and `/p/xyz` correctly reach the not-found UI; `/design/` correctly shows the lake on the production build (dev server mis-handles it — dev-only quirk). Consider a catch-all static fallback or normalizing undecodable ids to the not-found state.

### D6 — Shader menu mounts ~11 live WebGL contexts at once — **LOW-MEDIUM (perf)**
Opening the shader menu renders a live GL preview per card. Observed console warning during the session: `Too many active WebGL contexts. Oldest context will be lost.` On machines with many open GPU contexts (or with on-canvas shader elements already mounted), the oldest context — potentially a canvas shader — can be force-lost. Consider lazy-mounting previews on scroll/hover, static thumbnails, or a shared-context budget.

## 4. Observations (not defects, worth noting)

- **Escape never clears selection** (top level either) — diverges from Figma-style `Esc` = deselect. Combined with D1 this is more noticeable.
- **Demo-mode heading position:** in *headed* Chromium the demo doc’s hero renders ~4.5× larger and sits partially below the fold at the default camera (`?demo=1`). Harmless for users, but it made element-level clicks flaky in headed sessions — worth knowing for future manual QA. Headless renders it fully in view.
- **Export buttons hidden in `?demo=1`** — `canExport` is false until a persisted project exists. Sensible; just don’t expect them in demo mode.
- **`?demo=1` initial camera zoom ≈150%** — frames arrive cropped; `0`/fit works instantly.

## 5. Verified working (extensive)

**Startup & routing:** fresh `/` → project lake; zero frames/iframes at startup; unknown `/design/:id` → not-found → “Go to home” recovery; legacy `/project/:id` + `/p/:id` resolve; `/design/` → lake (prod); no document scroll leak on the infinite canvas.

**Lake:** create project → `/design/:id` route; brief edits autosave and survive lake round-trip + hard reload (same URL); rename (double-click/menu), duplicate, delete-with-confirm; search focused via ⌘K **and** `/`; sort menu + template gallery (Blank brief, Landing, Dashboard, Portfolio, Wireframe, Storefront, Blank app); browser back/forward.

**Canvas infra:** ctrl-wheel zoom anchored at cursor; horizontal wheel pans (scale unchanged); background drag pans; zoom buttons + % label; clamps verified at **8% min / 400% max** (no degenerate/negative scale under 40–60 hammered clicks); fit-all button + `0` key identical result.

**Tools & creation:** all dock tools enabled, `select` default; keyboard activation for every shortcut; space = temporary hand (release restores); tool click toggles back to select; frame menu → device categories → preset add → new frame selected, zero overlap, live iframe; shape menu lists all 6 variants; rectangle draw creates element + auto-returns to select; text tool stays armed, creates editable layer (typing, per-char Backspace, Enter commits, Delete removes committed layer); image tool → file chooser → image renders in frame; shader menu opens, search + empty-state filter, adding Mesh Gradient mounts a real shader element.

**Selection & editing:** node click → selection box + resize handles + rotate handle; se-handle drag resizes element (194→202px); shift-click multi-select (2 outlines); element drag moves with undoable translate; Ctrl+Z / Ctrl+Shift+Z on moves; frame title-handle drag moves frame; background click deselects; rapid tool-mashing stays consistent.

**Comments:** comment tool → marker + focused popover; autosaves on tool switch; marker reopens saved text; empty edit deletes marker + “Comment deleted” toast; empty new comment dismissed cleanly.

**Panels:** left sidebar (Pages/Layers/Tokens/Assets tabs) + right properties sidebar toggle; text layer → rich properties (Position, Typography incl. Family/Size/Weight/Line-height, Fill & border, Opacity & effects); Tokens panel renders.

**Import/Export:** `.wirecanvas.json` export downloads valid JSON; `.fig` export downloads a real zip-container `.fig`; Export Code → honest “no page code yet” toast when empty, real `.html` download when a page exists; HTML import → styled live frame + toast; hostile `<script>`/`on*` HTML → stripped with “removed for safety” notice; forged bridge-marker doc → rejected, state untouched; paste-HTML → new frame + toast.

**Brainstorming:** start → Brief Frame with the exact protocol opening prompt; fields commit on blur; `javascript:` URLs rejected with alert; `https:` references get `noopener noreferrer` + `_blank`; confirmed decisions add; frame movable; zero iframes during brainstorm.

**Edge/perf:** 390×844 viewport keeps header + dock usable, no horizontal overflow; undo drains to disabled correctly; demo load ~1s to live frames, **0 long tasks, 0 pageerrors, 0 request failures** on normal flows.

## 6. Coverage caveats

Not exercised: Codex/OpenCode agent transport (needs backend), voice features, `.fig` binary fidelity beyond container validation (needs a real Figma import), token DTCG round-trip deep-verify, long-session memory soak, browser-refresh *during* an active drag.

## 7. Suggested priority

1. **D1** — forward tool keys + Escape through the iframe bridge (biggest UX win).
2. **D2** — add `glassSection` to the text profile branch → un-red the suite.
3. **D3** — min-size/drag-threshold on shape creation.
4. **D4, D5** — quick consistency/routing hardening.
5. **D6** — budget shader-menu GL contexts.

*Evidence: `qa/evidence/` (screenshots + `results.json`); drivers: `qa/driver.mjs`, `qa/probe*.mjs`.*
