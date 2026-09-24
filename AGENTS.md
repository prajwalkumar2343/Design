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
npm run test:e2e -- --config playwright.comments.config.ts <spec>
```

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
  fields carry a `group` ("colors" | "motion" | "sizing" | "other") used to
  render grouped inspector sections.
- `src/components/ShaderEditor.tsx` — `ShaderParamsEditor`, the shared modern
  param editor (sliders, switch, palette popovers, preset select). Used by
  both `ShadersPanel` (left list) and `PropertiesPanel`'s `ShaderDesignPanel`.
- `src/components/ColorField.tsx` — shared `ColorField`, `SwatchGrid`,
  `COLOR_SWATCHES`, `applyPickedHex`.
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
- The element node is upserted eagerly as `data:<elementId>`
  (`bridgeNodeIdForElement`) so selection/layers work before the frame's
  first bridge snapshot re-parents it under `body`.
- The drag threshold for canvas creation is screen-space (`world delta *
  zoom`), unlike the frame-unit threshold used inside frames.
- Deleting every `data-design-tool-created` node inside a freeform frame
  deletes the frame itself (see the `delete-selection` branch in
  CanvasSurface) — otherwise invisible empty shells pile up.

## Comments feature

- `src/comments/` — `useComments` state hook, `CommentPopover` editor card,
  `model.ts`
- Markers are rendered inside `.canvas-world`, so they counter-scale with
  `scale: 1 / camera.zoom` to stay a constant screen size.
- `CommentPopover` clamps itself inside the canvas surface via a
  `ResizeObserver` on the popover and its offset parent.
