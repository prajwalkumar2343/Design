# canvas-design

Run and visually iterate on the Canvas HTML design workspace from an agent.
One skill (`canvas-design`) plus two Playwright helpers, no MCP server required.

The skill covers the whole loop: start the dev server, open the canvas, edit
source-owned HTML/CSS or frame definitions, inspect rendered frames, capture
screenshots, and run visual QA across viewports. It refuses to run against a
project that is not a recognized Canvas workspace.

## Install

### Claude Code

```bash
/plugin marketplace add <path-to-this-repo>
/plugin install canvas-design@design
```

The skill is namespaced by the plugin: `/canvas-design:canvas-design`. It also
triggers on its own for Canvas tasks — "open Canvas", "inspect this frame",
"capture the desktop viewport", "review the responsive behavior".

### Codex

Install the plugin directory as a Codex plugin; the manifest lives at
`.codex-plugin/plugin.json`. Invoke the skill as `canvas-design`.

## What's inside

| Path | Purpose |
|---|---|
| `skills/canvas-design/SKILL.md` | The workflow: recognize the workspace, run it, edit, inspect, visual QA |
| `skills/canvas-design/references/current-project.md` | Source ownership map and the Codex-facing service APIs (`BrainstormSessionService`, `DocumentExchangeService`) |
| `scripts/capture-canvas.mjs` | Headless screenshot of the whole canvas or one `--frame`, to `.canvas/artifacts/` |
| `scripts/inspect-canvas.mjs` | JSON dump of frames, rects, selection state, and computed styles for a `--selector` |

Both helpers resolve `@playwright/test` from the target project's
`node_modules`, emit JSON on stdout, diagnostics on stderr, and exit nonzero
when the requested evidence was not produced. They only accept loopback URLs.

## Notes

- Screenshots go under `.canvas/artifacts/` in the target project — local QA
  artifacts, never deliverables.
- The workspace runs at `npm run dev -- --host 127.0.0.1`, port 5173. `/` is
  the blank Brainstorming entry; `/?demo=1` is the explicit legacy fixture path.
- There is no Canvas CLI or workspace filesystem writer. `.wirecanvas.json`
  import/export happens through the browser UI.
