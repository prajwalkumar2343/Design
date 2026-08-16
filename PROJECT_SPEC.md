# Agent-Native Design Tool — Product and Technical Specification

Status: Active spec; Brainstorming Mode v1 shipped
Last updated: 2026-08-14
Working title: Canvas  

## 1. Product statement

Canvas is a Codex-first, voice-native design environment built on real HTML and CSS. LUNA XHIGH in Codex creates or edits the HTML, and Canvas turns that HTML directly into a live visual design. A human and Codex work together on an infinite spatial canvas by talking, pointing, selecting, dragging, drawing, and comparing alternatives. The design surface is also the rendered product: there is no separate vector mockup format and no design-to-code translation step.

The essential interaction is:

> The user hovers or points at part of the interface and says, “This feels too heavy. Make it quieter, but keep the spacing.” The system understands what “this” refers to, proposes or applies the change immediately, and continues the design conversation without requiring manual code or property-panel work.

The product combines:

- A Paper-like infinite HTML/CSS canvas.
- A Cursor Design Mode-like point, draw, and voice interaction loop.
- A Codex router plugin that supplies HTML and operates Canvas through typed capabilities.
- A future internal-LLM fallback for sessions where Codex is not connected; its provider and model remain intentionally unspecified.
- A low-latency visual preview loop separated from durable source-code reconciliation.

The roadmap sections below retain the larger product direction. The currently shipped
browser workflow and its real boundaries are defined in section 1.1; that section takes
precedence where the roadmap describes capabilities that are not yet implemented.

## 1.1 Shipped Brainstorming Mode v1

Canvas starts at `/` with a truly blank editor state: zero demo documents, pages, or
frames. The quiet empty state offers **Start brainstorming**. The `?demo=1` query
parameter is an explicit local/demo fixture path used by legacy visual and end-to-end
coverage; it loads `src/demo/documents.ts` and is not the normal product startup.

Starting Brainstorming Mode creates the first canonical Brief Frame with stable IDs
generated at the UI boundary. The product protocol opening prompt is exactly:

> Alright—let’s understand the project first. What are you making, who is it for, and what should it help them do?

Codex keeps the reasoning and conversation. Canvas does not add an internal LLM or chat
panel. The Brief Frame is a first-class, editable canvas artifact at its own coordinates,
with per-field save behavior and the existing canvas selection/movement/history model.
Its canonical content fields are:

- `projectDescription`
- `audience`
- `goals`
- `successCriteria`
- `requiredContent`
- `requiredFeatures`
- `visualDirection`
- `constraints`
- `references` / links
- `openQuestions`
- `confirmedDecisions`

Reference links are editable but accept only `http:` or `https:` URLs; rendered external
links deliberately use `noopener`/`noreferrer`.

The typed domain state lives in `src/session/model.ts` and has schema kind
`brainstorm-session`, schema version `1`, and lifecycle values
`not-started | briefing | wireframing | completed`. Session and Brief Frame revisions
are monotonic. Mutations use expected revisions and preserve undo/redo; stale writes are
rejected rather than silently overwriting newer work. The transport-independent
`BrainstormSessionService` in `src/router/brainstorm-session.ts` exposes bounded snapshots,
session start, every Brief/reference/decision mutation, and the legal lifecycle changes.

### Document modes and wireframe admission

`DocumentMode` is the typed union `"design" | "wireframe"` on normalized documents and
compatible frame seeds. Existing seeds default to `design`. `DocumentExchangeService` in
`src/router/document-exchange.ts` exposes:

- `createWireframe(...)` for the first and subsequent agent-created wireframes. The input
  must explicitly declare `mode: "wireframe"`, provide caller-owned stable document/page/
  frame IDs, names, complete HTML, finite position, positive size, background, and the
  expected Brainstorm session revision. The first accepted wireframe moves `briefing` to
  `wireframing`; later accepted wireframes keep that lifecycle and increment the session
  revision through a dedicated action. Normalized document, page, and frame creation is
  one undoable transaction and rolls back atomically on any validation or reducer error.
- `replaceHtml(...)` for an existing document. It requires an explicit mode and expected
  document revision. During an active Brainstorm session (`briefing` or `wireframing`),
  agent HTML must be `wireframe`; existing non-Brainstorm design documents remain
  supported.

Wireframe admission is structured and fail-closed. It requires a complete doctype HTML
document and blocks the bridge/theme reserved markers, scripts, event-handler attributes,
executable or embedded content, external resources/assets, media/images, externally
submitting forms, navigation/external URLs except inert `#` anchors, CSS `url()`, imports,
`@font-face`, animations/transitions, arbitrary visual styling, legacy visual/presentational
attributes, MathML/namespaced URL attributes, `<base>`, and all `meta http-equiv` values.
Safe nested responsive at-rules are recursively validated. The allowlist is limited to
semantic HTML plus neutral layout/typography properties such as normal flow, flex/grid,
positioning, sizing, spacing, overflow, alignment, text sizing, line height, and text
alignment. Canvas owns color, background, borders, shadows, filters, opacity, transforms,
and motion treatment. Violations have stable typed router error codes and are rejected
before editor state or revision mutation.

