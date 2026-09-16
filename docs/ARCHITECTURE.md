# Architecture

Agent-maintained module map. The spec lives in `docs/PLAN.md` §3; this file records what exists **now** and how boundaries are enforced. Update it when a module is added or a rule changes.

## Module map

| Path                   | Status (M2)            | Role                                                                                    |
| ---------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `src/core/`            | M3 sim: `sim`, `worldgen`, `patterns`, `collision`, `bot`, `hash`, `prng`, `input` | Pure, deterministic TS: sim, worldgen, scoring, progression. ADR-002.                   |
| `src/input/`           | keyboard, pose, replay | `InputSource` impls: pose, keyboard, replay, network. The only layer that sees both pose and core events. |
| `src/pose/`            | M1 pipeline, M2 gestures | Camera manager, worker bridge, One Euro filter, signals, gesture engine, debug HUD. See "Pose pipeline (M1)" and "Gestures (M2)" below. |
| `src/render/`          | M4 view + HUD          | three.js behind `createRenderer()` (ADR-001), scene, chunk views, pools, DOM HUD.       |
| `src/net/`             | —                      | Colyseus client + room protocol (M6).                                                   |
| `src/platform/`        | `rate`, `latency`, `menu` | Profile store, settings, debug bridge (`window.__game`), game-select menu (DOM, unstyled). |
| `src/games/`           | `types.ts`, `skate-run/` | `types.ts` = the `MiniGame` contract (PLAN §2.6). One `MiniGame` per `<id>/` folder. `skate-run/` wraps `core/` + `render/` in place (Phase 2 option A: not moved yet) and owns its gesture→input map. |
| `src/main.ts`          | game-agnostic shell    | Boot: `?game=<id>` launches that MiniGame, otherwise the menu; URL params → sim (`?seed`, `?tokens`), inputs (`?input=pose|keyboard|bot|replay:<fixture>`, keyboard always on), rAF loop (sim.step → view.render → HUD; `?clock=manual` for screenshots), calibration gate for pose/replay, restart on JUMP after game over, `window.__game`. |
| `src/debug-bridge.d.ts`| `Window.__game` type   | Debug bridge contract shared by app and Playwright tests.                               |
| `public/models/`       | vendored, gitignored   | MediaPipe wasm + `pose_landmarker_{lite,full,heavy}.task` (model v1). Regenerate: `pnpm vendor:models`. |
| `tests/e2e/`           | `boot`, `pose`, `gestures` smoke | Playwright; `smoke` project = `*.smoke.spec.ts`, new-headless Chromium (real GPU) with the fake camera fed by `tests/e2e/assets/placeholder-person.mjpeg` (interim, see CREDITS.md). |
| `tests/unit/`          | `boundaries.spec.ts`   | Vitest for cross-cutting checks; module tests are colocated `*.spec.ts`.                |

## Dependency rules (enforced)

Enforced by ESLint core rules in `eslint.config.js` (no plugin), and proven by `tests/unit/boundaries.spec.ts`:

```
core     ─✗→ render, pose, input, net, platform, games, three, @mediapipe/*
core     ─✗→ window, document, navigator, performance, requestAnimationFrame, setTimeout, setInterval, localStorage, Math.random
render   ─✗→ pose
pose     ─✗→ core          (only input/ bridges pose ⇄ core events)
games/a  ─✗→ games/b     (rule covers src/games/*/**; the shared games/types.ts may import layers)
```

Also enforced on non-test `src/**`: `max-lines` 400, `max-lines-per-function` 60. `typescript-eslint` recommended bans `any` and `@ts-ignore`.

## Pose pipeline (M1)

```
getUserMedia 1280x720@30 (camera.ts, ideal constraints, remembered deviceId)
  → <video> ─ requestVideoFrameCallback (pipeline.ts)
      → createImageBitmap resize to 640 px wide, aspect kept   [skipped while the worker is busy]
      → bridge.ts ─ transfer ─→ pose.worker.ts: PoseLandmarker VIDEO mode, GPU delegate on OffscreenCanvas (CPU fallback)
      ← PoseFrame {t, poses: Landmark[33][]}  (raw, unmirrored coordinates)
  → pose-panel.ts: mirrored video + skeleton (CSS scaleX(-1) on both), visibility heatmap, fps; recorder.ts for ?record=1
```

