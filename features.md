# Canvas — Feature Index

Every feature in the project, one line each. Grouped by area.

## Canvas core

- **Infinite canvas** — unbounded 2D pan/zoom surface, zoom range 0.08×–4× (`src/canvas/`).
- **Camera fitting** — "0" / fit-all zooms to content with sidebar/header/dock-aware insets (`canvas/camera.ts`).
- **Viewport virtualization** — off-screen frames stop rendering live; ≤12 live iframes + 560px overscan (`canvas/virtualization.ts`, `canvas/constants.ts`).
- **Project Lake** — Figma-style file browser home: grid/list views, search (⌘K or `/`), sort menu, kind filter tabs, "+ New" menu, double-click rename, duplicate, inline-confirm delete, prefs persisted to localStorage (`canvas/ProjectLake.tsx`).
- **Live project thumbnails** — lake cards render real project state in tiny sandboxed srcDoc iframes, IntersectionObserver-gated with per-revision cache and kind-art fallback.
- **Canvas categories** — Website Design vs Mobile Design projects; tool palettes, frame presets, and agent "hardness" specs diverge per category (`persistence/local-projects.ts`, `agents/`).
- **Project routing** — `/design/:id` routes (plus legacy `/project/:id`, `/p/:id`), autosave to localStorage, not-found state, browser-back support (`routing.ts`).
- **Resilient local storage** — per-project payload keys + last-good backups + index backup, one-time migration from the legacy single-blob index, merge-safe writes, and a self-healing open path (strict parse → salvage repair → backup) (`persistence/local-projects.ts`, `persistence/wirecanvas-repair.ts`).
- **Empty state** — truly blank startup with a single "Start brainstorming" CTA (`canvas/EmptyCanvasState.tsx`).
- **Demo fixture** — `?demo=1` loads the Lumina Station demo document for tests/demos (`src/demo/`).

## Frames & rendering

- **Sandboxed frame rendering** — every design is a real HTML document in a `sandbox="allow-scripts"` srcDoc iframe (`frame/FrameView.tsx`).
- **Device preset catalog** — 45+ frames: iPhone 12–17, Galaxy S/Z, Pixel, OnePlus, Xiaomi, iPads, Galaxy Tab, Surface, monitors, MacBooks (`frame/presets.ts`).
- **Device chrome** — physically measured notch, Dynamic Island, punch-hole, and bezel overlays per preset.
- **Document modes** — `design` (full styling) vs `wireframe` (neutral grayscale) documents (`editor/model.ts`).
- **Wireframe theme** — Canvas injects one idempotent grayscale/dashed-outline theme into wireframes at render time (`frame/wireframe-theme.ts`).
- **Token theme injection** — design frames get the active token theme's CSS vars injected; wireframes never do (`frame/token-theme.ts`, `frame/render-document.ts`).
- **Frame manipulation** — move via title bar or body drag, rename, resize, background color, Delete/Backspace removal as one undoable transaction.
- **Pages** — multi-page projects; one page can mix frames backed by different documents (Figma imports).
- **Brief Frame** — first-class editable canvas artifact holding the brainstorm brief (`frame/BriefFrameView.tsx`).

## Iframe bridge

- **Versioned postMessage protocol** — handshake/ready/request/command/event envelopes validated on both sides (`bridge/protocol.ts`).
- **Hierarchy snapshot & inspect** — DOM tree + per-element text, attributes, inline and computed styles.
- **Safe style commands** — `set-inline-style` limited to a ~45-property allowlist (layout, spacing, color, type).
- **Element lifecycle commands** — create / delete / restore / duplicate / pick-element inside the live document.
- **Text editing commands** — start/commit/cancel in-place text edit inside the iframe.
- **Shape commands** — `set-shape-radius`, `set-shape-fill`, `set-shape-glass` for tool-created vectors.
- **Font & theme push** — `inject-font-faces` and `set-token-theme` update live documents mid-session.
- **Per-command undo payloads** — every ack returns an undo + replay command so history is exact.
- **Event forwarding** — hover/select/pointer/keydown/input events stream out; ⌘-keys and Delete reach the parent while the iframe holds focus.
- **Coordinate mapping** — screen ↔ world ↔ iframe-point conversion across zoom (`bridge/coordinates.ts`).
- **Runtime injection** — marker-guarded script injected once into srcDoc (`bridge/inject.ts`, `bridge/runtime.ts`).

## Tools & creation

