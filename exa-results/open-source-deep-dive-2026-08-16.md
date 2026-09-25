# Open-source deep dive round two — agent-authoring infrastructure for Canvas

Research date: 2026-08-16
Extends: `exa-results/design-runtime-open-source-2026-08-14.md` (visual-runtime picks: TypeGPU, Motion GPU, Motion, Theatre.js, PixiJS, dotLottie, WebAV, Bezier SDF, three-text, WebGL Fluid, Pts, Rive, Diffusion Studio, Spargo)

Project evaluated: `agent-native-design-canvas` (React 19, Vite, iframe-rendered HTML/CSS, DOM bridge, node overlays, Paper shader registry, wireframe Brainstorming Mode v1)

## What round two is

Round one answered "which GPU/effect runtimes should Canvas adopt." This round doubles down on the rest of the product pillars that open source can meaningfully accelerate:

- the **voice + pointing loop** (speech, VAD, hand/gesture sensing),
- the **durable code loop** (editing, CSS transformation, tokens, round-trip),
- **agent authoring aids** (geometry, shader authoring, generative scaffolding),
- **typography and pixel tooling** (fonts, shaping, image upscaling, on-device ML),
- **deterministic QA, capture, and diagnostics**,
- **collaboration/state** for later phases, and
- **motion/physics as design material**.

All repos were verified against GitHub API for license, stars, and recent activity (2026-08-16). License notes reflect GitHub's reported SPDX; several monorepos report `NOASSERTION` where the LICENSE file is MIT (noted below).

## Ranked new picks

Scores use the same 1–10 scale as round one: `Impact` = new design territory unlocked; `Fit` = compatibility with React/Vite/iframe/HTML-source architecture; `Risk` = licensing, maturity, browser support, integration weight.

