# Bug Audit — consolidated report

10 parallel read-only audits over `src/` + `vite-plugin-canvas-agent.ts`.
~130 raw findings; duplicates across audits are merged below (multi-audit
finds marked with ×N — higher confidence). No code was changed.

Severity is the auditors' judgment of confidence × user impact.

---

## High severity

### H1. Cross-document node-ID collisions corrupt multi-document projects ×3
`src/bridge/runtime.ts:159-168` · `src/canvas/CanvasSurface.tsx:2162-2193` · `src/editor/reducer.ts:645-681` · `src/canvas/CanvasSurface.tsx:1920`
`elementId()` emits document-unscoped ids (`path:html[1]`, `path:html[1]/body[1]`, `id:fig-root`, …) that repeat identically in every document. All snapshots upsert into the flat `state.nodes` map, so the last frame to snapshot steals the ids — `documentId`/`frameId` transfer while the old document's `rootNodeIds` still lists them. Consequences:
- `validateRelations` fails → **exported projects cannot be re-imported** (strict parse, `wirecanvas.ts:807`), localStorage reloads only survive via silent repair that flattens the loser document's layer tree.
- Clicking an element in the frame that lost ownership throws `EditorReducerError("Node parent belongs to another document")` (reducer.ts:586-588) — selection silently dead in that frame until it re-snapshots.
- `name`/`locked`/`hidden`/`attributes` bleed between same-id nodes across documents.

Trigger: two freeform frames, multi-artboard Figma imports, multiple agent pushes. Masked for presets only because they share `documentId: "fieldwork"`.

### H2. Reparenting detaches from the wrong document ×3
`src/editor/reducer.ts:599-604` · `reducer.ts:654-662`
In `node/upsert` and `nodes/upsert-many`, the root-detach branch filters `documents[action.node.documentId].rootNodeIds` (the **new** doc) instead of `previous.documentId` (the old one), and the whole detach is gated on `parentId` changing — a root→root document move never detaches. Leaves stale `rootNodeIds` that `validateRelations` rejects on load. The line-level defect that makes H1 destructive.

### H3. Clicking a frame never deselects a selected shader element
`src/canvas/CanvasSurface.tsx:882,3961` · `src/components/ShaderElementView.tsx:90-99` · `PropertiesPanel.tsx:990`
`ShaderElementView` deselects via a window-level `pointerdown` listener, but `beginFramePointer`/`beginBriefFramePointer`/`beginCanvasPan` call `stopPropagation()` — React 18 stops the native event at the root container so `window` never sees it. `setSelectedFrameId` also never clears `selectedShaderElementId`. Result: shader chrome stays visible, PropertiesPanel shows `ShaderDesignPanel` instead of the frame panel, and Delete/Backspace hits the shader instead of the frame.

### H4. Token rename/create bypasses the duplicate-name guard → entire token store wiped on next load ×3
`src/components/TokensPanel.tsx:709-752` · `src/editor/reducer.ts:238-253` · `src/persistence/wirecanvas-repair.ts:361-368` · `src/router/tokens.ts:321-325`
- `tokens/upsert-token` never checks for duplicate `name` inside a set (the `validateTokenSet` rule is only applied elsewhere). Both the panel create flow and the agent token router reach it.
- `saveEdit` calls `onRenameToken` then unconditionally `onUpsertToken`; `runTokenMutation` (CanvasSurface.tsx:1987-1996) catches the reducer's "already exists" throw as a toast, so the upsert still runs and writes a duplicate.
- The invalid store serializes fine but fails `validateTokenStore` on next open; `repairTokens` then returns `createEmptyTokenStore()` — **all variables silently gone**.
- Create path also skips `validateTokenName`: invalid names are swallowed by `runTokenMutation`, the sheet closes, and the draft is discarded.