- **Tool dock** — Select V, Hand H (+ Space temporary pan), Frame F, Shape R, Text T, Image I, Shader S, Comment C (`editor/tools.ts`).
- **Shape variants** — rectangle, ellipse, line, arrow, polygon, star drawn as SVG elements (`frame/shape-geometry.tsx`).
- **Text layers** — click/drag to place editable `data-design-tool-kind="text"` divs.
- **Image placement** — local file picker → bounded data-URI image elements.
- **Draw preview** — live ghost outline while dragging out a shape, 6px min-drag threshold.

## Direct manipulation

- **Node overlay** — selection outlines + 8-handle resize box drawn above frames (`overlay/NodeOverlayLayer.tsx`).
- **Move/resize/rotate gestures** — pointer gestures edit real CSS (margins/transforms), not canvas-only state (`overlay/useNodeOverlayGestures.ts`).
- **Snap guides** — translation snapping to other elements with visible alignment guides (`overlay/geometry.ts`).
- **Multi-select** — shift-click across elements, group-bounds move, mixed-value property display.
- **Semantic edits** — every gesture compiles to a typed style change that round-trips through undo.

## Glass (glassmorphism)

- **Apple Liquid Glass effect** — 0–100 glass slider on any surface: 2–5px lens blur, 180% vibrancy, 1.04 contrast, negative-scale SDF refraction, 3-pass chromatic aberration, specular rim + hairline border + drop shadow (`editor/effects.ts`).
- **Tint from fill** — the pane picks up the element's own color at 10–18% opacity; transparent fills still get sheens.
- **Frosted fallback** — Safari/Firefox get a higher-blur frosted path where `backdrop-filter: url()` is unsupported.
- **Glass on shapes & text** — applies to created SVG vectors (via geometry child) and ordinary elements; level survives duplicate/restore.

## Shaders

- **Shader library** — 31 Paper Shaders + 1 custom shader, browsable in a searchable, category-filtered gallery (`components/ShaderMenu.tsx`).
- **Gradients** — Mesh Gradient, Grain Gradient, Static Mesh, Static Radial, Color Panels, Heatmap.
- **Noise** — Neuro Noise, Simplex Noise, Perlin Noise, Warp, Metaballs.
- **Patterns** — Dot Orbit, Dot Grid, Halftone Dots, Halftone CMYK, Voronoi, Spiral, Swirl, Dithering.
- **Motion & Light** — Smoke Ring, God Rays, Waves, Water, Pulsing Border, Gem Smoke, Liquid Metal.
- **Texture & Glass** — Paper Texture, Fluted Glass, Lens Distortion, Image Dithering.
- **Ferro Tide (custom)** — first-party OGL fluid shader with 5 moods: Abyss, Magma, Ultraviolet, Kelp, Porcelain (`shaders/ferro-tide.tsx`).
- **Zero-GPU thumbnails** — static CSS stand-ins per card; the real WebGL preview mounts only on hover/focus.
- **Canvas shader elements** — placed shaders live on the canvas (not inside iframes), draggable/resizable with min size (`shaders/canvas-model.ts`).
- **Shader inspector** — the left sidebar's Shaders tab edits every param of each placed shader: presets, color palettes, numeric sliders, enum selects, booleans, image source, motion (speed/frame) and sizing (fit/scale/rotation/origin/offset/world size). Fields derive from the shader's preset table (`shaders/params.ts`, `components/ShadersPanel.tsx`).
- **WebGL context hygiene** — `SafeShaderMount` force-loses contexts on unmount so the ~16-context browser budget isn't exhausted (`shaders/webgl-release.ts`, `components/SafeShaderMount.tsx`).
- **WebGL2 detection** — pre-flight support check before mounting any shader (`shaders/registry.ts`).

## Design tokens