Accepted wireframes render through the existing `sandbox="allow-scripts"` iframe boundary.
Canvas injects one idempotent, reserved-marker neutral grayscale theme at render time for
wireframe mode, before the bridge runtime. The canonical `DocumentEntity.srcDoc` remains
byte-for-byte unchanged; design mode follows the existing render path. No
`allow-same-origin`, network permission, or agent-provided runtime is added.

### Portable project files

The browser persistence boundary is a versioned `.wirecanvas.json` file, not a direct
workspace filesystem write. The top-level contract is `kind: "wirecanvas-project"` and
`schemaVersion: 1`, separate from the embedded Brainstorm session schema/version. Export
uses MIME `application/json` and the filename
`brainstorm-session.wirecanvas.json`.

The durable export contains the complete state needed to restore the project: session and
Brief Frame content/lifecycle/revisions, selection, normalized documents with exact HTML,
mode, revisions and metadata, pages, frames and geometry/backgrounds, normalized nodes,
`activePageId`, and active tool. It excludes transient bridge state, hover state, local
drafts, microphone state, and history internals. Import treats JSON as untrusted input,
enforces structural/reference/geometry/revision limits, revalidates stored HTML using its
mode (including strict wireframe admission), and rejects malformed or future file/session
versions. Validation builds a complete candidate before mutation, so failed imports leave
live state and history untouched. A changed import is one undoable whole-state replacement;
an equivalent import is a no-op.

The UI exposes Import on the normal Canvas header, including the blank canvas, and Export
once a session exists. `PersistenceAdapter` reads a browser `File`-like object and
`BrowserDownloadAdapter` uses `File`, `Blob`, and browser download APIs. These adapters are
replaceable for tests or a future host integration; the current browser app does not claim
direct Codex workspace writes.

### Current limits and non-goals

- Brainstorming Mode is Codex-facing protocol/state, not an internal model or chat UI.
- The browser app has no Canvas CLI, filesystem backend, direct workspace writer, or
  automatic project sync service.
- Agent first-wireframe creation uses `createWireframe`; `replaceHtml` is for existing
  normalized documents.
- The strict wireframe mode is intentionally not a production-design HTML/JavaScript
  admission path. Existing design fixtures and direct Canvas manipulation remain for
  compatibility, but active Brainstorm agent submissions are wireframes only.
- The larger voice, source-code reconciliation, framework adapters, broad production HTML
  capabilities, publishing, and internal-LLM ideas elsewhere in this document remain
  roadmap/non-goals for this shipped slice.

## 2. Product principles

1. **The render is the design.** Frames render standards-based HTML, CSS, fonts, images, SVG, canvas, video, and supported browser effects.
2. **Conversation and direct manipulation are equal control surfaces.** Users can ask LUNA XHIGH/Codex to edit the design, edit through Codex directly, or manipulate the same design in Canvas.
3. **Pointing carries meaning.** Hover, selection, cursor dwell, drawing, viewport state, DOM identity, and spoken timing are combined so references such as “this,” “those two,” and “the section above” resolve reliably.
4. **HTML is the shared source.** Codex supplies standards-based HTML/CSS/JavaScript, Canvas renders it without translating it into a proprietary design format, and accepted Canvas edits round-trip back into that source.
5. **Codex reasons; Canvas stays deterministic.** When the Codex router plugin is connected, Canvas does not call an LLM. It owns state, rendering, selection, manipulation, validation, history, and permissions while Codex owns generation and reasoning.
6. **Responsive design is relational.** The system models shared rules, breakpoints, and intentional overrides rather than treating every frame as an unrelated mockup.
7. **Everything is reversible.** Human edits, agent edits, temporary previews, accepted revisions, and source reconciliations have explicit history.
8. **The user remains in control.** Agents may explore safely, but destructive file changes, external publishing, and deployment require explicit permissions.

## 3. Target users

### Primary

- Product designers who want production-realistic interfaces without manually pushing pixels.
- Design engineers and frontend engineers iterating rapidly with AI.
- Founders and product managers able to articulate taste but unwilling to edit code or detailed visual properties.
- AI coding agents that need a structured visual workspace, selection state, and render feedback.

### Secondary

- Design-system teams validating tokens and responsive behavior.
- Agencies iterating with clients during live calls.
- Teams reviewing generated interfaces across devices, states, themes, and data sets.

## 4. Core user journeys

### 4.1 Create through conversation

