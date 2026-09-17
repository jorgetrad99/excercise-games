# Render budget measurement (spec)

Status: **spec, not run.** Jorge sequences it after the external-display routing change (dGPU → iGPU) is measured and recorded. The session that runs it follows this file exactly and reports in the §6 table.

## Why

- **Void conclusion:** the park biome is 586k triangles (1P) and 1.17 M (2P). The "no fps effect on this GPU" conclusion was measured on a contended machine (PROGRESS 2026-09-16 "Perf follow-ups" §4), so it's void.
- **What's gated on it:** the chaser and the traversal power-up (skyhook) have to fit inside a measured headroom. This file defines that headroom as numbers, not as "fps still 60".

## 1. What limits us (the two budgets)

| Budget | Interval | Gate today | Binding case |
|---|---|---|---|
| **Render frame** | 16.7 ms (60 Hz) | ≥ 55 fps (18.2 ms) | 2P park: two views, 1.17 M triangles |
| **Pose frame** | 33.3 ms (30 fps camera) | ≥ 20 pose-fps | 2P: two poses ≈ 25–29 ms of inference; it shares the GPU with rendering |

**Why pose counts as a render budget:** added geometry costs pose-fps before it costs render fps, because MediaPipe runs on the same GPU. The earlier (contended) "+1–3 ms inference in park" is exactly the effect to measure properly.

## 2. Preconditions (a run that misses one is PROVISIONAL, not a result)

1. **Display routing** recorded in the report: which GPU drives the external display, Jorge's before/after.
2. **Perf lock:** `node scripts/e2e-lock.mjs wait`, then hold the lock for the whole session (`scripts/perf-probe.mjs` takes it).
3. **Contention check not provisional** (`tests/e2e/contention.config.ts` thresholds), sampled at the start **and** end of every scene. Its machine line is attached to every scene result.
4. **Power:** AC power, Windows power plan recorded, GPU temperature and throttle reasons recorded (machine line).
5. **Hardware:** `gpu` line shows the RTX 4060, not a software renderer.
6. **Build:** same commit for every scene, recorded in the report.

## 3. Scenes

All at 1920×1080, fake camera clips from `tests/e2e/assets/`, `seed=42`, `autoplay=1`.

| ID | Scene | Why |
|---|---|---|
| R1 | Skate 1P **street**, pose on (`?game=skate-run&input=pose&seed=42&autoplay=1`), measured 10–30 s | low-geometry reference (~40k triangles) |
| R2 | Skate 1P **park**, pose on, measured from distance ≥ 1100 m | 586k triangles |
| R3 | Skate 2P **street**, pose on (`&players=2`, two-person clip) | 2P reference |
| R4 | Skate 2P **park**, pose on, distance ≥ 1100 m | **binding case**, 1.17 M triangles |
| R5 | Skate 2P park, **no pose** (`input=bot`) | render cost alone, to separate GPU sharing from geometry |
| R6 | Boxing 2P pose (`?game=boxing&input=pose&seed=42&players=2`) | **control**: an unchanged scene, to detect machine drift between repetitions |
| R7 | R4 **headed, fullscreen on the display you play on** | the real present path: after routing the display to the iGPU, a dGPU-rendered window crosses adapters, which headless doesn't pay |

**Probe additions the measuring session makes first** (small, in `scripts/perf-probe.mjs`):
- Park scenarios: wait until `getState().distance ≥ 1100` before sampling.
- `inferMs` p95, not just the median.
- Frame-time p95 from rAF deltas.
- An uncapped-render mode: Chromium `--disable-gpu-vsync --disable-frame-rate-limit`.

**Sanity check before trusting uncapped numbers:** R1 must exceed 60 fps. If it doesn't, the cap is still on, and render headroom can't be read from fps.

## 4. Procedure

- **Order:** 5 repetitions, **round-robin** (R1…R7, R1…R7, …), not 5× each in a block, so machine drift spreads over all scenes.
- **Timing:** 5 s warm-up, then 20 s sampled per scene.
- **Render headroom:** R1–R5 run uncapped. Pose scenes are camera-capped at 30 anyway; use `inferMs` for pose headroom.
- **Per scene, per repetition, record:**
  - render fps p5 / median
  - frame-time p50 / p95 (ms)
  - main-thread rAF CPU ms p50 / p95 (`__perf` dump)
  - pose-fps min / mean, `inferMs` p50 / p95
  - draw calls, triangles
  - the machine line: external GPU %, external CPU cores, top external processes, GPU temp, P-state, throttle reasons
- **Validity:**
  - R6's median frame time and `inferMs` p50 must stay within **±10 %** across the 5 repetitions. Otherwise the machine drifted, and the whole set is provisional.
  - Any repetition flagged provisional is dropped and re-run, never averaged in.
- **Reported value:** the median over repetitions of each p95 or min, plus min–max across repetitions.

## 5. Budget arithmetic (the numbers handed to the chaser and skyhook design)

**Reserves** are kept unspent for background variance. Today's observed swing: 2P pose-fps 30 → 25 from background load alone.
- `reserveRender` = 2.5 ms (15 % of 16.7 ms)
- `reservePose` = 5.0 ms (15 % of 33.3 ms)

**Headroom in the binding scene:**
- `Hr` = 16.7 − frameP95(R4 uncapped with pose; take the worse of R4 and R7) − `reserveRender`
- `Hp` = 33.3 − inferP95(R4) − `reservePose`

**Marginal cost of geometry** (street → park, same player count):
- `cr` = (frameP50(R4) − frameP50(R3)) / (tris(R4) − tris(R3)), in ms per triangle
- `cp` = (inferP50(R4) − inferP50(R3)) / (tris(R4) − tris(R3)), in ms of inference per triangle
- **Noise rule:** if a delta is smaller than twice its run-to-run spread, that cost isn't measurable at this scale. Drop that constraint, and cap the allowance at 25 % of R4's triangles until a synthetic load confirms it.

**Allowance for chaser + skyhook together, 2P:**
- **Triangles:** `T2P` = min(`Hr`/`cr`, `Hp`/`cp`), then **per view** `T` = `T2P` / 2.
- **Draw calls:** the gate is < 150; R4 uses 110–114, and a reserve of 10 is kept. Allowance = 150 − calls(R4) − 10, **halved per view** (≈ 13 per view at today's 114).
- **Frame time:** the added p95 frame time must be ≤ `Hr`.
- **Pose:** the added 2P `inferMs` p95 must be ≤ `Hp`.
- **Negative headroom:** if `Hr` or `Hp` is ≤ 0, the park **already** exceeds the budget. The result is "cut park geometry first" (decimation / instance counts), not an allowance.

## 6. Report (paste into PROGRESS; the headline numbers go to the design session)

| Scene | render fps p5 (uncapped) | frame p95 ms | pose-fps min | infer p95 ms | calls | tris | external GPU % / CPU cores | valid |
|---|---|---|---|---|---|---|---|---|
| R1 … R7 | | | | | | | | |

**Headline, handed over as:**
> Chaser + skyhook, together, per view: ≤ **T** triangles, ≤ **D** draw calls; 2P added frame p95 ≤ **Hr** ms; 2P added inference p95 ≤ **Hp** ms. Measured `<date>`, commit `<sha>`, display routing `<dGPU|iGPU>`, R6 drift `<x %>`.

**Also report:** R7 − R4, the real present-path cost after the routing change. If routing the display to the iGPU saves the compositor's GPU share but adds a cross-adapter copy, this is where it shows.
