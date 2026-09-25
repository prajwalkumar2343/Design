# Canvas perf evidence — lazy mount queue vs eager all-live

Measured with `qa/perf-bench.mjs` (Playwright, headless Chromium, 1600×1000
viewport). **Baseline** = pre-change scheme (`liveFrameIdSet` mounts every
active-page frame's iframe eagerly); **current** = this branch (visibility
scan + bounded mount queue, `MAX_MOUNTED_FRAMES=64`, `MAX_INFLIGHT_MOUNTS=3`).

Identical seed: `push` ops through the agent bridge on `?demo=1`, 420×320
frames in a wide grid.

## Same-workload A/B — 300 frames

| metric | baseline | current | delta |
|---|---|---|---|
| seed enqueue (300 ops, result-gated) | 241.2 s | 38.6 s | 6.2× faster |
| frames applied to DOM after seed | 191 / 304 (>120 s timeout) | 304 / 304 in 8 ms | — |
| mounted iframes | 304 (all) | 64 (cap) | 4.75× fewer |
| overview pan (fit-all) | **2.40 FPS**, 349.4 s long tasks | **47.6 FPS**, 0.59 s | ~20× |
| zoomed pan | 47.9 FPS, 4.6 s long tasks | 52.4 FPS, 0.42 s | +9% |
| wheel pan | **2.05 FPS**, 80.3 s long tasks | **55.6 FPS**, 0.18 s | ~27× |
| JS heap | 82 MB | 87 MB | ~parity |

## Requirement check — 1000+ frames

**Current** (`--frames 1000`; 1204 total after inbox replay of earlier seeds):

- 1204 `.canvas-frame` sections applied in **8 ms**; iframes held at exactly
  the 64 cap at rest and end-of-run.
- Overview pan **45.5 FPS** (1.0 s long tasks), zoomed pan **40.1 FPS**,
  wheel pan **30.9 FPS** (2.3 s long tasks). JS heap 215 MB.

**Baseline** at the same workload could not ingest it: a bounded probe
(fire-and-forget seed of 1000 ops, no result gating) rendered only
**129 / 1000** frames after ~80 s, idled at **3.45 FPS**, heap 368 MB and
climbing — the eager iframe mount storm starves the main thread before
seeding even completes.

## Notes

- Baseline dev server: `/private/tmp/design-baseline` on :5299 (pre-change
  snapshot, agent bridge present). Its earlier "5 live" readings were a stale
  served bundle — after a `--force` restart it mounts all frames eagerly as
  the code dictates.
- `measurePan` wall-clock balloons under load (Playwright waits queue behind
  a melting page) — baseline's 2.5 s nominal overview pan took 377 s.
- Reproduce: `npm run dev -- --port <p> --force`, then
  `node qa/perf-bench.mjs --url http://127.0.0.1:<p> --frames 300`.