- **Backpressure:** at most one frame in flight. If the worker is slower than the camera, stale frames get dropped instead of queued.
- **Recovery:** the bridge restarts the worker on `error`, on a posted `fatal`, or when no result arrives within 3 s (watchdog). It backs off 0.5 s → 10 s. The worker runs one warm-up detect before `ready`, so graph build/shader compile (seconds) doesn't trip the watchdog.
- **Vite gotcha:** MediaPipe's module loader `import()`s `/models/wasm/vision_wasm_module_internal.js`. Vite dev rewrites that import to `?import` and returns 500 for JS under `public/`. The worker installs a `self.import` shim built with `new Function`, which the loader prefers, so the file is fetched as plain static JS.
- **Fixture format** (`recorder.ts` `PoseFixture`): `{version: 1, recordedAt, model, video: {width, height}, frames: PoseFrame[]}`, with `t` rebased to 0 ms.

## Gestures (M2)

```
PoseFrame ─ body.ts: 7 landmarks, visibility ≥ 0.5 (hold ≤ 300 ms), One Euro in pixel space → Measures
          ─ calibration.ts: waiting → calibrating (still + neutral 2 s) → calibrated {shoulderX, hipY, noseY, torsoLen, shoulderWidth}
          ─ gestures.ts: SignalFrame {leanX, hipRise, hipRiseVel, headDrop, armsUp, tPose, zone, tracking, calibration}
                         + GestureEvents (lanes, jump/grab, slide, revive hold, T-pose recalibrate, tracking lost/restored)
input/pose-source.ts: GestureEvent → core InputEvent via the game's `gestureProfile.toInput` (Skate Run: REVIVE_ACCEPT→REVIVE, TRACKING_LOST→PAUSE, TRACKING_RESTORED→RESUME)
input/replay.ts: PoseFixture → pose-source (instant: fixture time; realtime: rebased onto performance.now)
input/keyboard.ts: ←/→ lanes, Space jump, ↓ slide (down/up), ↑ grab, C recalibrate
```

- **All tuning** lives in `src/pose/gestures.config.ts`.
- **Denominators are calibrated values, not live ones.** leanX uses the calibrated shoulder width; hipRise/headDrop use the calibrated torso. Live shoulder width collapses when the player turns (0.03 in the real recording), which would fire false lane changes. Calibrate at the play position (T-pose 1 s or `C`).
- **The engine is context-free.** It doesn't know whether a run is active, so REVIVE and GRAB relevance is the sim's call (M3).
- **Tests:** `src/pose/testdata/synthetic.ts` builds keyframed synthetic poses. Every test using it is marked `TEMPORARY(synthetic-fixtures)` until per-gesture recordings exist.

## Core sim (M3)

```
SimOptions {seed, reviveTokens, multiplier} → initState → SimState (plain JSON data)
tick(state, ctx, events) @ 120 Hz:  events → phase machine → speed ramp → lateral/vertical move
                                    → ensureChunks (8 ahead, 1 behind) → AABB collide → collect
GameSim.step(dt, events): accumulator (clamped 0.25 s) over tick(); drainEvents() for HUD/sound
```

- **Phases:** countdown (3 s) → running → crashed (revive offer 3 s, only with a token, max 2/run) → over. PAUSE from countdown/running/crashed; RESUME returns to the offer, or to a ≥ 1 s countdown.
- **World:** `worldgen.ts` picks a pattern per chunk with `chunkRng(seed, index)`, filtered by difficulty ceiling (+1 per 300 m) and biome (switches every 1000 m), weighted toward the ceiling. Rows that block every lane ("forced") are kept ≥ 1.5 s of travel apart via `ChunkState.lastForced`.
- **Patterns:** `patterns.ts` holds ASCII grids (12 rows × 3 lanes, far → near): `J` hurdle (jump), `S` bar (slide), `W` wall (change lane), `c`/`o` coins, `P` power-up spot.
- **Determinism contract:** logs are **tick-stamped**. `tick()` is exact. `GameSim.step()` applies live events at the next tick, so wall-clock frame pacing decides where a live event lands. Replays and multiplayer record `(tick, type)`.
- **Bot (`bot.ts`):** DFS over cloned states, horizon 1.5 s, decisions at 20 Hz. It only survives what the real physics allows, so it doubles as the solvability validator (`patterns.spec.ts`) and the sequence check (`tests/unit/core/bot.spec.ts`).
- **Tuning:** `sim.config.ts`.