- **Token store** — DTCG-compatible color/typography/spacing/radius/shadow/motion/opacity tokens in sets, with monotonic revisions (`src/tokens/`).
- **Themes** — sets merge into themes (seeded light/dark/brand); switching themes re-skins every design frame.
- **Aliases** — `{token.path}` references with resolved/dangling/cyclic status surfaced.
- **Variable links** — applying a token writes `var(--x)` on the element, a durable link that survives value edits and theme switches.
- **Token rename** — renames cascade across every set, alias, and in-document `var()` link as one undoable transaction.
- **TokensPanel** — sidebar editor: theme tabs, sets, per-mode presence dots, alias chips, live previews, create/rename/delete, import/export (`components/TokensPanel.tsx`).
- **Per-property token picker** — Figma-style popover in PropertiesPanel: search, apply `var()`, "Break link", off-system and unresolved-link flags (`components/PropertiesPanel.tsx`).
- **DTCG import/export** — import Tokens Studio/Style Dictionary JSON; export `tokens.json` + `tokens.css` bundled into code zips.
- **Router contract** — `tokens.set`, `tokens.query` (with resolvedValue/aliasOf/aliasStatus), `rename-token` ops (`router/tokens.ts`).
- **Fail-closed validation** — hostile values (e.g. `</style><script>`) rejected; sinks neutralized (`tokens/validation.ts`).

## Fonts

- **Bundled font catalog** — 22 OFL-licensed families shipped as inline woff2 data-URIs: Inter, Geist(+Mono), Instrument Sans/Serif, Space Grotesk, Bricolage Grotesque, Sora, Manrope, Outfit, Plus Jakarta Sans, Urbanist, Fraunces, Newsreader, Source Serif 4, Playfair Display, DM Serif Display, JetBrains Mono, IBM Plex Mono, Space Mono, Unbounded, Syne (`src/fonts/`).
- **srcDoc injection** — only the families a document declares get `@font-face` rules written into its sandboxed frame.
- **Live font push** — `inject-font-faces` swaps fonts in already-rendered frames instantly.
- **Searchable Family picker** — grouped catalog popover with per-font preview, OFL badge, free-text fallback.

## Comments

- **Comment tool (C)** — click anywhere to drop a frame-anchored comment marker (`src/comments/`).
- **Comment popover** — draft/save/edit/delete with click-outside finalize and feedback toasts.
- **Resolve & hover preview** — markers resolve and preview on hover; comments live outside the undo stack by design.

## Import, paste & export

- **Clipboard HTML paste** — `Cmd/Ctrl+V` drops a copied web section as a new styled frame, sized from capture metadata, camera-fitted (`clipboard/paste-html.ts`).
- **HTML file import** — `.html` picker runs untrusted bytes through the sanitize + validate pipeline into one undoable design document (`import-html/`).
- **Figma .fig import** — decodes the binary zip; every top-level node becomes a frame with positioned HTML/SVG, fills, strokes, vectors, text, shadows, blend modes, transforms (`import-figma/`).
- **.wirecanvas.json project files** — versioned whole-project export/import; untrusted-input validation, atomic replace, full undo (`persistence/wirecanvas.ts`, `persistence/adapter.ts`).
- **Figma .fig export** — writes a real Figma binary (kiwi schema + zstd) verified against Figma's own format (`persistence/figma.ts`).
- **Export Code** — downloads clean working code (bridge stripped): single page → `.html`, multi-page → `.zip` with `index.html`, `tokens.json`, `tokens.css` (`export/`).
- **Dependency-free zip writer** — STORE-only archive builder (`export/zip.ts`).

## Agent & AI

- **Brainstorming Mode** — Codex/agent-driven session with lifecycle `not-started → briefing → wireframing → completed` and monotonic revisions (`session/`, `router/brainstorm-session.ts`).
- **Brief capture** — canonical fields (description, audience, goals, success criteria, content, features, visual direction, constraints, references, open questions, decisions) with per-field saves.
- **Wireframe admission** — fail-closed validator: semantic HTML + neutral layout CSS only; scripts, styles, media, external URLs blocked (`router/wireframe-admission.ts`).
- **Document exchange** — agent ops: `getHtml`, `replaceHtml`, `createWireframe`, `createDesignDocument` with expected-revision freshness checks (`router/document-exchange.ts`).
- **Brainstorm agent harness** — tool-using agent loop with tools `brainstorm.update_brief/add_reference/add_decision/transition/draft_wireframe/edit_wireframe` and `main.generate_wireframe` (`harness/brainstorm/`).
- **Main generation agent** — produces complete wireframe HTML, validates admission, auto-repairs on rejection (`harness/main/`).
- **Live-wireframes skill** — `live.list_wireframes`, `live.inspect_wireframe`, `live.pinpoint_edit`, `live.explore_variants` for point-at-it co-editing (`harness/brainstorm/skills/live-wireframes.ts`).
- **Concept-brainstorm skill** — `concept.propose_concepts/list_concepts/select_concept` for ideas-first exploration (`skills/concept-brainstorm.ts`).
- **Model providers** — DeepSeek, OpenAI Responses, scripted test provider, and a subscription bridge routing OpenCode Go gateway + Codex ChatGPT token auth (`harness/provider/`).
- **LLM clients** — Codex ChatGPT (`gpt-5.3-codex`), OpenCode Go models (`gpt-5.6-luna`, `grok-4.6`, `muse-spark-1.2-contributor`, MiniMax/Qwen via Anthropic dialect), Gemini Flash 3.5–3.7 (`src/llm/`).
- **Connection test panel** — dev-only panel to paste a provider key and verify connectivity, keys never persisted (`canvas/AgentConnectionPanel.tsx`).
- **Trace log & transcript** — durable replayable record of turns, tool calls, provider events (`harness/trace.ts`, `transcript.ts`).