1. The user connects Canvas to Codex through the Codex router plugin.
2. The user asks LUNA XHIGH, “Create a premium landing page for a voice product. Start with three directions.”
3. Codex supplies three complete HTML/CSS/JavaScript documents or variants.
4. Canvas validates and renders them as live visual designs on adjacent frames.
5. The user selects one direction and continues refining it in Codex or directly in Canvas.

### 4.1.1 Edit from either surface

1. Codex can replace or patch the current HTML through the router plugin.
2. Canvas can select, drag, resize, reorder, restyle, edit text, duplicate, or remove supported elements directly.
3. Each accepted Canvas manipulation becomes a typed operation and an updated HTML snapshot.
4. Canvas returns the new revision and relevant source context to Codex so subsequent requests use the latest design.
5. Conflicting or stale edits are rejected or branched using revision IDs; neither side silently overwrites the other.

### 4.2 Point and revise

1. The user moves the pointer over a rendered element; a subtle semantic outline indicates the current target.
2. The continuous Codex microphone stream is active.
3. The user says, “This card is too prominent. Make it feel secondary.”
4. The system binds the utterance to the hovered or selected DOM node and relevant ancestors.
5. The agent applies a temporary visual patch in the target frame within the latency target.
6. The user says, “A little less. Keep the border from the original.”
7. The system uses conversation and revision history to refine the same target.

### 4.3 Compare alternatives

1. The user selects a section and says, “Show three ways to make this more editorial.”
2. The system branches the section or frame into three linked variants.
3. The user points to one and says, “Use this direction, but take the typography from the second.”
4. The system merges the chosen attributes into a new accepted revision.

### 4.4 Responsive review

1. The user places linked frames for iPhone, Android, tablet, laptop, and wide desktop on the canvas.
2. All frames render the same document at different viewport sizes and device characteristics.
3. The user says, “On phones, stack these cards. On tablets, keep two columns.”
4. The system proposes breakpoint rules, previews them in every affected frame, and reports overflow or regression risks.
5. The user accepts the responsive rule once, not once per device.

### 4.5 Import and reconcile a codebase

1. The user connects a local HTML/CSS, React, Vue, Svelte, or supported framework project.
2. The canvas maps rendered DOM nodes to source components and styles.
3. Visual iterations occur in an overlay patch layer.
4. When approved, an agent generates a reviewable source diff.
5. The tool renders the modified source at all linked viewports, compares it with the accepted visual state, and only then marks reconciliation complete.

## 5. Infinite canvas

### 5.1 Canvas behavior

- Unbounded two-dimensional pan and zoom.
- Smooth trackpad, mouse, stylus, and keyboard navigation.
- Zoom range sufficient for project overview and pixel-level inspection.
- Frames, components, notes, reference images, design tokens, data states, and agent artifacts can coexist spatially.
- Multi-select, alignment, distribution, grouping, sections, naming, and spatial search.
- Minimap and “zoom to selection,” “zoom to active frame,” and “show all frames.”
- Canvas coordinates are separate from document layout coordinates.
- Large projects use viewport virtualization; off-screen frames do not continuously render at full fidelity.

### 5.2 Frame types

- **Viewport frame:** A live document rendered at a specific viewport and device profile.
- **Component frame:** An isolated component or DOM subtree with controllable props/data.
- **Variant frame:** A branch of another frame used to compare a design direction.
- **State frame:** The same route at a distinct UI state, such as loading, empty, error, authenticated, menu-open, or modal-open.
- **Reference frame:** A non-editable screenshot, image, URL snapshot, or imported visual reference.
- **Freeform HTML frame:** A self-contained HTML/CSS exploration not yet connected to a production route.

### 5.3 Frame linking

Frames may share one underlying document while differing by:

- Viewport width and height.
- Device pixel ratio.
- Touch versus pointer capability.
- Orientation.
- Color scheme and contrast preference.
- Reduced-motion preference.
- Locale, writing direction, and text scale.
- Route and application state.
- Data fixture or component props.
- Branch or revision.

Linked frames update together unless an explicit responsive, state, or variant override exists. The UI must visibly distinguish shared rules from frame-specific overrides.

### 5.4 Direct manipulation

- Every visible, unlocked design element can be selected and dragged in Canvas.
- Frames, sections, components, containers, text, images, controls, and newly drawn elements support direct movement; applicable elements also support resize, reorder, duplicate, and delete.
- Dragging within normal document flow produces a semantic reorder, spacing, alignment, grid, flex, or positioning operation rather than automatically forcing absolute coordinates.
- Holding an explicit free-position modifier may convert an element to positioned layout after showing the affected HTML/CSS change.
- Multi-selection supports moving, aligning, distributing, grouping, and applying shared properties.
- Locked, generated, or framework-controlled elements visibly explain why a manipulation is constrained.
- Every manipulation previews the resulting HTML/CSS operation and remains reversible.