| Priority | Repository | What it unlocks here | Impact | Fit | Risk | Recommendation |
|---:|---|---|---:|---:|---:|---|
| 1 | [transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0, 16.3k★, active) | On-device Whisper transcription, CLIP depth/segmentation, image upscaling/retouching, OCR, all in WASM/WebGPU with no API key. Enables Canvas's "no internal LLM" rule to hold while still offering local AI assistance. | 10 | 9 | Medium | **Adopt for the on-device AI layer.** Use it for speech-to-text (voice pillar) and image understanding (upscale/segment imported assets). |
| 2 | [vad-web](https://github.com/ricky0123/vad) (MIT, 2k★) | Silero VAD (voice-activity detection) in ~20 kB WASM. Continuous conversation knows when the user is actually speaking; solves the hover-and-speak activation gate cleanly. | 9 | 10 | Low | **Adopt now for the voice pipeline.** Complements the shipped `continuous-voice-stream` protocol. |
| 3 | [vosk-browser](https://github.com/ccoreilly/vosk-browser) (Apache-2.0, 528★) | Offline speech recognition in the browser via Vosk WASM; streaming, small model footprint. | 8 | 8 | Medium-high | **Pilot as local STT fallback.** Whisper-via-transformers.js is the better long-term path; Vosk is a lighter immediate one. |
| 4 | [Fabric.js](https://github.com/fabricjs/fabric.js) (MIT, 31.4k★, active) | SVG-to-canvas and canvas-to-SVG parser with object model, filters, and export. Ideal for the "draw a shape on the canvas → agent gets canonical SVG/HTML" loop. | 9 | 8 | Medium | **Adopt as the drawing/vector-import adapter**, used headlessly behind the DOM bridge. |
| 5 | [canvas-sketch](https://github.com/mattdesl/canvas-sketch) (MIT, 5.3k★) | Minimal deterministic generative-art framework (seed, resolution, render loop, tooling). Gives the agent a stable, seedable procedural-authoring contract for pattern/motif generation. | 8 | 9 | Low | **Mine its seed/render conventions** for Canvas's own deterministic effect contract. |
| 6 | [Culori](https://github.com/evercoder/culori) (MIT, 1.2k★) | Full color parsing/conversion/interpolation including OKLCH. One library to make agent-authored palettes, gradients, and responsive color edits precise. | 8 | 10 | Low | **Adopt now** as the color engine behind the property panel and CSS patching. |
| 7 | [CodeMirror 6](https://github.com/codemirror/dev) (MIT, 7.8k★) | The standard embeddable code editor with a rich extension API. The future "durable code loop" panel needs human-editable HTML/CSS/JS with agent diffs. | 9 | 8 | Low | **Adopt for the code surface** when repository mode arrives (Phase 2). |
| 8 | [Style Dictionary](https://github.com/amzn/style-dictionary) (Apache-2.0, 4.8k★, active) | The industry design-token pipeline: tokens → CSS variables, Tailwind configs, iOS/Android. Turns accepted Canvas tokens into real product code. | 9 | 7 | Low | **Adopt for token export** in Phase 2; the shipped HTML-source model maps cleanly onto CSS variables. |
| 9 | [pixelmatch](https://github.com/mapbox/pixelmatch) (ISC, 6.9k★) | Pixel-diffing in a few kB. Deterministic screenshots become regression assertions ("this change broke the frame's layout"). | 8 | 10 | Low | **Adopt now** for visual diffs of variants, revisions, and export QA. |
| 10 | [html-to-image](https://github.com/bubkoo/html-to-image) / [modern-screenshot](https://github.com/qq15725/modern-screenshot) (MIT, 7.2k★ / 2k★) | DOM node → PNG/JPEG without server. Frames, briefs, and full canvas need static image export today; `?demo=1` fixtures and QA use screenshots already. | 8 | 10 | Low | **Adopt one now** (modern-screenshot is more maintained) for static image export and poster generation. |
| 11 | [axe-core](https://github.com/dequelabs/axe-core) (MPL-2.0, 7.4k★, active) | The standard automated accessibility engine. The spec already demands accessibility diagnostics; axe gives real a11y findings per frame, agent-actionable. | 8 | 9 | Low | **Adopt for a11y diagnostics** (MPL-2.0 is file-boundary; isolate the integration). |
| 12 | [Matter.js](https://github.com/liabru/matter-js) (MIT, 18.4k★) | 2D rigid-body physics: elements that fall, settle, collide, stack. A physics layer makes "this layout, but organic" a one-prompt design material. | 7 | 9 | Medium | **Prototype as a frame-level physics material** (opt-in, pauseable). |
| 13 | [Tone.js](https://github.com/Tonejs/Tone.js) (MIT, 14.7k★) | Web Audio synthesis and sequencing with a clean API. Voice notes become timing/duration data; sound-aware design (audio-reactive visuals, UI sounds) becomes agent-authorable. | 7 | 8 | Low | **Adopt as the audio/motion-companion layer**; keep it lazily loaded. |
| 14 | [harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) (MIT, 279★) | Real text shaping (complex scripts, kerning, features) in the browser. Accurate frame rendering and font-feature fidelity for the "render is the design" promise. | 7 | 8 | Low | **Adopt for text measurement/rendering fidelity** when custom font work starts. |
| 15 | [opentype.js](https://github.com/opentypejs/opentype.js) (MIT, 5k★, active) | Read/write OpenType fonts; extract axes, glyphs, metrics for agent-addressable typography (variable-font axis control). | 7 | 8 | Low | **Adopt for font-parameter introspection** behind a font adapter. |
| 16 | [wgsl_reflect](https://github.com/brendan-duncan/wgsl_reflect) (MIT, 292★, active) | WGSL parser + reflection: uniform/struct/size/offset extraction from compiled shaders → typed parameter schemas. The missing plumbing for TypeGPU: agent-readable shader parameters. | 8 | 9 | Low | **Adopt now** as the schema source in the effect registry. |
| 17 | [ogl](https://github.com/oframe/ogl) (MIT) | Minimal, dependency-free WebGL with no scene-graph boilerplate; agent-friendly for generated 2D/3D scenes and simpler than three.js. | 7 | 8 | Low | **Prefer over three.js for Canvas-authored scenes**; keep three.js for heavy 3D. |
| 18 | [Lenis](https://github.com/darkroomengineering/lenis) (MIT, 15.4k★, active) | High-quality smooth scrolling with a fixed update loop — the right base for scroll-linked design review and "scroll-driven" frame previews. | 7 | 9 | Low | **Adopt for scroll-linked preview/QA** inside frames. |
| 19 | [flubber](https://github.com/veltman/flubber) (MIT, 6.9k★) | Smooth SVG path morphing (linear → curved → bubble). Logo/icon morphs become a one-line agent capability; pairs with the effect registry. | 7 | 8 | Low | **Adopt as the vector-morph effect**. |
| 20 | [Floating UI](https://github.com/floating-ui/floating-ui) (MIT, 32.7k★, active) | Positioning engine for popovers, tooltips, and annotations. The editor's own overlay/comment/annotation UX (hover targeting, deictic labels) should be built on it. | 7 | 10 | Low | **Adopt for the editor's floating UI**, replacing hand-rolled positioning. |
| 21 | [dnd-kit](https://github.com/clauderic/dnd-kit) (MIT, 17.5k★, active) | Accessible drag-and-drop with sensors, sorting, and multi-container support — for the editor's own panels/rail, not the canvas's custom drag model. | 6 | 9 | Low | **Adopt for tool UI**, not frame drag. |
| 22 | [@use-gesture/react](https://github.com/pmndrs/use-gesture) (MIT, 9.6k★) | Unified pointer/touch/wheel gestures with velocity — hover-dwell detection, click-hold-to-speak semantics, drag velocity for physics materials. | 8 | 10 | Low | **Adopt now** for the pointing pillar (hover/hold/circle detection). |
| 23 | [react-zoom-pan-pinch](https://github.com/prc5/react-zoom-pan-pinch) (MIT, 1.9k★) | Reliable pan/zoom/pinch React primitives — useful as the reference pattern for the existing custom camera, or as a QA tool. | 5 | 8 | Low | **Study/reference**; don't replace the custom canvas camera. |
| 24 | [yjs](https://github.com/yjs/yjs) (MIT, 22.4k★, active) | CRDT shared types, the de-facto multiplayer layer for collaborative editors. Phase 3 multiplayer/branches/presence. | 9 | 7 | Low | **Adopt in Phase 3** for multiplayer review and live cursors. |
| 25 | [automerge](https://github.com/automerge/automerge) (MIT, 6.5k★, active) | Alternative CRDT with a JSON-like document model; simpler mental model for document-shaped state like `.wirecanvas.json`. | 7 | 8 | Low | **Evaluate head-to-head with yjs** when collaboration is scoped. |
| 26 | [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) (MIT, 13.2k★, active) | The official Model Context Protocol SDK. Round one deferred MCP; when it happens, this SDK is the wire-format-free way to expose Canvas commands to any agent client. | 8 | 8 | Low | **Adopt when the MCP adapter lands** (recommended as the post-plugin integration path). |
| 27 | [browserslist](https://github.com/browserslist/browserslist) (MIT, 13.6k★, active) | Shared browser-target queries used by Autoprefixer, Babel, etc. The responsive preset catalog can expose target-browser support and engine coverage per device preset. | 6 | 10 | Low | **Adopt for responsive presets** (device → browser-engine coverage metadata). |
| 28 | [paged.js](https://github.com/pagedjs/pagedjs) (MIT, 1.5k★) | CSS Paged Media in the browser: editorial print preview and PDF-style pagination of accepted designs. | 6 | 8 | Medium | **Adopt for print/editorial export** (poster, style-guide, and spec output). |
| 29 | [simplex-noise](https://github.com/jwagner/simplex-noise.js) (MIT, 1.8k★) | The standard seeded noise API for agent-generated textures/terrain/patterns; pairs with the seeded effect contract. | 6 | 10 | Low | **Adopt as the noise primitive** behind the effect registry. |
| 30 | [svg-path-commander](https://github.com/thednp/svg-path-commander) (MIT, 297★) | TypeScript SVG path math: transforms, alignment, normalization for agent-authored vector work. | 6 | 9 | Low | **Adopt for vector normalization** in the drawing round-trip. |

## Where the new picks plug into the spec pillars

### 1. Voice + pointing (spec section 7)

The shipped slice has the stream protocol and browser audio capture, but no activation gate and no transcription.

- `vad-web` (Silero) decides when speech is happening — the hover-to-speak and hold-to-modify behaviors become deterministic state machines, not energy thresholds.
- `transformers.js` Whisper or `vosk-browser` transcribes locally; Canvas keeps its "no LLM request while the router plugin is connected" rule because transcription never leaves the machine.
- `@use-gesture/react` supplies hover-dwell, click-hold, and circle gestures with velocity for the pointing pillar.

### 2. Durable code loop (spec sections 9.2, 10)

Round one covered the effect runtime; round two covers the text-and-token side:

- `CodeMirror 6` is the human-editable source panel where agent diffs and hand edits reconcile.
- `postcss`/`lightningcss` give a real CSS AST for semantic patches (the current `css-tree` handles CSS parsing; postcss adds plugin transforms for the reconciliation path). Note: lightningcss is MPL-2.0.
- `Style Dictionary` turns accepted design tokens into CSS variables, Tailwind configs, or native code.
- `html-to-image`/`modern-screenshot` make every accepted revision a reviewable static image, closing the "accept → see → compare" loop.
- `pixelmatch` turns those images into regression assertions for variants and revisions.

### 3. Agent authoring aids (spec sections 8, 12)

- `canvas-sketch` conventions (seed, resolution, deterministic clock) should be adopted *into* the effect registry contract, not installed as a dependency.
- `fabric.js` gives the draw-shape → canonical SVG → HTML round-trip for the point-and-draw loop.
- `culori` + `poline` make palette/gradient generation precise and diffable.
- `ogl` and `glslx` (MIT) let agents author typed shader code with compile-time checking; `wgsl_reflect` turns WGSL binaries into parameter schemas.
- `flubber` + `svg-path-commander` cover vector morph and path math.

### 4. Typography (spec sections 6.3, 8.3)

- `fontsource` (MIT, 6.1k★) self-hosts 1,500+ open fonts as npm packages — the default font catalog for frames and exports without runtime CDN.
- `opentype.js`/`harfbuzzjs` give font-metric and shaping fidelity for variable-font axes and complex scripts.

### 5. On-device AI (spec section 14, roadmap)

- `transformers.js` covers transcription, segmentation, depth, OCR, and upscaling without a server — preserving the privacy/safety posture.
- `UpscalerJS` (MIT, 896★) is the focused one-trick image-upscale adapter for imported assets.

### 6. QA and capture (spec sections 9.4, 15)

- `axe-core` for automated accessibility diagnostics per frame.
- `pixelmatch` + deterministic screenshots for visual regression.
- `lenis` for scroll-linked review; `paged.js` for editorial print output.

### 7. Collaboration (spec section 18, Phase 3)

- `yjs` or `automerge` for multiplayer document state, branches, and presence.
- `MCP SDK` when the plugin surface should serve non-Codex agents (Claude, Cursor) — the round-one "MCP later" decision, now with the official SDK.

## Suggested sequence — round one + round two combined

1. **Foundation (1–2 weeks):** effect registry schema generalized from Paper (round one); `culori` + `simplex-noise` + `wgsl_reflect` as typed color/noise/shader-schema primitives; `@use-gesture` for hover/hold/circle gestures; `vad-web` wired into the voice stream.
2. **First effects (2–3 weeks):** WebGL Fluid + Pts + dotLottie adapters (round one); `flubber` vector morph; `fabric.js` shape round-trip; `html-to-image` poster/export; `pixelmatch` diff of variant screenshots.
3. **On-device intelligence (2–4 weeks):** `transformers.js` Whisper STT + `UpscalerJS` for imported images; axe-core diagnostics panel; keep everything off-server.
4. **Programmable materials (3–6 weeks):** Motion GPU/TypeGPU pipeline (round one) with `wgsl_reflect`-derived parameter schemas; `ogl` as the lean 3D fallback; `matter-js` physics material prototype.
5. **Time and capture (3–6 weeks):** Theatre.js-style timeline (round one); WebAV recording (round one); `paged.js` print export; `lenis` scroll-linked review.
6. **Repository mode (Phase 2):** CodeMirror 6 source panel; postcss semantic patches; Style Dictionary token export; fontsource font catalog.
7. **Collaboration (Phase 3):** yjs/automerge CRDT layer; MCP SDK adapter for external agents.

## Study-only (interesting, do not casually install)

| Repository | Why interesting | Why not adopted |
|---|---|---|
| [audioMotion.js](https://github.com/hvianna/audioMotion.js) (AGPL-3.0) | Polished audio-spectrum visualizer; obvious "audio-field" effect. | AGPL-3.0; the effect concept is reproducible with Tone.js + the round-one GPU stack. |
| [p5.js](https://github.com/processing/p5.js) (LGPL-2.1, 23.9k★) | The classic creative-coding platform; agent-friendly surface. | LGPL-2.1 linking constraints; Pts/canvas-sketch conventions cover the same need permissively. |
| [paper.js](https://github.com/paperjs/paper.js) (MIT, 15.1k★) | Full vector-graphics scripting with its own scene graph. | Powerful but imposes its own document model; fabric.js fits the HTML round-trip better. |
| [MediaPipe](https://github.com/google-ai-edge/mediapipe) (Apache-2.0) | Hand/pose tracking → true deictic pointing without a mouse. | Large WASM/compute weight; revisit when pointing fidelity demands it. |
| [Konva.js](https://github.com/konvajs/konva) (MIT, 14.7k★) | Mature 2D canvas scene graph with layers/events. | Overlaps fabric.js and PixiJS (already round-one); pick one. |
| [d3](https://github.com/d3/d3) (ISC, 113.5k★) | Data-driven DOM/SVG visuals. | Broad and imperative; Plot or agent-authored HTML covers most design needs. |
| [three.js + R3F + drei](https://github.com/mrdoob/three.js) (MIT, 114.5k★) | The 3D standard; drei/R3F make it React-native. | Keep as the heavy-3D path; ogl covers agent-authored lightweight scenes with less friction. |

## Repositories intentionally filtered out

Same criteria as round one: no reusable package boundary, unclear licensing, or "wow screenshot" repos with no maintenance. Also excluded: editor shells that duplicate Canvas's own surface (Excalidraw, Penpot, tldraw-adjacent), service-dependent AI tools (no local model), and anything requiring experimental browser flags.

## Research process

GitHub API verified ~55 repositories on 2026-08-16 (license SPDX, stars, last push). Round-one picks were re-verified (TypeGPU: MIT, 2.7k★, active). Candidates came from the round-one research gaps (voice, code loop, typography, QA, collab) plus the product pillars in PROJECT_SPEC.md sections 7, 9, 10, 12, 14, 15, and 18. Licensing caveats are noted inline; re-check before adopting any dependency.
