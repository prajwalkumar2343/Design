# improved source — the self-improvement loop

Observes how the user actually works in the design tool, detects frustration
(the "swept to the sidebar twice and nothing opened" class of problems), and
continuously adapts the app for that user — locally, transparently,
reversibly.

```
observe ──▶ detect signals ──▶ propose adaptations ──▶ policy gate ──▶ apply
   ▲                                                                │
   └──── verify on future sessions · roll back if friction rose ◀───┘
```

## Layout

```
improved source/
├── src/
│   ├── events.ts        versioned event schema (pointer, click, scroll, input,
│   │                    prompt, artifact, ui-state, error, custom)
│   ├── store.ts         EventStore interface + MemoryEventStore
│   ├── store-file.ts    JSONL per-session store (Node/desktop)
│   ├── store-web.ts     localStorage store with bounded retention (browser)
│   ├── tracker.ts       TrackerCore (pure, testable) + installTracker (DOM)
│   ├── detectors.ts     ghost-gesture, rage/dead/error clicks, thrash,
│   │                    excessive scroll, prompt retry — pure functions
│   ├── analyze.ts       friction scores, per-feature pain, trends, A/B windows
│   ├── adaptations.ts   typed adaptation catalog + signal→fix mapping
│   ├── propose.ts       deterministic RuleAdvisor + Proposal model
│   ├── llm-advisor.ts   optional OpenAI-compatible advisor (aggregates only)
│   ├── engine.ts        ImprovementEngine: cycle, policy gate, verification
│   ├── state-store.ts   engine state persistence (JSON file / localStorage)
│   ├── node-cli.ts      report generator → dashboard/report.json
│   └── index.ts         public API incl. startSelfImprovement()
├── dashboard/           static insights dashboard (no build step)
├── demo/                mini design tool demonstrating the full loop live
├── scripts/             seed-and-report.ts — synthetic end-to-end run
├── docs/RESEARCH.md     research report: methods, tools, repos, decisions
└── test/                32 unit/integration tests (node:test, zero deps)
```

Zero runtime dependencies. Runs on Node ≥ 23.6 (native TS type-stripping) and
in any modern browser.

## Quickstart

```bash
cd "improved source"

npm test                 # 32 tests across stores/detectors/engine/analysis
npm run typecheck        # strict TS, 0 errors
npm run seed             # synthetic 2-session end-to-end run → data/ + report
npm run build:report     # regenerate dashboard/report.json from stored sessions
npm run demo             # serve demo + dashboard via Vite (uses ../ vite)
# open http://localhost:5199  → sweep mouse right, fast, twice.
```

The demo reproduces the product brief exactly: the sidebar ignores hover until
a ghost gesture is detected; the engine auto-applies `panel-open-on-hover-intent`;
the sidebar then opens on approach and the signal stops firing.

## How a session flows

1. `startSelfImprovement({ apply })` creates a `SessionHeader`, opens an
   event store, installs DOM listeners (sampled pointer moves, resolved clicks
   with selector + interactivity, scroll surfaces, errors), and exposes typed
   app hooks:
   - `tracker.trackPrompt(id, text)`
   - `tracker.trackArtifact(kind, id, type, promptId, latencyMs)`
   - `tracker.trackUiState(feature, property, from, to)`
2. On an interval, detectors run over the bounded recent-event window. New
   signals go to your `onSignals` callback and into the engine.
3. `engine.runCycle()` asks advisors for proposals, dedupes them against
   history/cooldowns, and either **auto-applies** (confidence ≥ 0.55 and a
   supporting signal severity ≥ 0.5) through your `apply` function or records
   them as suggestions for review.
4. `engine.evaluate(analyses)` later compares per-feature pain before vs after
   each applied adaptation. Improvement ⇒ kept permanently; regression ⇒ your
   `revert` runs and the adaptation is deactivated. Not enough data ⇒ waits.

## Integrating into the main design app (`../src`)

The parent project already has the right seams:

```ts
// src/App.tsx (or main.tsx), once at startup:
import { startSelfImprovement } from "../improved source/src/index.ts";

const loop = await startSelfImprovement({
  apply: async (adaptation) => {
    // map adaptation.kind onto real UI state, e.g.:
    if (adaptation.kind === "panel-open-on-hover-intent")
      return enableSidebarHoverIntent(adaptation.params.hoverDelayMs as number);
    return false;
  },
});

// LeftSidebar.tsx — inside the collapsed/open effect:
loop.tracker.trackUiState("left-sidebar", "open", String(prevOpen), String(open));

// wherever prompts are dispatched:
loop.tracker.trackPrompt(promptId, text);

// wherever artifacts are accepted/discarded:
loop.tracker.trackArtifact("artifact-accepted", artifactId, kind, promptId, latencyMs);
```

Ghost targets are declared where geometry lives, e.g. the left sidebar edge of
`CanvasSurface.tsx`, so detection always matches rendered reality.

Optional LLM proposals (aggregates only — never raw prompt text):

```ts
import { LlmAdvisor, HttpLlmClient } from "../improved source/src/index.ts";

extraAdvisors: [new LlmAdvisor(new HttpLlmClient({
  endpoint: "https://api.openai.com/v1/chat/completions",
  apiKey: import.meta.env.VITE_LLM_KEY,
  model: "gpt-4o-mini",
}))]
```

## Privacy & safety

- All raw events stay in the browser (`localStorage`) or on disk (`data/sessions/*.jsonl`).
- Input *content* is never recorded — only field ids and lengths; prompt text is
  stored solely for local retry detection and truncated at 4 000 chars.
- Every adaptation is visible in `dashboard/report.json` with its evidence and
  decision note; every one is reversible by construction.
- The system never blocks the UI: persistence failures are swallowed, detector
  passes are interval-bounded, buffers are capped.

## Verification status

- 32/32 unit & integration tests pass (`npm test`)
- strict TypeScript: 0 errors (`npm run typecheck`)
- end-to-end seed script: frustrated session scores 17 vs calm 0; engine
  auto-applies the hover-intent fix; report lists it as `applied`
- demo builds clean through the parent project's Vite
