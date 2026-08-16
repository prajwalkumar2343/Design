# Open-source visual runtimes for Canvas

Research date: 2026-08-14  
Project evaluated: `agent-native-design-canvas` (React 19, Vite, iframe-rendered HTML/CSS documents, DOM bridge, node overlays, Paper shader registry)

## Bottom line

The strongest direction is not to accumulate isolated effect components. Canvas should gain a **serializable visual-runtime contract** that the agent can author inside normal HTML:

```html
<canvas-effect
  type="reaction-diffusion"
  palette="ink,ivory,signal-red"
  seed="42"
  interaction="pointer-velocity"
  quality="adaptive">
</canvas-effect>
```

The host resolves that declaration to a vetted renderer, exposes typed parameters to the properties panel and agent, pauses it off-screen, honors reduced motion, and captures it deterministically. This preserves the project's principle that HTML is the source while allowing visuals that ordinary DOM/CSS tools cannot produce.

The recommended stack is:

1. **TypeGPU + Motion GPU** for a typed WebGPU effect runtime and multi-pass/feedback simulations.
2. **Motion** for production UI motion and gesture/layout transitions.
3. **Theatre.js-style timeline data** (adopt the core or the concepts) for inspectable keyframes across DOM and GPU parameters.
4. **PixiJS** for dense 2D scenes, particles, sprites, masks, blend modes, and pixel-native work.
5. **dotLottie Web + Rive runtime adapters** for imported interactive vector motion.
6. **WebAV or Diffusion Studio Core** for deterministic browser-native recording and export.

## Ranked recommendations

Scores are project-fit judgments, not generic library rankings. `Impact` is the amount of new design territory unlocked; `Fit` is compatibility with the current React/Vite/iframe/HTML-source architecture; `Risk` includes maturity, browser support, licensing, and integration complexity.