### H5. Codex provider path is dead (request shape violates backend requirements)
`src/llm/codex.ts:68-82` · `src/harness/provider/subscription.ts:41-46` · `src/harness/provider/openai-responses.ts:161-166`
The ChatGPT Codex backend hard-requires `stream: true` + `store: false` and rejects `max_output_tokens`. `CodexClient.chat` sends `stream: false`, omits `store`, forwards `max_output_tokens`/`temperature`, then calls `response.json()` on the mandatory SSE stream. `SubscriptionModelProvider("codex-chatgpt")` has the same defect. Every codex-chatgpt request fails.

### H6. Bridge protocol drops any message containing control characters — inspections and text edits break ×2
`src/bridge/protocol.ts:488,723,790` · `src/bridge/runtime.ts:1328,1445`
`isValidString` rejects `[\u0000-\u001f\u007f]` — including `\n`, present in `textContent` of every container in formatted HTML.
- `inspect()` responses with newlines fail `isInspection` → dropped → `transport.inspect` times out after 5s → error badge, `isCreatedVector`/`isCreatedTarget` detection breaks.
- `text-edit-start` with `\n` drops → `frameTextEditRef` never set → forwarded keys run canvas shortcuts while typing (Backspace deletes the element being edited). `text-commit` drops → `activeTextEdit.pending="commit"` wedges the edit session and suppresses top-level shortcuts until in-iframe Escape.

### H7. Iframe-forwarded keydowns fire editor shortcuts while typing in frame inputs ×3
`src/bridge/runtime.ts:1951-1966` · `src/canvas/CanvasSurface.tsx:1785-1792` · `src/editor/shortcuts.ts:26-76`
The runtime forwards **every** in-iframe `keydown` unfiltered; `handleBridgeEvent` resolves them through `resolveEditorShortcut` with no `isTypingTarget` guard (the top-level listener at :4518 has one). Typing `v`/`r`/`0` inside an `<input>`/`<textarea>`/contenteditable in a pushed or imported doc switches tools/zooms; Backspace/Delete deletes the selection; `Enter` is hijacked onto `lastSelectedElement` (runtime.ts:1961-1964) starting a text edit on a different element.

### H8. `restore-element` double-prefixes `data:` element ids — undo breaks node identity
`src/bridge/runtime.ts:1215`
`createdSnapshot` emits the derived id (`"data:uuid"`) and `createElementFromSpec` writes it verbatim into `data-design-element-id`, so the restored element derives `"data:data%3Auuid"` — a new node identity per undo cycle. Delete→undo loses selection, leaves zombie records, makes redo-after-undo silently fail (replay targets the old id), and grows the id ~11 chars/cycle until the 512-char cap kills the whole snapshot.

### H9. `set-shape-fill` acks reject `var()`/non-hex colors — applied fills revert after 5s ×2
`src/bridge/protocol.ts:556,723` · `src/bridge/runtime.ts:957-968`
`isCommandAck` validates `previousColor`/`color`/`undo.color` with `isShapeColor` (hex/rgb/transparent only), but `applyShapeFill` deliberately supports `var(--token)` and `ColorField` commits named/hsl colors unvalidated. The ack is dropped → request times out at 5s → `runBridgeShapeEdits` reverts the fill; every subsequent fill echoes `previousColor:"var(--x)"` and fails forever.

### H10. Rotated elements use post-transform AABB for bounds — outlines double-rotate, resize writes inflated size
`src/bridge/runtime.ts:185` · `src/overlay/NodeOverlayLayer.tsx:51-60` · `src/overlay/commands.ts:350-356` · `src/overlay/useNodeOverlayGestures.ts:457,467`
`localBounds()` returns `getBoundingClientRect()` (already includes `rotate()`). `targetBox` then applies the rotation again → oversized, double-rotated selection outlines; `buildResizeChanges` feeds the AABB into `resizeRect` → first resize on a rotated element writes the inflated box into `width`/`height` plus a wrong translate; `fitFreeformFrames` re-rotates `nextBounds`, over-growing freeform frames. Contradicts the code's own stated invariant (useNodeOverlayGestures.ts:212-214).