## Voice & interaction capture

- **Continuous voice stream** — ordered, bounded audio-chunk + context-snapshot protocol to the Codex host, 256KB chunks / 4MB buffer (`router/continuous-voice-stream.ts`, `voice-stream-protocol.ts`).
- **Browser mic capture** — MediaRecorder opus capture with phased lifecycle and typed errors (`voice/browser-audio-capture.ts`).
- **Pointer recorder** — bounded trail of pointing/drawing/fixing strokes and per-element fix events (`interaction/recorder.ts`, `activity.ts`).
- **Voice context adapter** — packs "where the user pointed" into each dictation's context (`interaction/voice-context.ts`).
- **History-swipe guard** — blocks accidental two-finger trackpad back/forward navigation (`interaction/history-swipe.ts`).

## Editor state & history

- **Command-pattern store** — all mutations are typed commands through one reducer with expected-revision concurrency (`editor/commands.ts`, `reducer.ts`, `store.ts`).
- **Undo/redo** — labeled history entries; comments excluded, selection/tool changes skipped (Figma-style scoping).
- **Node layer model** — rename, lock, hide, reorder any element; powers the layers panel.
- **Keyboard shortcuts** — tools, undo/redo, copy/paste/duplicate, delete, fit-all, escape (`editor/shortcuts.ts`).
- **Internal copy/paste/duplicate** — node-level clipboard takes priority over OS-HTML paste when set.

## UI surfaces

- **Left sidebar** — Pages / Layers / Shaders / Tokens / Assets icon tabs; searchable layer tree with Figma-style names, icons, rename/hide/lock (`components/LeftSidebar.tsx`, `panel-model.ts`).
- **Properties panel** — per-profile sections: Position & size, Typography, Fill & border, Opacity & effects, Glass, Corner radius, Button style, Text content (`components/PropertiesPanel.tsx`).
- **Canvas dock** — tool buttons, shape-variant menu, undo/redo, zoom −/+, fit, frame-preset menu, shader menu (`components/CanvasDock.tsx`).
- **Workspace header** — brand, lake toggle, project identity, Import/Import HTML/Export/Export .fig/Export Code, canvas category badge (`components/WorkspaceHeader.tsx`).
- **Tactile controls** — soft-key press/hover motion language, recessed sliders with halo thumbs, overflow-safe strips (`styles.css`).
- **Feedback toasts** — honest success/error surfacing for paste, persistence, comments.

## Companion pieces (outside the app bundle)

- **Canvas Capture extension** — MV3 browser extension that deep-clones any page section, inlines computed styles, and writes a full HTML doc to the clipboard for pasting (`browser-extension-source/`).
- **Self-improving loop** — local-first observation engine: frustration detectors (rage/dead clicks, ghost gestures, thrash, retries), rule+LLM advisors, policy-gated auto-apply with verify/rollback, insights dashboard (`improved source/`).
- **Shader experiments** — standalone studies `experiments/dot-attraction` and `experiments/ferro-tide` (the latter became the shipped custom shader).
- **Canvas-design skill plugin** — Codex-side skill for driving/QA-ing the workspace (`plugins/canvas-design/`).
- **Per-canvas agent specs** — `agents/agent.md` / `agent-mobile.md` hardness placeholders keyed by canvas category.
- **QA harness** — `qa/driver.mjs` exploratory browser driver, probe scripts, evidence capture.
- **Figma tooling scripts** — `scripts/dump-fig.mjs` and `verify-figma-export.mjs` for inspecting/validating .fig output.
- **Test suites** — ~800 Vitest unit tests + ~80 Playwright e2e specs covering every feature area (`tests/`, `vitest.config.ts`, `playwright.config.ts`).