## 6. Responsive device and viewport system

### 6.1 Coverage strategy

The product must not encode device support as a finite list. Every frame accepts arbitrary CSS viewport dimensions and environment parameters. A versioned preset catalog provides convenient named devices, while custom frames guarantee compatibility with current and future hardware.

The renderer is considered compatible with a device when it can reproduce the relevant browser viewport and media features. Decorative hardware chrome is optional and must never alter layout measurements.

### 6.2 Required frame controls

Each viewport frame supports:

- CSS viewport width and height.
- Portrait, landscape, and free rotation where meaningful.
- Device pixel ratio.
- Browser chrome visibility and safe-area insets.
- Touch, coarse pointer, hover capability, and keyboard presence.
- User agent profile when application behavior depends on it.
- Light/dark color scheme.
- Normal/high contrast.
- Reduced motion and reduced transparency.
- Text zoom or root-font-size simulation.
- LTR and RTL direction.
- Locale and timezone fixture.
- Network speed and CPU-throttle profiles for preview testing.
- Screenshot capture at CSS or physical-pixel resolution.

### 6.3 Required preset families

The maintained catalog must include representative current and legacy presets for:

- iPhone compact, standard, Plus/Max, and SE-class sizes.
- iPhone Dynamic Island and non-Dynamic Island safe areas.
- Android compact, standard, large, and flagship aspect ratios.
- Android devices with gesture/navigation insets.
- Foldables in cover, unfolded portrait, unfolded landscape, and tabletop/posture-aware modes where browser support permits.
- Small, standard, and large Android tablets.
- iPad mini, standard iPad, iPad Air, and iPad Pro classes in portrait and landscape.
- Small laptop, standard laptop, large laptop, desktop monitor, and ultrawide classes.
- Common CSS breakpoint frames independent of branded hardware.

Initial viewport presets should include at minimum:

| Category | CSS viewport examples |
|---|---|
| Mobile compact | 320×568, 360×640 |
| Mobile standard | 375×667, 390×844, 393×852 |
| Mobile large | 412×915, 428×926, 430×932 |
| Foldable cover | 344×882, 402×874 |
| Foldable open | 673×841, 768×1024 |
| Tablet compact | 744×1133, 768×1024 |
| Tablet standard | 820×1180, 834×1194 |
| Tablet large | 1024×1366 |
| Laptop | 1280×800, 1366×768, 1440×900 |
| Desktop | 1536×864, 1920×1080, 2560×1440 |
| Ultrawide | 2560×1080, 3440×1440 |

Preset dimensions are convenience data, not layout breakpoints. Projects define breakpoints from content behavior, and the agent should recommend breakpoints when layout constraints fail rather than blindly matching named devices.

### 6.4 Responsive rule model

- Base styles apply to all linked frames.
- Media and container-query rules describe intentional adaptation.
- Per-frame overrides are temporary by default and display a warning until generalized or explicitly preserved.
- The agent can convert a frame-local change into a breakpoint, container query, fluid rule, or component variant.
- The system shows which frames and nodes a proposed rule will affect before acceptance.
- Responsive edits must support CSS media queries, container queries, `clamp()`, intrinsic sizing, grid, flexbox, aspect ratios, logical properties, and safe-area environment variables.
- Frames can be resized continuously to reveal transition points and layout instability.
- A breakpoint scrubber visualizes where layout rules activate.

### 6.5 Responsive diagnostics

The tool must detect and surface:

- Horizontal and vertical overflow.
- Clipped content and inaccessible off-screen controls.
- Overlapping elements.
- Text truncation and unexpected wrapping.
- Touch targets smaller than configured accessibility thresholds.
- Fixed/sticky elements obscuring content.
- Safe-area collisions.
- Images or media exceeding containers.
- Layout shifts across adjacent widths.
- Breakpoint gaps and redundant or conflicting rules.
- Component behavior that differs unexpectedly between linked frames.

## 7. Voice and spatial interaction

### 7.1 Input modes

- Continuous microphone streaming from Canvas to the connected Codex host.
- One explicit session-level microphone permission and a persistent, visible streaming indicator.
- Immediate stop and cancel controls; cursor-based activation behavior is deferred until the streaming infrastructure is validated.
- Typed prompt fallback.
- Drawing, arrow, rectangle, freehand, and lasso annotations.
- Click, hover, multi-select, and hierarchy traversal.
- Optional direct manipulation followed by a spoken instruction, such as resizing a card and saying, “Use this proportion for all cards.”

### 7.2 Deictic grounding

During a continuous stream, Canvas sends ordered, bounded context snapshots alongside audio chunks. Context includes:

