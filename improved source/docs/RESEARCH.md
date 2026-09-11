# Research Report — Building a Self-Improving Design Tool

*How the best tools observe user behavior, detect frustration, and turn it into
product improvement — and what we reused versus built.*

---

## 1. What we set out to build

A system inside the design tool that:

1. **Records everything** the user does: pointer movement, clicks, scrolls,
   prompts sent to the agent, artifacts produced, UI state changes.
2. **Detects frustration automatically** — including the motivating scenario:
   *the user sweeps the mouse toward the right edge, the sidebar doesn't appear,
   and they sweep again quickly → that is a frustration point.*
3. **Closes the loop**: proposes concrete UX adaptations, applies the safe ones,
   verifies with future usage whether friction actually dropped, and rolls back
   regressions. Per-user, local-first.

## 2. How industry tools detect frustration

Production behavioral-analytics tools converge on a small set of signals. Their
thresholds are the closest thing to an industry standard:

| Signal | Definition | Typical thresholds | Sources |
| --- | --- | --- | --- |
| **Rage click** | ≥N clicks clustered in space & time with no page response between them | 3+ clicks / ~60–100 px / ≤1.5 s (Hotjar-era convention); LaunchDarkly default is 5 / 8 px / 2 s; all configurable | Clarity blog, Datadog RUM docs, LaunchDarkly session-replay tutorial |
| **Dead click** | Click on an interactive-looking element with no visible response | No DOM/navigation/network change within ~0.7 s | Datadog, Clickport |
| **Error click** | Click immediately followed by a JS error | Error within ~1 s of click | Datadog RUM frustration signals |
| **Excessive scrolling** | Far more scrolling than expected | Session-level z-score vs site average | Microsoft Clarity semantic metrics |
| **Quick back** | Navigation away and back within a short dwell time | Dwell < threshold; "adapts to your specific site" | Clarity |
| **Mouse thrash / u-turns** | Rapid direction reversals in a small area | Heuristic; used by replay vendors for highlight reels | FullStory-style dx-tooling write-ups |

Key lessons adopted:

- **Thresholds must be configurable** — every vendor ships defaults but exposes
  tuning (LaunchDarkly even edits them server-side without redeploy).
- **"No response" is defined relative to app state**, not just network calls.
  We therefore treat `ui-state` events (sidebar opened, panel toggled) as first-
  class responses.
- **Weighted friction scores** beat raw counts; rage-class signals weigh more
  than dead clicks because they encode higher emotional intensity (VulpaSoft's
  scoring rationale, Contentsquare benchmark data).
- **Clarity's Bing case study** validated the whole premise: missed clicks on
  the search box affected 4% of users; the fix was geometric (margins), found
  purely from rage-click replays.

### The gap we filled: ghost gestures

None of the shipped signals capture *unfulfilled hover intent* — moving toward
a region expecting UI to appear, getting nothing, and repeating. This is
extremely common in canvas tools (edge-anchored panels, hover-revealed docks).
We define it precisely so it can be detected deterministically:

> **Ghost gesture**: two or more fast approaches (entry speed ≥ threshold)
> into a target region within a repeat window, where no matching UI-state
> response occurs during or shortly after the chain.

It generalizes rage/dead clicks to *hover-space*, which is where design tools
actually live. It is our main original detector; everything else follows
published conventions with cited defaults.

## 3. Open-source landscape — what can be reused

| Project | License | What it gives us | Verdict for this project |
| --- | --- | --- | --- |
| **rrweb** (rrweb-io/rrweb) | MIT | DOM-mutation + interaction capture/replay primitives; the capture layer under PostHog/Sentry/Highlight | Excellent if pixel-perfect *replay* is ever needed. Heavyweight (~video-like data) for a local loop; we record structured events instead. Reuse later for a "watch what happened" feature. |
| **microsoft/clarity** (`clarity-js`) | MIT | Production-grade instrumentation code: interaction + layout tracking, dead/rage-click heuristics, privacy-first design | The best reference implementation. Its event taxonomy informed our schema; its heuristics corroborate thresholds. Direct dependency not required — its ideas are embedded. |
| **PostHog** | MIT core | Full product analytics + session replay + feature flags; self-hostable | Right choice for *team-scale* hosted analytics. Overkill (Docker, ClickHouse) for an on-device per-user loop; its event model shaped ours. |
| **OpenReplay** | AGPLv3 core | Most complete self-hosted replay product | Ops-heavy; AGPL licensing friction; replay-centric rather than adaptation-centric. |
| **Matomo / Plausible / Umami** | GPL/AGPL/MIT | Privacy-first web analytics, heatmaps | Marketing-page oriented; no prompts/artifacts/UI-state concepts, no closed loop. |
| **DavidWells/analytics** | MIT | Vendor-agnostic analytics abstraction | Useful pattern (single track() façade) — mirrored in our TrackerCore API. |