## Renderer (M4)

```
main.ts rAF: sim.step(dt, queued InputEvents) → view.render(state, alpha) → hud.update(state)
render/view.ts:      createRenderer (WebGLRenderer, ADR-001) · scene · fog/sky/hemi per biome · sun + 1024² shadow
                     follow camera = pure function of state (reproducible screenshots)
render/world-view.ts: per frame, every live chunk → instanced pools (begin/add/end):
                     road + ground tiles (instance colour per biome), lane dashes, roadside props,
                     backdrop blocks, obstacles (Quaternius models + procedural pieces fitted to the sim's collision boxes; flat parts merged per model, render/merge.ts),
                     coins (spin by sim t), pickups
render/models.ts:    GLTFLoader → fitParts (normalise into a box) → instanced() pools; box fallback on load error
render/skater.ts:    procedural rig; ride / slide / air / grab / crashed poses from state
render/hud.ts:       DOM overlay; writes only changed HTML
```

- **Render z:** `-(worldZ - distance)`, so the player stays at the origin.
- **Draw calls:** one per sub-mesh per model, independent of instance counts (51–53 in play).
- **Biome looks:** in `render/biomes.ts`. Street = procedural barrier / height bar, buses and a construction box as walls, streetlights, traffic lights, signs, parked cars, Quaternius buildings. Park = procedural log / beam, hedge walls, maple and birch trees, flowers.
- **Assets:** `public/assets/quaternius/**`, all CC0, fetched and converted by `scripts/vendor-quaternius.mjs` and listed in `CREDITS.md` (checked by a test). ADR-005 covers them.
- **Skater:** `render/skater.ts` puts the rigged Quaternius Casual_Hoodie on a procedural board. The clip and its time are chosen from sim state, plus crouch/tuck bone rotations; the mixer only writes changed values, so bent bones are restored each frame.
- **Debug bridge additions:** `setSeed`, `advance(seconds)` (manual clock), `getRenderStats()`.

## Latency & frame pacing

- **Timestamps:** `PoseFrame.timing` (capture / callback / bitmap / result / infer) flows into `platform/latency.ts`, together with event-emitted, sim-applied, rendered and next-frame times. Read it at `?latency=1` or `__game.getLatency()`.
- **Filter:** One Euro runs on landmarks in normalized image-height units (x × aspect), tuned by `pnpm latency:gestures GRID=1`.
- **Calibration:** stillness is judged against the mean over the hold window.
- **Render:** `render/interp.ts` extrapolates the last tick's velocity by `alpha`, clamped at the target lane and the ground. `GameSim.previous()` is the pre-tick pose. This removes 120 Hz stepping judder without adding a tick of delay.
- **Tools** (on demand, not in verify): `pnpm latency:gestures | latency:judder | latency:pipeline` write `tmp/latency/*.json`.

## Frame pipeline (target, PLAN §3)

```
camera 720p30 → worker (640x360, PoseLandmarker) → PoseFrame
  → OneEuro → signals → gestures → InputEvent[]
  → GameSim.step(dt, events) @120 Hz fixed → SimState
  → View.render(state, alpha) @60 Hz → DOM HUD
```

## Harness

- Hooks (`.claude/settings.json`, scripts in `.claude/hooks/`): guard human-owned paths (PreToolUse), prettier + `tsc --incremental` on `.ts` edits (PostToolUse), PROGRESS.md reminder (Stop).
- Commands: `/verify`, `/playtest <seed> <input>`, `/milestone-check <M>`. Subagents: `reviewer`, `perf`.
- `pnpm verify` = `tsc --noEmit` → `eslint .` → `vitest run` → `playwright test --project=smoke`.