- Hovered and selected element IDs over time.
- Cursor position, dwell duration, clicks, and gestures.
- Drawn annotations and their frame-relative coordinates.
- Active frame, viewport, scroll position, and visible DOM.
- Target DOM path, stable design ID, attributes, accessible role/name, computed styles, bounding box, and relevant ancestors/siblings.
- Source component and file mapping when available.
- A screenshot or compact visual crop at meaningful moments.
- Recent conversation targets and active revision.

Canvas does not transcribe the audio or call a separate speech/LLM service in Codex-connected mode. The Codex host owns audio interpretation. Audio chunks and context snapshots share one monotonically sequenced stream so Codex can reconstruct which visual state accompanied each part of the audio.

Resolution order for words such as “this” and “here”:

1. Explicit selection.
2. Element clicked or annotated during the matching audio interval.
3. Current hover target with sufficient dwell.
4. Most recent conversational target in the active frame.
5. A bounded clarification when confidence remains unsafe.

The interface must show the resolved target before a consequential edit is committed.

### 7.3 Conversation behavior

The agent should:

- Preserve active visual and conversational context across short follow-ups.
- Understand comparative language: “more,” “less,” “like the second one,” and “match that card.”
- Explain important design tradeoffs concisely when useful.
- Offer variants for subjective or high-impact requests instead of pretending there is one correct answer.
- Apply direct, reversible edits without unnecessary confirmation.
- Ask only when ambiguity would materially alter the result.
- Never silently reinterpret an accepted design decision.

### 7.4 Latency targets

- Hover highlight: under 50 ms perceived latency.
- Voice activity indication: under 100 ms.
- Audio chunk delivery to the Codex router: target under 500 ms under normal network conditions.
- Simple temporary CSS patch after utterance: target under 2 seconds, p95 under 4 seconds.
- Structural change preview: target under 6 seconds, with visible progress.
- Frame refresh after accepted source edit: under 1 second after build completion.

## 8. Rendering engine

### 8.1 Requirements

- Accept complete HTML/CSS/JavaScript documents supplied by Codex through the router plugin.
- Validate document size, syntax, sandbox policy, asset references, and declared capabilities before rendering.
- Chromium-based standards-compliant HTML/CSS rendering for the initial release.
- Sandboxed document execution with controlled network and filesystem access.
- Support for HTML, CSS, SVG, web fonts, responsive images, video, canvas, and WebGL where permitted.
- JavaScript application execution for imported projects.
- Hot module reload or equivalent incremental refresh.
- DOM and CSSOM inspection.
- Computed-style and box-model capture.
- Accessibility-tree inspection.
- Deterministic screenshots for verification.
- Source maps and framework adapters for mapping DOM nodes to source.

### 8.2 Render layers

Each frame renders these ordered layers:

1. Source document/application.
2. Accepted canvas overrides not yet reconciled.
3. Current temporary preview patch.
4. Selection, hover, annotation, and agent-presence overlays.

Overlay controls must live outside the captured document so they do not affect layout or production screenshots.

### 8.3 Supported project modes

Phase 1:

- Self-contained HTML/CSS/JavaScript documents.
- Local static sites.
- React and Vite projects.

Later adapters:

- Next.js.
- Vue/Nuxt.
- Svelte/SvelteKit.
- Astro.
- Other frameworks through an adapter SDK.

## 9. Fast visual loop and durable code loop

### 9.1 Visual loop

The visual loop optimizes for conversational speed:

1. Resolve target and intent.
2. Generate a typed visual operation.
3. Validate scope and CSS/DOM constraints.
4. Apply a temporary reversible patch.
5. Render and capture affected frames.
6. Run lightweight visual checks.
7. Present the result immediately.

Typical visual operations include setting style properties, toggling classes, editing text, changing tokens, dragging/resizing elements, inserting/reordering/removing DOM nodes, and creating variants. In freeform HTML mode, accepted operations update the canonical HTML immediately. In repository mode, they remain accepted canvas operations until reconciled into source.

### 9.2 Reconciliation loop

Accepted visual changes enter a durable workflow:

1. Group accepted operations into an intent-preserving change set.
2. Locate responsible components, styles, tokens, and breakpoints.
3. Generate a source patch using the connected coding agent.
4. Build the project in an isolated environment.
5. Render all affected frames and states.
6. Compare the render against the accepted canvas state.
7. Run responsive, accessibility, and project tests.
8. Present the source diff and discrepancies.
9. Commit only after the configured approval policy.

The visual state remains recoverable if reconciliation fails.

## 10. Codex router integration

Canvas is a **deterministic visual runtime controlled primarily by Codex**. LUNA XHIGH/Codex performs generation, reasoning, conversation, and tool selection. Canvas performs document admission, rendering, selection, direct manipulation, patch application, validation, history, and permission enforcement. When the Codex router plugin is connected, Canvas must not make a separate LLM request.

### 10.1 Codex-first runtime selection

