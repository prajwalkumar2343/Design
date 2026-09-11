# Current Canvas Project

Use this reference for the repository's current implementation. Re-check source files
when the project evolves; these are the real browser/runtime boundaries, not a promise of
future CLI or host integrations.

## Source ownership

- `src/App.tsx` mounts `CanvasSurface`. Normal `/` is blank; `/?demo=1` explicitly loads
  the legacy/demo `initialFrames` fixture from `src/demo/documents.ts`.
- `src/canvas/CanvasSurface.tsx` owns the editor store subscription, camera, selection,
  frame virtualization, Brief Frame placement, canvas interactions, and persistence UI
  wiring. It preserves the `frames` prop for fixture/tests.
- `src/canvas/brainstorm-session-controller.ts` owns the UI-bound Brainstorm start action,
  stable ID generation, Brief Frame placement, and typed Brief/reference/decision commands.
- `src/canvas/EmptyCanvasState.tsx` owns the blank entry state and **Start brainstorming**
  action.
- `src/session/model.ts` owns the versioned `BrainstormSessionState`, `BriefContent`,
  `BriefFrame`, references, decisions, lifecycle, and revision types.
- `src/session/reducer.ts` owns session transitions, expected-revision checks, Brief
  mutations, and the explicit `session/wireframe-created` revision/lifecycle action.
- `src/editor/model.ts` owns normalized `DocumentEntity`, `PageEntity`, `FrameEntity`,
  nodes, `DocumentMode`, selection, active page, and active tool. `selectFrameRenderModels`
  derives iframe-ready frames from normalized state.
- `src/editor/commands.ts`, `src/editor/reducer.ts`, and `src/editor/store.ts` own typed
  editor commands, immutable state transitions, transactions, and undo/redo. The store's
  `replaceState` boundary is the atomic import replacement path.
- `src/frame/BriefFrameView.tsx` renders the editable Brief Frame as a canvas artifact.
- `src/frame/FrameView.tsx` renders normalized documents in `sandbox="allow-scripts"`
  iframes. `src/frame/render-document.ts` selects render-time behavior by mode;
  `src/frame/wireframe-theme.ts` injects the Canvas-owned neutral theme.
- `src/router/brainstorm-session.ts` is the transport-independent Codex-facing session
  service. `src/router/document-exchange.ts` is the typed document boundary, including
  `createWireframe` and `replaceHtml`.
- `src/router/html-admission.ts` owns complete-HTML admission. `src/router/wireframe-
  admission.ts` owns the structured strict wireframe HTML/CSS validator; it uses the
  maintained `css-tree` parser rather than CSS regex splitting.
- `src/persistence/wirecanvas.ts` owns the v1 `.wirecanvas.json` codec, deterministic
  serialization, untrusted-input validation, strict mode-aware HTML revalidation, and
  atomic import. `src/persistence/adapter.ts` owns replaceable browser file/download
  adapters.
- `src/components/WorkspaceHeader.tsx` owns Import/Export actions and accessible feedback.

## Brainstorming Mode protocol

The exact opening prompt is:

> Alright—let’s understand the project first. What are you making, who is it for, and what should it help them do?

To start from a blank canvas, the UI calls the start action in
`useBrainstormSessionController`. It generates caller-side stable `sessionId` and
`briefFrameId` values, then executes `startBrainstormSessionCommand` with expected
revision `0`. Codex-facing callers should use `BrainstormSessionService.startSession`
with their own stable IDs and `expectedRevision`; the service never generates IDs.

Read the current canonical session with `BrainstormSessionService.getSnapshot()`. Use its
typed mutation methods for one Brief field, references, confirmed decisions, and legal
lifecycle changes. Every mutation supplies the current expected session revision. A stale
revision is rejected, and successful mutations return previous/current revision and a
bounded snapshot. The canonical Brief fields are:

`projectDescription`, `audience`, `goals`, `successCriteria`, `requiredContent`,
`requiredFeatures`, `visualDirection`, `constraints`, `references`, `openQuestions`, and
`confirmedDecisions`.

Reference links are validated at the Brief UI boundary to `http:`/`https:` and open with
`noopener`/`noreferrer`.

The session lifecycle is `not-started -> briefing -> wireframing -> completed`; the
reducer rejects invalid transitions. Brief and session revisions are monotonic, and the
editor store records accepted mutations in existing history.

## Codex document exchange

Normalized documents and compatible frame seeds carry `DocumentMode = "design" | "wireframe"`.
Existing seeds omit mode safely and default to `design`.

### First and subsequent wireframes

The fresh Brainstorm session has a Brief Frame but no document/page/frame. Codex must call
`new DocumentExchangeService(store).createWireframe({ ... })` for the first agent
wireframe. The input requires:

