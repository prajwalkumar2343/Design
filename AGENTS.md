# Project notes

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — `tsc -b && vite build`
- `npm test` — Vitest unit/component tests
- `npm run test:e2e` — Playwright suite (builds, then previews on port 4173)

## E2E port note

Port 4173 is occupied on this machine by a preview server for
`~/Design-ui-polish` (a different checkout), which serves stale code.
Use `playwright.comments.config.ts` (or create a similar config on a
free port) to run e2e tests against this checkout:

```
npm run build && npm run test:e2e -- --config playwright.comments.config.ts <spec>
```

## Dev-server caveat

Run only ONE dev server on this checkout. Concurrent `vite` processes
(especially `--force`) share `node_modules/.vite/deps` and stomp each other's
optimized bundles — pages on other ports then hit chunk 404s / stale-hash
`SyntaxError`s, and lazily imported features (shader elements) surface as
"failed to load" even though the code is fine. Check `lsof -iTCP -sTCP:LISTEN
| grep vite` and kill extras before debugging.

## Concurrent editing

Other agent/tool processes write to this working tree while a session is
active (Vite HMR fires for files you never touched). Do NOT run `git stash`
here — a stash+pop mid-write can tear files (dropped declarations, duplicated
tails). If the tree suddenly breaks, check `git fsck --unreachable` for recent
dangling stash commits before hand-repairing.

## Shader elements

- `src/shaders/canvas-model.ts` — `CanvasShaderElement` (x/y/w/h in world
  coords, `params`, `radius`), size/radius clamps.
- `src/shaders/params.ts` — `ShaderParamField` + `deriveShaderParamFields`;
  fields carry a `group` ("color" | "param" | "motion" | "sizing") used to
  render grouped inspector sections.
- `src/components/ShaderEditor.tsx` — `ShaderParamsEditor`, the shared modern
  param editor (sliders, switch, palette popovers, preset select). Used by
  both `ShadersPanel` (left list) and `PropertiesPanel`'s `ShaderDesignPanel`.
  `applyPickedHex` lives here too.
- `src/components/ColorField.tsx` — shared `ColorField`, `SwatchGrid`,
  `COLOR_SWATCHES`. Fill/Background fields pass `onPickGlass`, which leads
  the grid with a Glass pseudo-swatch that applies the glass effect
  (`DEFAULT_GLASS_LEVEL` in `src/editor/effects.ts`) instead of a color.
- `src/components/useLoadedShader.ts` — the shared loader hook behind
  `ShaderElementView`, `ShaderMenu` previews, `ShaderThumbCapture`, and
  `ShaderParamsEditor` (`checkSupport:false` — it only needs presets, not
  GL). `loadPaperShader` dedupes per id and retries chunk fetches with
  backoff; failures classify as `unsupported` | `unknown` | `load-error`
  and the element UI offers Retry except for `unknown`.
- `SafeShaderMount` owns GL lifecycle: releases contexts on unmount,
  remounts the shader on `webglcontextrestored` (or after a grace period),
  capped at 4 remounts so eviction storms can't ping-pong.
- Shader selection lives in `CanvasSurface` (`selectedShaderElementId`);
  `ShaderElementView` ignores outside pointerdowns inside
  `[data-canvas-control]` so inspector edits don't deselect.

## Freeform (canvas-drawn) elements

- Drawing on empty canvas mints a chromeless **freeform frame**
  (`FrameEntity.freeform`, `data-freeform` on `.canvas-frame`, transparent
  background, no border/shadow). Its srcDoc carries the element markup baked
  in by `src/frame/freeform.ts`, which must mirror the DOM that
  `createElementFromSpec` in `src/bridge/runtime.ts` produces — keep them in
  sync or snapshot/persistence round-trips diverge.
- Bridge element ids are frame-scoped: `frm~<frameId>~<raw>` where `<raw>` is
  `data:<encoded>`, `id:<encoded>`, or `path:<dom-path>` — see
  `bridgeElementScope`/`unscopeBridgeElementId` in `src/bridge/protocol.ts`.
  The scope keeps identical DOM structures in different frames distinct in the
  flat node map; `wirecanvas.ts` migrates legacy unscoped ids on load.
- The freeform element node is upserted eagerly as
  `bridgeNodeIdForElement(frameId, elementId)` so selection/layers work
  before the frame's first bridge snapshot re-parents it under `body`.
- The drag threshold for canvas creation is screen-space (`world delta *
  zoom`), unlike the frame-unit threshold used inside frames.
- Deleting every `data-design-tool-created` node inside a freeform frame
  deletes the frame itself (see the `delete-selection` branch in
  CanvasSurface) — otherwise invisible empty shells pile up.
- `buildFreeformDocument` must keep `overflow:hidden` on `html` only, never
  `body`: the gesture fit re-anchors content by translating `<body>`, and a
  transformed body's own overflow clips `position:fixed` elements to the
  shifted box (shape paints as a sliver / appears stuck at the old frame
  bounds while moving).
- `ShapePreview` (`src/frame/shape-geometry.tsx`) must mirror the committed
  markup exactly: painted shapes commit with `stroke-width:0` and no inset,
  and bounds use `normalizedBounds(start, end, 1)` like the creation path —
  any divergence shows as an outline during draw or a size pop on commit.

## Agent bridge

- `vite-plugin-canvas-agent.ts` (repo root, registered in `vite.config.ts`)
  serves the loopback bridge on dev AND preview servers:
  `POST /__canvas-agent/op`, `GET /inbox?after=`, `POST /result`,
  `GET /result?seq=` (long-poll), `GET /ping`. In-memory queues per server.
- `src/agent-bridge/` — `protocol.ts` (op types: `push`/`remove`/`list`, plus
  html/fragment/css → doctype-doc normalization), `apply.ts` (`applyAgentOp`
  on the editor store — upsert creates a design-mode frame on the active page
  or replaces the doc when `id`/`documentId` matches), `client.ts`
  (`startAgentBridge` poll loop).
- `CanvasSurface` starts the poller in dev, or with `?agent=1` on preview.
- Agent-facing CLI: `plugins/canvas-design/scripts/push-design.mjs`
  (`--html/--css/--fragment/--id/--list/--remove/--stdin`). Design pushes are
  refused during an active brainstorm session (wireframe-only guard).

## Comments feature

- `src/comments/` — `useComments` state hook, `CommentPopover` editor card,
  `model.ts`
- Markers are rendered inside `.canvas-world`, so they counter-scale with
  `scale: 1 / camera.zoom` to stay a constant screen size.
- `CommentPopover` clamps itself inside the canvas surface via a
  `ResizeObserver` on the popover and its offset parent.