- **Connected mode:** The Codex router plugin is the only reasoning path. Canvas exposes typed tools and returns bounded state, render evidence, and revision results.
- **Disconnected mode:** Canvas remains usable for deterministic manual editing, rendering, inspection, history, and export without AI.
- **Future fallback mode:** An internal LLM may be used only when Codex is unavailable and the user explicitly enables it. Its provider, model, credentials, prompts, and product behavior are deferred to a later decision.
- The future fallback must implement the same Canvas capability contracts; it must not fork document semantics or create provider-specific project state.
- Essential project state lives in Canvas documents, operations, and revisions—not only in a Codex transcript or future provider transcript.

### 10.2 Codex router protocol

Expose Canvas through a versioned router protocol packaged by the Codex plugin. The protocol transports typed state and operations, not raw model-provider requests. MCP or another Codex-supported transport may adapt these same contracts without changing Canvas semantics.

**Document exchange**

- `document.get_html`
- `document.set_html`
- `document.patch_html`
- `document.validate_html`
- `document.get_revision`

**Project and canvas**

- `project.get_state`
- `canvas.list_frames`
- `canvas.create_frame`
- `canvas.position_frames`
- `canvas.create_variant`

**Selection and inspection**

- `selection.get`
- `selection.set`
- `dom.inspect`
- `styles.get_computed`
- `source.resolve_element`
- `render.capture`

**Visual editing**

- `patch.preview`
- `patch.update`
- `patch.accept`
- `patch.reject`
- `dom.insert`
- `dom.move`
- `dom.remove`
- `content.set_text`
- `styles.set`
- `tokens.set`

**Responsive behavior**

- `viewport.list_profiles`
- `viewport.set_profile`
- `responsive.propose_rule`
- `responsive.preview_rule`
- `responsive.audit`

**History and source**

- `revision.list`
- `revision.restore`
- `source.reconcile`
- `source.get_diff`
- `source.apply_diff`

**Continuous voice**

- `voice.stream.start`
- `voice.stream.append_audio`
- `voice.stream.update_context`
- `voice.stream.stop`
- `voice.stream.cancel`

Every tool contract must define schema, permission class, timeout, cancellation, idempotency, output bounds, and recovery behavior.

HTML admission and mutation calls must include an expected revision ID. Successful writes return the new revision ID, validation diagnostics, affected frame IDs, and a bounded summary of normalized changes. Full HTML is transferred only through document exchange calls, never smuggled through conversation text or tool-result summaries.

### 10.3 Permission classes

| Class | Examples | Default behavior |
|---|---|---|
| Read-only | Inspect DOM, styles, frames, screenshots | Allow within trusted project |
| Reversible canvas write | Temporary patch, variant, annotation | Allow and record |
| Durable project write | Modify source files or assets | Preview diff or follow project policy |
| Destructive | Delete source, discard shared history | Require explicit approval |
| External | Publish, deploy, send, install, fetch credentials | Require scoped approval |

## 11. State and data model

### 11.1 Core entities

- **Workspace:** User/team boundary and permissions.
- **Project:** Connected source, settings, token definitions, runtime mode, and history.
- **Canvas:** Spatial layout and sections.
- **Document:** Renderable HTML/application entry point.
- **Frame:** Viewport/component/state/reference instance on the canvas.
- **DeviceProfile:** Versioned viewport and environment preset.
- **ElementRef:** Stable design ID plus runtime DOM/source locators.
- **SelectionSet:** Ordered elements, regions, and relationships.
- **InteractionPacket:** Synchronized voice, cursor, annotation, viewport, and target data.
- **Operation:** Typed visual or source action.
- **PatchSet:** Ordered temporary or accepted operations.
- **Variant:** Branch from a revision with lineage.
- **Revision:** Immutable accepted canvas snapshot/event boundary.
- **SourceChange:** Proposed or applied code diff linked to accepted operations.
- **CodexRun:** Router session, tool calls, results, revision boundaries, budget, and status.
- **FallbackRun:** Reserved future record for internal-LLM execution when Codex is unavailable and fallback is explicitly enabled.

### 11.2 State separation

- **Codex-visible context:** Bounded current selection, frame state, recent interaction context, design-system rules, relevant source excerpts, and render evidence returned through the router protocol.
- **Durable event log:** Voice-stream metadata, context snapshots, operations, approvals, tool calls/results, revisions, reconciliation attempts, and errors. Raw audio is not stored by default.
- **Runtime state:** Active microphone, hover target, streaming deltas, render process, pending operations, and locks.
- **Project memory:** Accepted design rationale, named preferences, token meanings, recurring constraints, and known failures with provenance.

The event log and canonical HTML revision are authoritative. Codex context and future fallback prompts are derived snapshots, not the database.

### 11.3 Concurrency

