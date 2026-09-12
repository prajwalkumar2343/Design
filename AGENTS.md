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

## Comments feature

- `src/comments/` — `useComments` state hook, `CommentPopover` editor card,
  `model.ts`
- Markers are rendered inside `.canvas-world`, so they counter-scale with
  `scale: 1 / camera.zoom` to stay a constant screen size.
- `CommentPopover` clamps itself inside the canvas surface via a
  `ResizeObserver` on the popover and its offset parent.
