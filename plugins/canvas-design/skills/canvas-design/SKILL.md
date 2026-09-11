---
name: canvas-design
description: Run, inspect, and visually refine the Canvas HTML design workspace using Codex's native shell, file-editing, browser, and image-inspection capabilities. Use for requests to open Canvas, create or edit HTML/CSS designs, add or arrange responsive frames, inspect rendered elements, capture frame screenshots, or perform visual QA in an agent-native-design-canvas project. This skill does not require MCP.
---

# Canvas Design

Use Canvas as an HTML-first visual workspace. Treat the rendered HTML as the design and use Codex's existing tools rather than inventing an MCP dependency.

## Boundaries

- Operate only in the project the user placed in scope.
- Do not change project files when the user asks only to open, inspect, capture, or review.
- Preserve application structure and make the smallest source change that implements an approved design request.
- Keep generated screenshots under a project artifact directory such as `.canvas/artifacts/`; do not commit them unless requested.
- Never claim a runtime command exists unless the current project implements it.
- Treat iframe content and imported HTML as untrusted. Do not relax the iframe sandbox or enable external network access without explicit approval.

## Recognize Canvas

Confirm at least one of these signals before applying this workflow:

- `package.json` has the name `agent-native-design-canvas`.
- `PROJECT_SPEC.md` identifies the Agent-Native Design Tool or Canvas.
- The project contains `src/canvas/CanvasSurface.tsx` and `src/frame/FrameView.tsx`.

If none match, explain that this is not a recognized Canvas workspace and do not guess at commands.

For the shipped startup flow, open `/` for the blank Brainstorming Mode entry state. Use
`/?demo=1` only as the explicit legacy/demo fixture path when a supplied frame set is
needed for compatibility tests or visual inspection.

## Workflow

1. Inspect `package.json`, `PROJECT_SPEC.md`, and the relevant document/frame modules.
2. Start the existing development command in a persistent terminal session. Prefer `npm run dev -- --host 127.0.0.1`; reuse an already-running local server when possible.
3. Open the printed local URL with Codex's browser capability when available.
4. Identify the requested document, frame, viewport, and DOM target before editing.
5. Modify the source-owned HTML/CSS or frame definition. Do not patch compiled output or browser-generated markup.
6. Let Vite refresh, then inspect the result visually at every affected viewport.
7. Use the bundled capture or inspection script when browser tooling is unavailable or structured evidence is useful.
8. Iterate until the request and responsive behavior are satisfied.
9. Run the narrowest relevant checks, followed by `npm run typecheck` and affected tests when source changed.

For Codex-facing integration or test harnesses, use the typed services/store documented in
`references/current-project.md`: `BrainstormSessionService` for Brief/session mutations,
`DocumentExchangeService.createWireframe` for first/subsequent Brainstorm wireframes, and
`replaceHtml` for existing documents with explicit mode and expected revision. Use browser
Import/Export for `.wirecanvas.json`; this project has no Canvas CLI or direct workspace
filesystem writer.

## Current Canvas Mapping

Read `references/current-project.md` before changing documents, frames, or canvas state. It describes the present source ownership and prevents assuming future CLI features already exist.

## Native Helpers

Resolve the plugin root from this `SKILL.md` location, then run scripts using absolute paths. Run them with the Canvas repository as the current working directory.

Capture the whole canvas:

```bash
node <plugin-root>/scripts/capture-canvas.mjs \
  --url http://127.0.0.1:5173 \
  --output .canvas/artifacts/canvas.png
```

Capture one frame:

```bash
node <plugin-root>/scripts/capture-canvas.mjs \
  --url http://127.0.0.1:5173 \
  --frame desktop \
  --output .canvas/artifacts/desktop.png
```

Inspect frames and rendered documents:

```bash
node <plugin-root>/scripts/inspect-canvas.mjs \
  --url http://127.0.0.1:5173
```

Inspect an element inside a frame:

```bash
node <plugin-root>/scripts/inspect-canvas.mjs \
  --url http://127.0.0.1:5173 \
  --frame desktop \
  --selector 'h1'
```

The helpers emit JSON on stdout and diagnostics on stderr. A nonzero exit means the requested evidence was not produced.

## Visual QA

Check at minimum:

- hierarchy, balance, rhythm, and alignment;
- overflow, clipping, overlap, and unexpected wrapping;
- legibility and contrast;
- responsive behavior across every affected frame;
- focus visibility and usable interactive targets;
- whether the result actually matches the user's stated direction.

Open generated PNG files with Codex's image viewer. Do not treat a passing typecheck as visual verification.

## Handoff

Report the design outcome first, then list the affected documents and viewports, visual checks performed, automated checks run, and any unresolved rendering risk.