- One serialized mutation lane per document/revision branch.
- Multiple read-only inspections and independent frame renders may run concurrently.
- Agent edits use optimistic revision IDs and fail cleanly when stale.
- User actions may interrupt an agent run; completed reversible operations remain recorded.
- Conflicting changes produce branches or an explicit merge, never silent last-write-wins behavior.

## 12. Design system and content

- Import and author CSS variables, tokens, fonts, spacing scales, radii, shadows, motion, and component variants.
- Map raw CSS values to tokens and flag off-system values.
- Let agents query token semantics, not only literal values.
- Support reusable components and instances with explicit detach/override behavior.
- Bind frames to realistic fixtures, JSON, APIs, or local data sources through permissioned connectors.
- Support localization stress tests, long text, missing images, and content-density variants.

## 13. Collaboration and history

- Multiplayer cursors, selections, and agent presence.
- DOM-anchored comments and threaded design decisions.
- Named checkpoints and automatic revisions.
- Branch, compare, merge, accept, reject, and restore.
- Before/after visual diff and source diff.
- Attribution for every human, Codex, future fallback, and tool action.
- Shareable read-only review links with scoped access.
- No production publishing in the MVP.

## 14. Safety, privacy, and recovery

- Project-local execution is sandboxed by default.
- Network access from rendered projects is configurable and visible.
- Secrets never enter Codex or future fallback context unless explicitly authorized for a named operation.
- Imported page content and repository instructions are untrusted context and cannot override product policy.
- Tool calls are recorded before side effects begin.
- Non-idempotent interrupted actions are not silently retried.
- Autosave uses an append-only operation/event log plus periodic snapshots.
- Crash recovery marks unfinished Codex/router or tool work interrupted, restores the latest valid HTML revision and render state, and preserves pending user input.
- Users can immediately stop voice capture, Codex/router activity, rendering, or reconciliation.
- Canvas discards acknowledged audio chunks and does not persist raw audio by default. The Codex host controls any downstream retention under its own visible policy.

## 15. Observability and quality evaluation

Record trace IDs and lifecycle events for:

- Voice stream lifecycle, chunk sequence, byte counts, context sequence, backpressure, cancellation, and failures; raw audio is excluded from logs.
- Target-resolution candidates and confidence.
- Codex router connection state, capability calls, latency, revision IDs, and failures.
- Future fallback provider, model, token, cost, and latency telemetry only when fallback mode is implemented and active.
- Tool calls, permissions, progress, results, and failures.
- Patch creation, render start/end, validation, acceptance, and rejection.
- Source reconciliation, build, screenshot comparison, and tests.
- Interrupts, retries, repairs, compaction, and recovery.

Key product metrics:

- Time from end of utterance to visible result.
- Correct target resolution rate.
- Percentage of edits accepted without re-prompt.
- Iterations per accepted design decision.
- Visual-to-source reconciliation success rate.
- Responsive regressions introduced per accepted change.
- Undo/restore success rate.
- User interruption and correction rate.

Initial eval scenarios must cover:

- “Make this button quieter” while hovering a nested icon.
- “Make these match” with two selected elements in different components.
- “Use the second option, but keep the first option’s spacing.”
- Phone-only stacking converted into an appropriate responsive rule.
- A change that causes overflow at an unpinned intermediate width.
- Voice ambiguity between two overlapping elements.
- Agent source reconciliation that builds but renders incorrectly.
- User interruption during a structural edit.
- Malicious instructions embedded in imported page content.

## 16. Accessibility requirements

- The editor UI is fully keyboard navigable.
- Canvas objects and DOM targets have accessible names and hierarchy navigation.
- Voice is optional; every voice action has a typed or keyboard equivalent.
- Color is never the only indicator of selection, state, or diagnostics.
- Generated designs can be audited for semantic structure, labels, contrast, focus order, touch targets, zoom behavior, and reduced motion.
- The agent explains accessibility-impacting changes and must not silently remove semantics to achieve a visual result.

## 17. MVP scope

### Included

- Infinite canvas with pan, zoom, sections, and virtualized viewport frames.
- Codex router plugin connection with versioned HTML document exchange and typed Canvas capabilities.
- Complete HTML/CSS/JavaScript admission from LUNA XHIGH/Codex, including sandbox validation and revision tracking.
- Arbitrary viewport frames plus initial mobile, tablet, laptop, desktop, and ultrawide presets.
- Linked responsive frames for one HTML/CSS/JavaScript document.
- Chromium rendering, live DOM inspection, and deterministic screenshots.
- Hover/click selection, multi-select, hierarchy traversal, and drawing annotations.
- Continuous browser audio capture and ordered Codex router streaming with synchronized, bounded context snapshots.
- Drag, resize, reorder, align, duplicate, and delete for supported unlocked design elements.
- Typed text, style, class, token, layout, and limited DOM structure patches that round-trip to canonical HTML in freeform mode.
- Temporary preview, accept, reject, undo, and revision history.
- Three-variant generation and comparison.
- Responsive overflow/overlap diagnostics.
- Deterministic disconnected editing without AI.
- Static HTML/CSS export.