### H11. Text-edit flags never cleared on frame teardown — keyboard permanently locks ×2
`src/canvas/CanvasSurface.tsx:1730,2262` (also 1026-1098, 1163-1169, 1490-1501)
`frameTextEditRef`/`textEditingNode` are cleared only by `text-commit`/`text-cancel` or frame delete. Iframe reload (srcDoc replace, token-rename rewrite), controller detach (`handleBridgeController(null)`), project navigation, and agent `remove` mid-edit all skip clearing → `handleKeyDown` early-returns on every key (all shortcuts dead until reload) and `isEditingOverlayTarget` keeps selection chrome suppressed.

### H12. Transcript orphans tool-call/result pairs → provider 400s ×3 findings
`src/harness/brainstorm/agent.ts:434-445,471-477` · `src/harness/transcript.ts:71-76` · `agent.ts:346-362`
- Unknown tool name appends a `tool-result` but returns before the `tool-call` append → unpaired tool message permanently in transcript.
- `window()` is a raw `slice()` despite claiming to keep pairs; `trimToBudget` early-returns under budget, skipping orphan cleanup → windows starting on a `tool-result` emit orphans in the common case.
- `await onPermissionRequest` throws propagate unwrapped after the `tool-call` is appended but before its `tool-result` → unpaired call.
Each leaves an invalid message list that real providers 400 on; one hallucinated tool name poisons the session for ~30 entries.

### H13. `LiveThumbnail` permanently blanks after any save
`src/canvas/ProjectLake.tsx:213` (with :196-199)
`useEffect(() => setPainted(false), [projectId, updatedAt])` strips `is-painted` on every `updatedAt` change, but the resolve effect early-returns forever once `resolved !== undefined` — the iframe keeps the same srcDoc, `onLoad` never refires, `painted` stays false → thumbnail invisible until remount. Autosave bumps `updatedAt` on every store change, so the active project's thumbnail fades to blank constantly.

---

## Medium severity

### State / store / persistence

- **M1. DOM-removed nodes are never pruned from `state.nodes` ×5** — `reducer.ts:403-423` (`document/replace-html`), `CanvasSurface.tsx:2164,2192`. Snapshots only upsert; agent `replaceHtml`, iframe reloads, and `document/update-src` leave ghost nodes: selectable, deletable (ops hit `target-not-found`; `deleteSelectedNodes` catch aborts the whole batch, CanvasSurface.tsx:2847-2855), exported, and repair resurrects them as root layers on load.
- **M2. `upsert-token` can perform implicit rename, skipping alias retargeting** — `reducer.ts:238-253`. An upsert with a new `name` on an existing id bypasses `tokens/rename`'s `{old}` alias rewrite and `rewriteTokenCssReference` srcDoc pass → dangling `var(--old)` links.
- **M3. `beginTransaction` called unguarded on pointer + async paths ×2** — `CanvasSurface.tsx:2941,3001,3849,4033,4070` · `useNodeOverlayGestures.ts:539` · `src/editor/store.ts:124-127`. Second gesture/style edit while a transaction awaits its bridge ack throws (uncaught; edit dropped), and unrelated `execute`s landing inside an open transaction are rolled back with it on bridge failure → store/DOM desync.
- **M4. Autosave resolves via global `activeProjectId` → cross-tab overwrite** — `CanvasSurface.tsx:1399-1438` · `local-projects.ts:583-601`. A second tab opening another project rewrites the shared slot; tab A's autosave then writes into project B's record — silent cross-project data loss.
- **M5. `readActiveTool` rejects `"shader"`** — `wirecanvas.ts:463` · `wirecanvas-repair.ts:52`. `"shader"` is a registered `ToolId` stored verbatim, but missing from the parser allowlist → projects saved with the shader tool active fail strict import and get "repaired" (tool reset + false damaged-file toast) on every open.
- **M6. `frame/remove` leaves orphans and never GCs the document** — `reducer.ts:525-577`. Children lacking `frameId` survive with `parentId`→dead nodes (`validateRelations` fails); `removedNodeIds` pruned only from own document's roots; the frame's document+srcDoc stays in state and in every saved project forever (no `document/remove` exists).
- **M7. `history:"skip"` mutations don't invalidate the redo stack** — `store.ts:89-95`. After an undo, skipped mutations (snapshot ingests, selection sets) land while `future` stays live; a redo then restores a stale whole-state snapshot, discarding interim index/selection changes.
- **M8. Stale node metadata re-binds across document versions via positional ids** — `CanvasSurface.tsx:2172`. `existingNodes[elementId]` unconditionally inherits `name`/`locked`/`hidden`/`attributes`; `path:` ids re-key on any DOM mutation → stale metadata lands on whatever element now occupies the key; `existingNode?.name ??` also freezes every layer name at first sight.