- `mode: "wireframe"` explicitly;
- caller-provided distinct stable `documentId`, `pageId`, and `frameId`;
- document/page/frame names;
- complete HTML;
- finite `x`/`y`, positive finite `width`/`height`, and a background;
- `expectedSessionRevision`.

The service requires lifecycle `briefing` or `wireframing`, validates the session revision,
validates strict wireframe HTML before mutation, and rejects duplicate/inconsistent IDs.
It creates normalized document/page/frame entities and the session action in one undoable
transaction. The first accepted wireframe changes `briefing` to `wireframing`; a later
wireframe keeps `wireframing` and increments the session revision through the dedicated
`session/wireframe-created` action. It returns IDs, mode, document revision, previous and
current session revisions, affected frame IDs, and HTML byte size. A failed validation or
reducer step leaves state, revision, and history unchanged. The created page becomes
active so the frame is immediately visible through `selectFrameRenderModels` and Canvas.

### Existing documents

Call `DocumentExchangeService.replaceHtml({ documentId, expectedRevision, html, mode })`
for an existing document. `mode` is mandatory. During `briefing` or `wireframing`, agent
HTML is accepted only in `wireframe` mode. Outside an active Brainstorm session, existing
design-mode document behavior remains supported. Accepted HTML updates the canonical
document mode, exact `srcDoc`, and document revision atomically; linked frames refresh
through normalized selectors.

Wireframe admission is fail-closed and structured. It requires complete doctype HTML and
rejects scripts, event-handler attributes, executable/embedded content, external assets or
resources, media/images, external form actions, navigation/external URLs except inert `#`
anchors, CSS `url()`/imports/`@font-face`, animation/transitions, arbitrary visual styling,
legacy visual elements and presentation attributes, MathML, namespaced URL attributes,
`<base>`, and all `meta http-equiv`. Safe nested responsive at-rules are recursively
validated. The allowlist covers semantic HTML and neutral responsive layout/typography:
flow/positioning, flex/grid, sizing, spacing, overflow, alignment, text sizing, line
height, and text alignment. Canvas owns color, backgrounds, borders, shadows, filters,
opacity, transforms, and motion. Stable typed violation codes are returned before editor
commands run.

`FrameView` preserves `sandbox="allow-scripts"` without `allow-same-origin` or network
permissions. In wireframe mode, `renderFrameDocument` injects one idempotent Canvas-owned
neutral theme marked by `data-design-tool-wireframe-theme`, then the bridge runtime. The
canonical `srcDoc` is never rewritten by theme injection. Design mode uses the existing
render path.

## `.wirecanvas.json` files

Use the browser UI's Import/Export actions or the `src/persistence` interfaces. There is
no Canvas CLI and no direct workspace filesystem router.

- Top level: `kind: "wirecanvas-project"`, `schemaVersion: 1`, and a durable `state`.
- Embedded session: `kind: "brainstorm-session"`, `schemaVersion: 1`.
- Exported durable state includes session/Brief/lifecycle/revisions, selection, exact
  document HTML/mode/revisions/metadata, pages, frame geometry/backgrounds, nodes,
  `activePageId`, and active tool.
- It excludes bridge/hover state, local form drafts, microphone state, and history internals.
- Export MIME is `application/json`; the filename is
  `brainstorm-session.wirecanvas.json`.
- Imports are untrusted, bounded, deterministic-state validated, cross-reference checked,
  and revalidated against the stored document mode. Only v1 is accepted; malformed and
  future file/session versions fail with typed errors.
- Parsing builds a complete candidate before store mutation. Failed import is atomic; a
  changed import is one undoable whole-state replacement, and an equivalent import is a
  no-op. Undo/redo restores the complete pre/imported states.
- `PersistenceAdapter` reads a browser `File`-like object. `BrowserDownloadAdapter` uses
  `Blob` and browser download APIs. These are replaceable adapters, not claims of direct
  filesystem access.

## Local visual/test workflow

1. Run `npm run dev -- --host 127.0.0.1` and open `/` for the blank Brainstorming flow.
2. Use `/?demo=1` only when a legacy demo fixture is needed.
3. Use the repository helpers in `plugins/canvas-design/scripts/` for inspection and
   screenshots. Store temporary screenshots under `.canvas/artifacts/`; they are local
   QA artifacts and are not deliverables.
4. Use the typed services/store in tests or host integration; do not invent a Canvas CLI,
   direct workspace write, or an internal LLM.

## Current limits and non-goals

- Codex owns reasoning; this browser app contains no internal LLM or chat panel.
- There is no direct workspace filesystem backend, publish/deploy flow, or Canvas CLI.
- Strict wireframe mode is not a production-design HTML/JavaScript admission path.
- The larger roadmap's voice streaming, source-code reconciliation, framework adapters,
  broad production HTML capabilities, and publishing remain outside this shipped slice.
