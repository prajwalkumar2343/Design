# Current Canvas Project

Use this reference for the repository's current implementation. Re-check the files because the project will evolve.

## Source ownership

- `src/App.tsx` mounts the canvas.
- `src/canvas/CanvasSurface.tsx` currently owns frames, camera, selection, and interaction state in React.
- `src/canvas/types.ts` defines `CanvasFrame`, including the complete `srcDoc` HTML string.
- `src/frame/FrameView.tsx` renders live documents in sandboxed iframes.
- `src/demo/documents.ts` currently owns the demonstration HTML/CSS and initial responsive frame definitions.
- `src/frame/presets.ts` owns the available frame presets.
- `tests/e2e/canvas.spec.ts` contains the browser-level Canvas interaction checks.

## Present capabilities

- Start the workspace with the package's `dev` script.
- Edit HTML and CSS through source-owned `srcDoc` content.
- Add responsive frames through existing UI controls or source definitions.
- Select and move frames through the Canvas UI.
- Inspect the running page and iframe documents with Playwright.
- Capture visual evidence with the plugin's native helper scripts.

## Capabilities not implemented yet

Do not pretend these interfaces exist:

- A `canvas` CLI.
- Durable design-state persistence.
- Direct CLI commands for frame creation or DOM selection.
- A source-to-DOM mapping service.
- Undo/redo across agent edits.
- A native runtime command bridge.

Until the project implements those features, use source edits for durable changes and browser interaction for transient UI state.
