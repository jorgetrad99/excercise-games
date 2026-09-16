# Architecture

Agent-maintained module map. The spec lives in `docs/PLAN.md` §3; this file records what exists **now** and how boundaries are enforced. Update it when a module is added or a rule changes.

## Module map

| Path                   | Status (M1)            | Role                                                                                    |
| ---------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `src/core/`            | `prng.ts` (mulberry32) | Pure, deterministic TS: sim, worldgen, scoring, progression. ADR-002.                   |
| `src/input/`           | —                      | `InputSource` impls: pose, keyboard, replay, network. The only layer that sees both pose and core events. |
| `src/pose/`            | M1 pipeline            | Camera manager, worker bridge, One Euro filter, signals, gesture engine. See "Pose pipeline (M1)" below. |
| `src/render/`          | —                      | three.js behind `createRenderer()` (ADR-001), scene, chunk views, pools, DOM HUD.       |
| `src/net/`             | —                      | Colyseus client + room protocol (M6).                                                   |
| `src/platform/`        | `rate.ts` (fps meter)  | Profile store, settings, debug bridge (`window.__game`).                                |
| `src/games/<id>/`      | —                      | One `MiniGame` per folder: sim + view + gesture profile + patterns.                     |
| `src/main.ts`          | hello-world canvas     | Boot; parses URL params, mounts the pose panel for `?input=pose` (default), exposes `window.__game.getState()/getFps()/getPoseStats()`. |
| `src/debug-bridge.d.ts`| `Window.__game` type   | Debug bridge contract shared by app and Playwright tests.                               |
| `public/models/`       | vendored, gitignored   | MediaPipe wasm + `pose_landmarker_{lite,full,heavy}.task` (model v1). Regenerate: `pnpm vendor:models`. |
| `tests/e2e/`           | `boot`, `pose` smoke   | Playwright; `smoke` project = `*.smoke.spec.ts`, new-headless Chromium (real GPU) with the fake camera fed by `tests/e2e/assets/placeholder-person.mjpeg` (interim, see CREDITS.md). |
| `tests/unit/`          | `boundaries.spec.ts`   | Vitest for cross-cutting checks; module tests are colocated `*.spec.ts`.                |

## Dependency rules (enforced)

Enforced by ESLint core rules in `eslint.config.js` (no plugin), and proven by `tests/unit/boundaries.spec.ts`:

```
core     ─✗→ render, pose, input, net, platform, games, three, @mediapipe/*
core     ─✗→ window, document, navigator, performance, requestAnimationFrame, setTimeout, setInterval, localStorage, Math.random
render   ─✗→ pose
pose     ─✗→ core          (only input/ bridges pose ⇄ core events)
games/a  ─✗→ games/b
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
