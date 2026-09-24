# Visual QA evidence

Screenshots and control dumps captured by the Playwright drivers in `qa/` during the visual QA sweep. These sessions cannot be recaptured, so this file records which script produced each artifact and which captures are known to be identical.

## Provenance

Each driver writes numbered screenshots into this directory. The number prefix maps to the driver.

| Prefix | Driver | Covers |
| --- | --- | --- |
| 01-32 | `qa/visual-qa.mjs` | Lake and canvas sweep. Lands on the lake, clicks every control, opens the demo canvas, repeats. Also writes `lake-controls.json`, `canvas-controls.json`, and `findings.json`. |
| 101-111 | `qa/visual-qa2.mjs` | Tokens panel, shader menu, properties panel, comments. |
| 201-204 | `qa/visual-qa3.mjs` | Rect draw and select, comment open and close. |
| 301-307, 390-391 | `qa/visual-qa4.mjs` | Template create, blank chooser, tokens tab. |
| 401-410 | `qa/visual-qa5.mjs` | Tokens inside a project, mobile overflow at 390x844. |
| 501-504 | `qa/visual-qa6.mjs` | Dark theme, token create form, exports. |
| 601-605 | `qa/verify-fixes.mjs` | Targeted fix verification. |
| 700-707 | `qa/visual-qa7.mjs` | Shader menu, shaders panel, param edit, pages panel, right sidebar. |
| 801-806 | `qa/visual-qa8.mjs` | Viewport sweep of lake and canvas at 1440, 1024, and 800 wide. |
| 901-905 | `qa/shader-inspector.mjs` | Shader inspector and color popover. |
| 910 | `qa/measure.mjs` | Left shader editor measurement. |

The drivers were edited between runs during the capture session, so some filenames do not match the committed scripts. In the 200 range, `201-rect-100pct.png`, `201-rect-full-view.png`, `202-comment-open.png`, and `203-comment-closed.png` are from an earlier version of `visual-qa3.mjs`. In the 300 range, `305-brainstorm-started.png` and `391-mobile-lake.png` are from an earlier `visual-qa4.mjs`. `700-label-zoom.png`, `900-canvas-1024-fixed.png`, `901-canvas-1024-wrap.png`, `902-final-state.png`, `903-popover-edge.png`, and `904-popover-clamped.png` are from earlier versions of the 700 and 900 range drivers.

`qa/driver.mjs`, `qa/thumbshot.mjs`, and `qa/probe*.mjs` write to `qa/evidence/`, not this directory.

## findings.json

`findings.json` records only the `qa/visual-qa.mjs` run, the sweep that produced screenshots 01-32 and the two control dumps. The `_meta.coverage` field in the file says the same, and the driver writes that field on every run. The other drivers print their diagnostics to stdout and save screenshots but write nothing to `findings.json`.

## Known-identical captures

Some clicks produced no visible change and some drivers re-captured the same state, so different filenames can hold identical bytes. Byte identity was checked with `shasum -a 256 *.png`.

Ten duplicate files were removed. Each was byte-identical to the file listed, so no visual state was lost.

| Removed file | Identical to | Why the bytes matched |
| --- | --- | --- |
| `301-lake-landing.png` | `01-lake-01-landing.png` | An earlier driver run re-captured the lake landing. |
| `302-lake-new-menu.png` | `02-lake-click-new-file-button.png` | Same lake view with the new-file menu open. |
| `303-project-created.png` | `03-lake-click-lake-filter-blank.png` | The label claimed a created project. The capture still shows the lake with the blank filter applied, so navigation had not happened at capture time. |
| `304-empty-canvas.png` | `03-lake-click-lake-filter-blank.png` | Same run state as `303-project-created.png`. The label claimed an empty canvas. |
| `304-tokens-real.png` | `303-blank-created.png` | The driver clicks the Tokens tab between the two shots, but the captures are identical. The click produced no visible change, and the driver swallows a missed click with `.catch(() => {})`. |
| `306-tokens-project.png` | `305-brainstorm-started.png` | The tokens interactions in that run produced no distinct capture. |
| `307-tokens-full.png` | `305-brainstorm-started.png` | Same run state as `306-tokens-project.png`. |
| `390-mobile-canvas.png` | `410-mobile.png` | Same demo canvas at 390x844. |
| `401-project-opened.png` | `01-lake-01-landing.png` | The label claimed an opened project. The capture still shows the lake landing. |
| `402-project-final.png` | `01-lake-01-landing.png` | Same run state as `401-project-opened.png`. |

Three kept files are also byte-identical to another file in the set. Their labels are accurate and the identical bytes are themselves evidence.

| Kept file | Identical to | Why |
| --- | --- | --- |
| `18-lake-02-after-sweep.png` | `11-lake-click-lake-filter-app-wireframe.png` | The lake sweep's final state matches the app-wireframe filter view. |
| `105-shader-menu-scrolled.png` | `104-shader-menu-top.png` | Setting `scrollTop = 500` on the shader menu produced no visual change. |
| `801-lake-1440.png` | `01-lake-01-landing.png` | Same page at the same 1440x900 viewport. `801` anchors the viewport sweep. |