| Priority | Repository | What it unlocks here | Impact | Fit | Risk | Recommendation |
|---:|---|---|---:|---:|---:|---|
| 1 | [TypeGPU](https://github.com/software-mansion/TypeGPU) | Type-safe shaders written from TypeScript, compute pipelines, agent-readable parameter schemas, and safer generated GPU code. MIT; 2.6k stars and a multi-contributor codebase. | 10 | 9 | Medium | **Adopt as the long-term GPU foundation.** Keep a WebGL/Paper fallback while WebGPU coverage settles. |
| 2 | [Motion GPU](https://github.com/motion-core/motion-gpu) | Shadertoy-like WGSL, render graphs, named targets, ping-pong feedback, compute passes, diagnostics, profiling, and React 19 bindings in a focused ~25 kB-gzip runtime. | 10 | 10 | Medium-high | **Pilot behind an effect adapter.** It is unusually well matched but young (created in 2026, two contributors). |
| 3 | [Motion](https://github.com/motiondivision/motion) | Springs, gestures, layout transitions, scroll-linked motion, timelines, interruption, and native/JS hybrid animation for real DOM. MIT and widely used. | 8 | 10 | Low | **Adopt now.** This should be the default DOM-motion vocabulary exposed to the agent. |
| 4 | [Theatre.js](https://github.com/theatre-js/theatre) | A visual sequence editor that can animate DOM, SVG, Three.js, shader uniforms, or any JS variable—ideal for a shared agent/human timeline. Apache-2.0. | 9 | 9 | Medium | **Prototype the timeline model.** Public development is temporarily paused while 1.0 is developed privately, so isolate the dependency. |
| 5 | [PixiJS](https://github.com/pixijs/pixijs) | A mature WebGL/WebGPU 2D renderer for huge particle fields, sprites, masks, custom filters, blend modes, pixel art, and touch interaction. MIT. | 9 | 8 | Low-medium | **Adopt as an opt-in 2D scene node**, not as a replacement for the HTML canvas. |
| 6 | [dotLottie Web](https://github.com/LottieFiles/dotlottie-web) | Lottie/dotLottie playback through Rust/WASM with software, WebGL2, and experimental WebGPU backends; state machines, themes, slots, audio, workers, and React. MIT and actively released. | 8 | 9 | Low | **Adopt for imported motion assets.** Expose state-machine inputs and slots as agent-editable properties. |
| 7 | [WebAV](https://github.com/WebAV-Tech/WebAV) | WebCodecs-based recording, compositing, audio/video editing, spatial/temporal sprites, and local export with an MIT SDK. | 8 | 8 | Medium | **Use for the first deterministic capture/export path.** It is smaller and more permissive than full editor codebases. |
| 8 | [Bezier SDF](https://github.com/axelwp/bezier-sdf) | GPU-rendered SVG silhouettes with crisp arbitrary zoom, reveals, ripples, liquid cursor, refractive glass, and shape morphing; WebGPU, WebGL, then SVG fallback. MIT. | 9 | 9 | High | **Run a focused spike.** Technically exceptional and directly useful, but only three stars and one primary contributor. Pin versions. |
| 9 | [three-text](https://github.com/countertype/three-text) | HarfBuzz shaping, CJK/RTL, variable fonts, TeX-style layout, mesh/extruded type, and resolution-independent GPU vector outlines. MIT. | 9 | 7 | High | **Prototype kinetic/editorial typography.** The project explicitly labels itself alpha; pin it and keep plain DOM text as fallback. |
| 10 | [WebGL Fluid Enhanced](https://github.com/michaelbrusegard/webgl-fluid-enhanced) | Pointer-driven Navier–Stokes fluid, configurable splats, bloom, transparency, capture resolution, mobile support, and a zero-dependency package. MIT. | 8 | 9 | Medium | **Excellent first non-Paper effect.** Wrap it as a custom element with adaptive quality and pause/offscreen behavior. |
| 11 | [Pts](https://github.com/williamngan/pts) | A compact TypeScript geometry/creative-coding vocabulary for points, intersections, shapes, sound, Canvas, and SVG. Apache-2.0. | 7 | 9 | Low | **Adopt for agent-generated diagrams and procedural motifs.** Much easier for an agent to author than raw Canvas APIs. |
| 12 | [Diffusion Studio Core](https://github.com/diffusionstudio/core) | Declarative timelines for video/audio/images, clips, masks, transitions, effects, keyframes, realtime editing, and final rendering via WebCodecs. MPL-2.0. | 9 | 7 | Medium | **Evaluate for a later motion/video mode.** Stronger composition model than WebAV, but larger scope and copyleft-at-file-boundary licensing. |
| 13 | [Rive WASM](https://github.com/rive-app/rive-wasm) | Interactive vector artboards, animations, state machines, data binding, events, and custom render-loop control. MIT runtime (the editor/file-authoring ecosystem is separate). | 8 | 8 | Low-medium | **Add as a second imported-motion adapter** when stateful product illustrations matter. |
| 14 | [Spargo](https://github.com/darkroomengineering/spargo) | Real-time GPU image dithering with a tiny, focused WebGL implementation. MIT. | 6 | 8 | Medium-high | **Mine or wrap as one effect**, not a platform dependency; small project with eight stars. |

## High-value references to study, not blindly install

| Repository | Why it is fascinating | Why it is not in the default dependency plan |
|---|---|---|
| [LYGIA](https://github.com/patriciogonzalezvivo/lygia) | A huge granular shader-function library spanning GLSL, WGSL/WESL, HLSL, Metal, and CUDA. It could give the agent a vocabulary of SDF, noise, color, sampling, lighting, and generative primitives. | The current license is not reported as a standard permissive license and individual files show Prosperity/Patron terms. Perform legal review or use it as conceptual/reference material. |
| [Hydra Synth](https://github.com/hydra-synth/hydra-synth) | The best compositional visual-synth mental model: sources, transforms, feedback buffers, audio, and chained operations. A natural language agent could author Hydra-like graphs very effectively. | AGPL-3.0 and described as experimental. Reproduce the *graph vocabulary* in your own permissively licensed runtime instead of embedding it casually. |
| [Liquid DOM](https://github.com/AndrewPrifer/liquid-dom) | WebGPU liquid glass, React bindings, a renderer-agnostic layout engine, Three/R3F bridges, and live DOM compositing. | DOM-backed rendering currently requires Chrome's experimental HTML-in-Canvas flag; Exa did not surface a standard license. Treat as R&D. |
| [tldraw](https://github.com/tldraw/tldraw) | Best-in-class custom tools, shapes, bindings, snapping, sync, event hooks, runtime Editor API, and LLM-oriented canvas primitives. | The current repository license is nonstandard. Also, replacing the existing canvas would be a major architectural detour. Study its tool/state model and licensing before reuse. |
| [Triplex](https://github.com/pmndrs/triplex) | A visual workspace for React and React Three Fiber that demonstrates code-first 2D/3D component editing. Its source-to-scene ideas are close to Canvas's future import/reconciliation path. | Exa did not surface a license, and it is more valuable as an architecture reference than a runtime dependency. |
| [Excalimate](https://github.com/excalimate/excalimate) | Timeline + camera animation + MP4/WebM/GIF/animated-SVG/Lottie export plus a 35-tool MCP server and live SSE preview. This is direct evidence that agent-driven motion editing works. | The repository itself cautions that substantial AI-generated code is still being cleaned up. Use its typed MCP action vocabulary as inspiration. |
| [Reframe](https://github.com/ilya-makarov-dev/reframe) | Very close product thesis: agent-native HTML/AST design, live iframes, audit scores, motion/video, Playwright capture, and reproducible agent workflows. | AGPL-3.0 and a young codebase. Treat it as a competitor/reference, not drop-in code. |

## The product features these repos predict

### 1. Effects become semantic, not implementation-specific

The agent should request `reaction-diffusion`, `ink-advection`, `vector-morph`, `dither-print`, or `audio-field`—not choose a package. A registry maps the semantic effect to Paper, WebGL, WebGPU, Pixi, SVG, or a static fallback based on browser capabilities and the frame's reduced-motion profile.

This is the natural evolution of the existing `src/shaders/registry.ts`: generalize it from a Paper-only catalog into a renderer-independent effect registry with a shared schema.

### 2. Every visual parameter becomes addressable by voice and timeline

Shader uniforms, variable-font axes, Pixi filters, Rive state-machine inputs, and DOM properties should all appear as the same typed `AnimatableProperty`:

- value and type
- valid range / enum
- units and color space
- keyframes and easing
- responsive overrides
- interaction bindings (pointer, scroll, audio, time, data)
- reduced-motion fallback

Then “make the distortion arrive half a second after the headline” is one operation whether the target is CSS, WebGPU, SVG, or Rive.

### 3. “Motion” expands into live material behavior

The most original outcomes will come from feedback and compute, not entrance animations: ink that remembers cursor movement, typography whose weight reacts to velocity, images that diffuse into a grid, halftones whose dot field bends around a button, or a background that grows a topology from real product data.

Motion GPU's ping-pong passes and TypeGPU's compute model are the key primitives. This is design territory Figma-like vector tools cannot faithfully represent.

### 4. Agent-generated effects need deterministic identity

Every procedural design needs a seed, time source, capability profile, and capture clock. Without these, the same prompt produces an unreviewable moving target and screenshots differ between frames. Store:

- `seed`
- fixed or live `clockMode`
- `qualityTier`
- `rendererVersion`
- parameter schema version
- fallback snapshot/poster

This makes animated work branchable, diffable, testable, and exportable.

### 5. The property panel becomes a temporary instrument

When the agent introduces an unfamiliar renderer, Canvas can generate controls from its parameter schema: palette wells, curves, ranges, blend modes, vectors, audio bands, and interaction maps. The user tweaks the result directly; the values serialize back into HTML. This is more scalable than hand-building UI for each effect.

### 6. Capture becomes a design primitive

The same frame should support live preview, scrubbed deterministic preview, and export. WebAV/Diffusion Studio-style composition plus a fixed animation clock enables:

- product demos from real HTML
- social loops from selected frames
- responsive motion comparisons
- animated SVG/Lottie handoff
- MP4/WebM/GIF capture
- motion regression tests at exact frames

## Suggested implementation sequence

### Phase 1 — 1–2 weeks: immediate visual range

1. Generalize the Paper registry into `EffectDefinition` with typed params, capability requirements, fallback, and lazy loader.
2. Add Motion for DOM gestures/layout/scroll animation.
3. Add one adapter each for WebGL Fluid Enhanced, Pts, and dotLottie.
4. Add offscreen pausing, DPR caps, reduced-motion behavior, and static poster generation before shipping any continuous renderer.

### Phase 2 — 2–4 weeks: programmable GPU materials

1. Spike Motion GPU inside a frame with WebGPU → WebGL/Paper → poster fallback.
2. Use TypeGPU for schemas, buffers, and compute-safe shader generation.
3. Expose a small curated library: feedback ink, reaction diffusion, particle advection, SDF field, pixel-sort-like displacement, dither/halftone, and audio spectrum deformation.
4. Extend the iframe bridge with effect inspection and `setEffectParam`, rather than exposing arbitrary shader source mutation first.

### Phase 3 — 3–6 weeks: time as a first-class dimension

1. Introduce a renderer-neutral `AnimatableProperty` and timeline data model.
2. Prototype Theatre.js or a smaller headless timeline behind that boundary.
3. Bind DOM properties, shader uniforms, Rive inputs, and variable-font axes to the same tracks.
4. Add fixed-clock playback and visual tests at selected timestamps.

### Phase 4 — capture and agent-native authoring

1. Add WebAV-based recording/export; evaluate Diffusion Studio Core when layered editing becomes a product requirement.
2. Expose typed router capabilities such as `insert_effect`, `set_effect_params`, `bind_effect_input`, `add_keyframes`, `set_seed`, and `capture_sequence`.
3. Let the agent create multiple seeded variants side by side, then merge chosen palette, motion, and interaction traits.

## Three small bets with outsized payoff

1. **GPU SVG marks:** try Bezier SDF for logos and icons that morph, refract, ripple, or behave like a fluid while remaining crisp at every zoom.
2. **Responsive typography physics:** combine Motion velocity with variable-font axes; weight, width, slant, or optical size can respond to drag speed, scroll, or proximity.
3. **Dither as a material, not a filter:** use a GPU dot/ASCII/halftone field whose sampling grid bends around interface elements and reacts to focus—not merely a static image conversion.

## Repositories intentionally filtered out

I excluded most “Awwwards clone,” one-off portfolio, shader dump, and AI-generated demo repositories even when screenshots looked impressive. They tended to have no reusable package boundary, unclear licensing, no fallback/accessibility story, or little evidence of maintenance. I also avoided recommending Three.js/React Three Fiber as the universal answer: they remain useful for true 3D scenes, but a focused 2D/GPU pipeline is a better fit for most of this product's design effects.

## Research process

Exa was used for 354 search-result reviews across five territories: GPU/shader runtimes; generative typography/vector/pixel systems; motion/physics/interaction; visual-editor and agent architectures; and browser-native timeline/export engines. Results were deduplicated by repository, filtered for extractable libraries and source availability, then the strongest 22 repositories were fetched directly for README, license, feature, contributor, and maturity validation. The ranked set above favors practitioner-built repositories with working packages and concrete APIs over commentary and generic roundup articles.