### Explicitly excluded from MVP

- Full Figma file compatibility.
- General-purpose vector illustration tooling.
- Production deployment or hosting.
- Real-time multiplayer editing.
- Native mobile application rendering.
- Pixel-perfect Safari or Firefox engine emulation.
- Automatic reconciliation into every frontend framework.
- An internal LLM, hosted-model adapter, user-supplied model API, or model-selection UI; the fallback is deferred until its provider is specified.
- Automatic hover, circle, hold, or voice-activity activation policy for continuous audio; this behavior follows after the stream transport is validated.
- Autonomous publishing without review.

## 18. Delivery phases

### Phase 0 — Interaction prototype

- One live HTML frame populated from a complete Codex-supplied document.
- Codex router handshake plus `document.set_html`, `document.get_html`, selection, inspection, patch, and render-capture capabilities.
- Hover/click target resolution.
- Drag and resize with semantic layout operations and undo.
- Canvas-to-Codex revision round-trip after direct manipulation.
- Continuous voice-stream protocol, bounded ordered chunk pipeline, cancellation, and browser microphone capture adapter.

### Phase 1 — Canvas MVP

- Infinite virtualized canvas.
- Linked arbitrary viewport frames and preset catalog.
- Variants, revisions, responsive diagnostics, and HTML/CSS export.
- Complete Codex router capability surface and plugin packaging.

### Phase 2 — Repository mode

- Local project connection, source mapping, React/Vite adapter.
- Durable source reconciliation, build/test/render verification, and code diffs.
- Design tokens and component instances.

### Phase 3 — Collaborative product

- Multiplayer review, branches, threaded comments, permissions, and shared agents.
- Additional framework and browser adapters.
- Organization design-system governance and evaluation dashboards.

## 19. MVP acceptance criteria

The MVP is ready for a private alpha when:

1. A user can place at least 20 mixed viewport frames on one canvas and navigate them smoothly on a recommended development machine.
2. Frames accept arbitrary dimensions and the preset catalog covers all required device families.
3. Multiple linked frames render the same document with correct media/container-query behavior.
4. The user can hover or select an element, speak a change, and see the correct element patched without typing in at least 90% of the curated target-resolution evals.
5. Simple style changes reach a visible preview within the defined p95 latency target.
6. The user can accept, reject, undo, branch, compare, and restore without losing the original design.
7. A phone-specific request can be generalized into a responsive rule and previewed across every affected frame before acceptance.
8. Overflow, overlap, clipping, and safe-area failures are reported for affected frames.
9. LUNA XHIGH/Codex can supply complete HTML, inspect and edit the rendered result through the router plugin, and receive the latest revision after a Canvas manipulation.
10. Every accepted operation is attributable and recoverable after an application restart.
11. Static HTML/CSS export reproduces the accepted design within the defined screenshot-diff tolerance.
12. The product can complete the initial eval suite without hidden manual intervention.
13. Canvas makes no LLM request while the Codex router plugin is connected.
14. A user can drag every supported unlocked visual element, and the resulting semantic HTML/CSS survives export and reload.

## 20. Open decisions

- Desktop shell versus browser-first application. A desktop shell offers stronger local-repository, microphone, process, and sandbox integration; browser-first reduces installation friction.
- Which internal LLM/provider will power the explicitly enabled fallback when Codex is not connected.
- Whether Canvas normalizes admitted HTML into an internal DOM/CSS representation for editing while retaining lossless source boundaries, or edits the source document directly.
- How stable element IDs survive arbitrary framework rerenders and source refactors.
- Whether the Codex host returns optional transcript timing for debugging and accessibility without making transcripts part of Canvas's execution path.
- Whether temporary structural DOM edits should be allowed before repository reconciliation in the first release.
- How much direct manipulation belongs in the product without recreating a conventional property-panel design tool.
- Whether device frames simulate only web viewport characteristics or also browser UI and hardware posture in later phases.

## 21. Product positioning

Short form:

> The visual design surface for Codex—LUNA XHIGH writes the HTML, and you shape the live result by talking, pointing, and dragging.

Category distinction:

- Unlike traditional design tools, Canvas renders the actual web medium.
- Unlike AI website generators, Canvas supports continuous, local, targeted iteration rather than repeated whole-page regeneration.
- Unlike standalone AI website generators, Canvas uses Codex as the primary intelligence and does not duplicate an LLM stack when the router plugin is connected.
- Unlike annotation extensions, Canvas owns the design state, variants, responsive relationships, history, and verified code loop.
