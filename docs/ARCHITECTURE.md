# Architecture

Agent-maintained module map. The spec lives in `docs/PLAN.md` §3; this file records what exists **now** and how boundaries are enforced. Update it when a module is added or a rule changes.

## Module map

| Path                   | Status (M0)            | Role                                                                                    |
| ---------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `src/core/`            | `prng.ts` (mulberry32) | Pure, deterministic TS: sim, worldgen, scoring, progression. ADR-002.                   |
| `src/input/`           | —                      | `InputSource` impls: pose, keyboard, replay, network. The only layer that sees both pose and core events. |
| `src/pose/`            | —                      | Camera manager, worker bridge, One Euro filter, signals, gesture engine.                |
| `src/render/`          | —                      | three.js behind `createRenderer()` (ADR-001), scene, chunk views, pools, DOM HUD.       |
| `src/net/`             | —                      | Colyseus client + room protocol (M6).                                                   |
| `src/platform/`        | —                      | Profile store, settings, debug bridge (`window.__game`).                                |
| `src/games/<id>/`      | —                      | One `MiniGame` per folder: sim + view + gesture profile + patterns.                     |
| `src/main.ts`          | hello-world canvas     | Boot; M0 exposes `window.__game.getState()/getFps()`.                                    |
| `src/debug-bridge.d.ts`| `Window.__game` type   | Debug bridge contract shared by app and Playwright tests.                               |
| `public/models/`       | vendored, gitignored   | MediaPipe wasm + `pose_landmarker_full.task` (model v1). Regenerate: `pnpm vendor:models`. |
| `tests/e2e/`           | `boot.smoke.spec.ts`   | Playwright; `smoke` project = `*.smoke.spec.ts`, Chromium with fake-camera flags.       |
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