**Decision:** reuse *ideas, schemas, and thresholds* (credited above); build the
loop itself as a zero-dependency TypeScript library, because the differentiating
part — signal → proposal → apply → verify → rollback, entirely on-device — does
not exist in any of these projects. They stop at dashboards.

## 4. Adaptive-UI research: making the improvement principled

- **SUPPLE** (Gajos, Weld, UIST 2008) — automatically generated personalized
  interfaces by optimizing over device/user models; ARNAULD learned preference
  models from user behavior. Lesson: constrain the action space and let
  evidence choose; never free-form mutate UI.
- **RL-based real-time personalization** (Khamaj & Ali, Alexandria Eng. J.
  2024) and **AI-driven front-end personalization** (Rajhans, ACDSA 2026):
  LSTM path-prediction and bandit-style selection outperform static rule sets
  once traffic accumulates — but both start with deterministic policies and
  graduate to learning. Our engine mirrors this: rule advisor now, pluggable
  advisor interface (LLM/bandit) later, with identical safety gates.
- **Behavior-driven AUI generation** (Springer 2026) reports SUS gains when UIs
  adapt to measured behavior patterns vs static UIs (64 vs 57 baseline).
- **LLM-closed-loop engineering** (Arize/FutureAGI 2025–26): self-improving
  software requires telemetry as ground truth plus evaluation gates; agents
  verify changes against traces before shipping. Our verify/rollback stage is
  exactly this pattern applied to UX instead of code.

Design principles distilled (and enforced in code):

1. Adaptations are **small, typed, reversible**, and catalogued.
2. Every application carries **evidence** (which signals justified it).
3. **Policy gate**: auto-apply only above confidence/severity thresholds;
   everything else is surfaced as a suggestion.
4. **Verification before permanence**: keep only if post-change friction drops;
   roll back otherwise. Insufficient data ⇒ keep observing, never guess.
5. **Privacy**: local-first storage; LLM advisors receive aggregates only.

## 5. Threshold cheat sheet (as implemented)

```
ghost-gesture     attempts≥2, entry speed ≥0.5–0.6 px/ms, repeat window 5–8 s,
                  response grace 250 ms            (our definition; tuned in demo)
rage-click        ≥3 clicks, 60 px, 1.5 s          (industry default band)
dead-click        interactive target, no response 700 ms
error-click       error within 1 s after click
mouse-thrash      ≥6 reversals / 2 s within 240 px spread
excessive-scroll  >6 400 px / 10 s per surface
prompt-retry      token-Jaccard ≥0.7, no accepted artifact between sends
friction score    Σ weight(kind) × confidence × severity ×10, capped at 100
weights           ghost 1.0 · rage .95 · error .8 · retry .7 · dead .6 · thrash .4 · scroll .35
auto-apply        confidence ≥0.55 AND max severity ≥0.5
rollback          pain increase >20% across verified windows
```

## 6. Sources

- Datadog, "Detect user pain points with Datadog Frustration Signals" (2022) &
  RUM frustration-signals docs
- Microsoft Clarity blog, "Rage clicks – what do they tell you about user
  behavior?" (2021) — includes the Bing search-box case study;
  Clarity semantic metrics (excessive scrolling, quick backs, dwell time)
- LaunchDarkly, "Detecting user frustration: understanding rage clicks and
  session replay" (2025) — configurable 5/8px/2s defaults
- Clickport, "Rage clicks and dead clicks" (2026) — 700 ms dead-click window,
  cookieless/no-recording detection stance
- rrweb project blogs: open-source session-replay guide, OSS comparison (2026);
  relyv.ai OSS landscape (2026); PostHog OSS replay comparison
- microsoft/clarity GitHub (MIT, 2.7k★) — clarity-js/clarity-decode structure
- Gajos & Weld, "SUPPLE: Automatically Generating User Interfaces" (IUI/UIST);
  SUPPLE + Arnauld line of work
- Khamaj & Ali, "Adapting user experience with reinforcement learning",
  Alexandria Engineering Journal (2024)
- Rajhans, "Intelligent Front-End Personalization: AI-Driven UI Adaptation"
  (ACDSA 2026, arXiv 2602.03154)
- Arize, "Closing the Loop: Coding Agents, Telemetry, and the Path to
  Self-Improving Software" (2026); FutureAGI on evaluation-gated loops