### Canvas input / gestures

- **M9. `pointercancel` commits in-progress drags instead of aborting** — `CanvasSurface.tsx:4291` · `useNodeOverlayGestures.ts:714`. A browser/OS pointercancel commits the element at its last position (the `canvas-create` branch correctly aborts — inconsistent semantics).
- **M10. Wheel pan/zoom during a gesture corrupts the drag** — `CanvasSurface.tsx:4310` · `useNodeOverlayGestures.ts:527-531`. No `pointerRef`/`nodeGestureRef` guard; `screenToWorld` runs under the shifted camera against a stale `startWorld` → element jumps and the corrupted position commits. `settleInteraction` also forces `interactionMode:"idle"` mid-drag, dropping the iframe input shield.
- **M11. Multi-touch not guarded: frame ops lack pointerId/isPrimary checks ×2** — `CanvasSurface.tsx:4024,4070,4107,4267`. A second finger's pointerdown overwrites the live op (and its transaction); any pointer's `pointerup` ends the primary op → half-completed commits.
- **M12. Stale `clipboardTargetRef` hijacks paste permanently** — `CanvasSurface.tsx:4443,3882-3884`. Copy a node then delete it or switch projects → Cmd+V silently no-ops (`duplicateSelectedNode` early-returns) AND blocks all external HTML/image paste for the rest of the session.

### LLM / harness / voice

- **M13. LLM timeouts stop applying once response headers arrive** — `src/llm/http.ts:94-115` · `openai-responses.ts:180-187` · `deepseek.ts:154-161`. `clearTimeout` + abort-listener removal run right after `fetch()` resolves; a server that sends headers then stalls hangs forever — the timeout only covers time-to-headers.
- **M14. Voice capture lifecycle races ×3** — `browser-audio-capture.ts:116-146` (`cancel()` during in-flight `prepare()` resurrects the mic — pending `getUserMedia` resolves and wires everything while the caller believes it cancelled), `:159-166` (unguarded `recorder.stop()` throws `InvalidStateError` if the track auto-stopped — raw DOMException, tracks leak, phase stuck `"stopping"`), `:185-193` (post-cancel delivery rejections flip phase `"stopped"`→`"failed"` and fire `onError` for a routine cancel).
- **M15. Assistant history serialized with `input_text` instead of `output_text`** — `codex.ts:74-76` · `opencode-go.ts:173-175`. Responses-API dialect requires `output_text` on assistant items (the codebase's own `openai-responses.ts:51-63` does it correctly) → any multi-turn request is rejected on these two providers.
- **M16. Stale drain clobbers the new generation's drain handle** — `continuous-voice-stream.ts:254`. `resetForStart` nulls `drainPromise` while an old drain may still be in flight; its `.finally` clears the **new** drain's handle → two concurrent drains `shift()` the same queue, ordering breaks, `waitForQueueToDrain`/`stop()` can proceed while a send is in flight.

### Agent bridge / plugin

- **M17. `MAX_INBOX` eviction silently drops ops** — `vite-plugin-canvas-agent.ts:134` · `client.ts:65-68`. The queue trims oldest entries with no gap indicator; a behind client advances `lastSeq` past the missing range → evicted ops never applied, agent long-polls all end `result-timeout`.
- **M18. `injectCss` fallback produces an invalid document** — `agent-bridge/protocol.ts:64`. For a doctype doc lacking `</head>`/`<html>` (`<!doctype html><p>x</p>`), `<style>` is prepended **before** the doctype → `parsed.doctype === null` → `invalid-html`. Also a literal `</head>` in a comment/script string gets the style injected mid-text.
- **M19. Result posts are one-shot and unchecked** — `agent-bridge/client.ts:71`. `lastSeq` advances before posting; POST failure or an `onApplied` throw loses that result and every remaining one in the batch → agent sees failure though the canvas applied the op.

### Import / export / tokens

- **M20. DTCG import drops descendants of hybrid token+group nodes → round-trip data loss** — `tokens/import.ts:292`. Nodes carrying `$value` return before the child-walking loop; the app's own exporter produces hybrids for prefix-sharing names (`css.ts:117-122`) → `buildDTCGDocument` output for `color` + `color.accent` re-imports as just `color`.
- **M21. `svgPaintRef` double-applies `paint.opacity` to gradient stops** — `figma-file-import.ts:312`. `stop-color` bakes opacity into rgba **and** `stop-opacity` multiplies again → opacity 0.5 renders at 0.25 on every SVG gradient shape.
- **M22. `fontFaceOf` misclassifies common weights** — `figma-file-import.ts:897`. `bold` checked before `extrabold`; Figma's spaced names ("Semi Bold", "Extra Light") never match the joined keys → Semi/Demi Bold → 700 (should be 600), Extra/Ultra Light → 300 (should be 200).
- **M23. paste-html executable-content detection has concrete bypasses** — `paste-html.ts:76`. `\son[a-zA-Z]+\s*=` requires whitespace before the handler (`<svg/onload=…>` slips through); `EXECUTABLE_URL_ATTRIBUTES` omits `xlink:href`; `java\tscript:` evades the scheme check. Iframe sandbox still contains execution, but the module's strip contract is violated.
- **M24. DTCG `fontFamily`/`fontWeight` scalar tokens unimportable** — `tokens/import.ts:97`. Both map to composite `typography`, then `coerceValue` requires a record → every scalar string token of these common types skipped with only a warning.

### Shaders / WebGL

- **M25. Support probe and release paths create WebGL contexts that evict live shaders at the browser cap ×2** — `registry.ts:336-342` (`detectPaperShaderSupport` creates a real WebGL2 context per call — per `ShaderElementView` mount, per menu hover, per `addShaderElement`), `webgl-release.ts:21` (`getContext("webgl2")` on a canvas that never had one **creates** then loses a context). At the ~16-context cap, probing/releasing destroys a live shader's context — the exact failure the release system exists to prevent.

### Bridge runtime

- **M26. `beginTextEdit` on element B abandons element A's edit state** — `runtime.ts:1400`. `activeTextEdit` overwritten without `restoreTextEdit` → A keeps `contenteditable`/`data-design-tool-editing`/`outline:none` permanently and stays user-editable; its later commit resolves with `previousText` = live text, so undo restores typed text.
- **M27. One oversize `elementId`/`name` kills the entire snapshot** — `protocol.ts:520`. `path:` ids grow ~8-12 chars/DOM level (>45 deep fails), name/aria-label >512 fails `isElementTarget` → `isHierarchySnapshot` rejects the whole response → bridge ingestion dies (empty Layers, error status).
- **M28. Line breaks can't survive a text edit** — `runtime.ts:1369`. `isEditableTextElement` requires `children.length===0`; Shift+Enter inserts `<div>`/`<br>` → element never editable again, and `textContent` commit concatenates `a<br>b` → `ab`.
- **M29. `explore_variants` drops the captured brief** — `live-wireframes.ts:236`. Builds `MainGenerationInput` with `brief: ""` (vs `buildGenerationInput`'s `renderBrief(content)`) → all draft generations run without the session's collected context.
- **M30. Glass `commit()` applies `level 0` on mere blur and strips real styles** — `PropertiesPanel.tsx:626-701`. `hasUntrackedGlass` matches any inline `linear-gradient(`/`inset 0 1` box-shadow (common authored styles); blur/pointerup with `appliedLevelRef===null` calls `apply(0)` → `applyGlassEffect(0)` writes `set-inline-style: null` for `backdrop-filter`, `background`, `box-shadow` — deleting real styles + a phantom undo step.
- **M31. `applyPickedHex` produces `"transparent80"`** — `ShaderEditor.tsx:61-64` · `ColorField.tsx:6-13`. Alpha-preservation fires for the `"transparent"` swatch when previous color is hex8 → invalid value committed to shader params/styles.
- **M32. Token pick double-commits raw draft + `var(--token)`** — `PropertiesPanel.tsx:125-137,454-514`. Popover portals to `document.body`, defeating the `relatedTarget`-in-`wrapRef` blur guard → half-typed raw value commits, then the token commits — two writes, one flashing undo step.
- **M33. Collapsed shader row re-expands on every element update** — `ShadersPanel.tsx:33-37`. Expand-on-select effect depends on `shaderElements`, recreated every param commit/drag tick → collapsing can't stick while selected.
- **M34. Draft inputs clobbered mid-typing by external value changes** — `ColorField.tsx:94` · `PropertiesPanel.tsx:118,173` · `ShaderEditor.tsx:81,313`. `useEffect(setDraft, [value])` has no is-focused guard; bridge snapshots/undo/agent ops wipe in-progress text.

---

## Low severity (grouped)

**Persistence/routing**
- `saveProjectIndex` return ignored on create/import → navigates to ids that may not exist (CanvasSurface.tsx:1016,1052,1323,1345)
- Popstate checks index before orphan-relisting load → false "not found" for recoverable projects (CanvasSurface.tsx:1483-1485)
- `hydrateInitialState` uses `search.includes("demo=1")` → false-positives on `?nodemo=1` etc. (local-projects.ts:888)
- `"__proto__"` accepted as entity id → computed-key assignment triggers prototype pollution; entity vanishes from serialization (wirecanvas.ts:787-790)
- `sameJson` no-op checks are key-order sensitive → spurious revision bumps / false `Stale token revision` (reducer.ts:203-205)
- `frame/remove` never garbage-collects the frame's document — deleted frames' srcDocs accumulate in saved files (reducer.ts:525-577)

**Tokens**
- `tokens/rename` can mint a self-referencing `{new}` alias in another set → reported `cyclic` (reducer.ts:299-301)
- `a.b` and `a-b` collide on `--a-b`; `var(--a-b)` can never resolve to the hyphen token (model.ts:115,210)
- `inferType` destroys untyped values before consulting the name (`{$value:16}` → opacity-clamped to 0-1; `"auto"` → color) (import.ts:63)
- Groups named `type`/`description` silently skipped (import.ts:295)
- 5,000-token cap truncates with no warning (import.ts:249)
- `hasExportableTokens` emits empty `tokens.json`/`tokens.css` artifacts (tokens-export.ts:31)
- `aliasOf` overwritten per hop — reports last hop, not the immediate `{path}` target (resolve.ts:189)
- `validateOperations` checks set/theme existence against pre-batch state → valid same-batch refs rejected (router/tokens.ts:309)
- `NaN` slips numeric clamps (`limit:NaN`→empty entries; `timeoutMs:NaN`→timeout never fires) (tokens.ts:174,238)
- Non-object ops throw raw `TypeError` instead of `TokenRouterError` (tokens.ts:311)
- Opacity token with empty value silently stores `0` (`Number("")==0` passes validation) (TokensPanel.tsx:126-129)
- Rename+value save = two undo entries, non-atomic (TokensPanel.tsx:733-752)

**Editor/effects**
- `parseCssColor` rejects `#fff`, hex8, percent/hsl/named → wrong glass tint + no active swatch for legitimate values (effects.ts:64-77 · ColorField.tsx:44-47)
- `glassLevelFromAttribute` accepts whitespace/`0x10`/`1e2` spellings (effects.ts:257-260)
- `prependTranslationTransform` prepends every commit without merging → string grows until the 4096 cap silently reverts position edits (~130 edits) (position.ts:16)

**Canvas**
- `fitRectWithInsets` hardcodes zoom bounds 0.05-4 vs `MIN_ZOOM=0.08` → opening fit can sit below the enforced floor (CanvasSurface.tsx:234-247)
- `scanVisibleFrames` skips frames with `pageId===undefined` when `activePageId` set — legacy frames never auto-mount (CanvasSurface.tsx)
- `pendingCanvasImageRef`/`pendingImageRef` survive a cancelled file picker → next image lands at the cancelled spot (CanvasSurface.tsx:2491)
- `endPointerOperation` ignores `event.pointerId` — any pointer's release ends the current op (CanvasSurface.tsx:4267)
- Escape mid-pan desyncs React `camera` state from the imperative world transform (CanvasSurface.tsx:4383)
- Wheel over a selected live frame is swallowed by the iframe — pan/zoom dead zone (FrameView.tsx:459)
- `lastBridgeTargetRef` written, never read — dead state (CanvasSurface.tsx:533)

**Components**
- Multi-frame selection edits write only the primary frame despite `"mixed"` display (PropertiesPanel.tsx:975-977)
- `ShaderColorsField`: stale `openIndex` after removal shifts; phantom `#000000` stop on empty colors; `openIndex` persists across elements (ShaderEditor.tsx:178-243)
- Rename `<input>` nested inside the row's select `<button>` — clicks select the node; invalid nested-interactive HTML (LeftSidebar.tsx:197-205)
- `toPickerHex` dead code (ShaderEditor.tsx:46-59)
- `AgentConnectionPanel` in-flight test result overwrites newer status (AgentConnectionPanel.tsx:64-76)

**Shaders/canvas support**
- `scale` slider max (4) below library preset values (5-6.67) → touching the slider snaps value down (params.ts:112)
- No per-shader `maxCount` on colors/spots vs upstream `u_colors[N]`/`maxSpots` caps — extras silently no-op or push past uniform array size (params.ts:29-38)
- Ferro Tide gated behind a WebGL2 probe it doesn't need (OGL falls back to WebGL1) (ShaderElementView.tsx:43)
- `rankVisibleFrames` dead code; `CanvasSurface.scanVisibleFrames` reimplements it — divergence risk (virtualization.ts:57)
- `BlankCanvasChooser` effect re-runs every render (`onClose` inline) → steals dialog focus (ProjectLake.tsx:281-314)
- ⌘K / `/` focus escapes the open chooser dialog (no `showBlankChooser` guard) (ProjectLake.tsx:500-516)

**Bridge protocol/runtime**
- `pick-element` ack omits `targetId` → dropped → 5s timeout on every overlay click-through (runtime.ts:1859)
- Markup delete/restore acks can never pass protocol validation (latent — only `data-design-tool-created` nodes are deleted today) (runtime.ts:1654)
- Every created arrow reuses `id="design-tool-arrowhead"` → multi-arrow docs render wrong arrowhead colors; deleting the first rebinds the rest (runtime.ts:1199 · freeform.ts:132,139)
- Leading comment before doctype demotes a full document to a fragment — `<head>` (title/charset/viewport) silently discarded (protocol.ts:49)

**Overlay/gestures**
- Alignment snapping uses an 8-world-unit threshold = 32px at 4× zoom, 0.64px at 0.08× — dead when zoomed out, lurching when zoomed in (geometry.ts:120)
- BriefFrameView index-keyed list drafts re-bind to the wrong item after removal (BriefFrameView.tsx:74)

**Harness/LLM/voice**
- `startSession()` ignores the `createId` override → nondeterministic ids despite injected generator (agent.ts:173-176)
- Assistant text dropped whenever the result also has tool calls (agent.ts:248-249)
- `startedSession: true` returned unconditionally (agent.ts:257-263)
- `baseUrl ?? ""` → relative request URLs when constructed without one (codex.ts:54 · opencode-go.ts:92 · gemini.ts:52)
- `requireColor` accepts invalid 5- and 7-digit hex (tools.ts:87 · live-wireframes.ts:289)
- `toProviderMessages` docstring lies — nothing is skipped; `maxChars` ignores tool-call arg length (transcript.ts:30-67)
- Repeated-failure guard keyed on tool name only — alternating A,B,A,B never trips the 3× stop (agent.ts:270-278)
- Stale-generation events decrement the new generation's `bufferedBytes` → negative counter, admission cap defeated (continuous-voice-stream.ts:298)
- `onLifecycleEvent` exceptions corrupt stream state — orphaned remote stream, stuck phase, hung queue (continuous-voice-stream.ts:164)
- `stop()` proceeds after a concurrent `cancel()` — `transport.stop` sent for cancelled stream, `"stopped"` emitted after `"cancelled"` (continuous-voice-stream.ts:207)
- `AbortSignal.any` fallback drops the internal signal — `cancel()` can't abort an in-flight start on older runtimes (continuous-voice-stream.ts:150)
- Restart resync has a catch-up hole — fresh server accumulating ≥`lastSeq` ops within one poll skips them forever (client.ts:58)
- Replace path pins `mode` — a `push` can never upgrade a wireframe document to design (apply.ts:124)
- Non-string push fields → generic `"internal"` errors instead of typed `invalid-input` (apply.ts:100)
- Conflicting `id`+`documentId` silently resolves to the frame (apply.ts:115)
- Oversized body path can fail to respond (`req.destroy()` before `sendJson(400)`) (vite-plugin:84)
- `timeout` edge cases (`abc`, `0`, negatives) → instant 504 (vite-plugin:180)

**Import/clipboard/fonts/interaction/comments**
- `roundedRectPath` emits unclamped corner radii — Figma clamps `tl+tr ≤ width`; raw values self-intersect the path (figma-file-import.ts:571)
- `PASTE_ERROR_MESSAGES` missing `reserved-token-theme-marker` friendly copy (paste-html.ts:28)
- Injected catalog `@font-face` overrides a document's own same-family face by cascade order (fonts/inject.ts:114)
- `beginStroke` over-cap eviction computes `firstOpen` but always removes index 0 — can evict an in-progress stroke (recorder.ts:218)
- `PRESENTATIONAL_ATTRIBUTES` misses `rules`/`bordercolor`/`noshade`/`type` etc. — `<table rules bordercolor>` and `<ul type>` render styled inside wireframes (wireframe-admission.ts:85)

---

## Recurring themes (root causes worth fixing first)

1. **Element/node ids are not document-scoped** (H1, H2, M1, M8) — the single highest-impact cluster: one flat `state.nodes` map + positional/reused ids = cross-document corruption, codec-invalid saves, ghost layers. Fix: scope ids by document, prune on snapshot, detach from the correct document.
2. **Bridge protocol validators are stricter than the runtime** (H6, H8, H9, M26-M28, lows) — control-char rejection, `isShapeColor`, ack-shape mismatches, size caps: runtime sends things protocol drops → timeouts, wedges, silent reverts.
3. **Editable-target guards missing on the forwarded-key path** (H6, H7) — in-iframe typing reaches canvas shortcuts.
4. **Transaction lifecycle unguarded** (M3) — `beginTransaction` throws when active; several callers don't check, and held-across-await transactions capture unrelated ops.
5. **Token invariant gaps** (H4, M2 + lows) — `upsert-token` skips the unique-name rule and rename machinery; combined with strict load validation + destructive repair, small panel bugs escalate to full token-store loss.
6. **Resource lifecycle** (M13, M14, M16, M25) — timeouts that end at headers, drains/mics/contexts that outlive their cancellation, probes that create the thing they measure.
