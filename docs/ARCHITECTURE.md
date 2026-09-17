# Architecture

Agent-maintained module map. The spec lives in `docs/PLAN.md` §3; this file records what exists **now** and how boundaries are enforced. Update it when a module is added or a rule changes.

## Module map

| Path                   | Status (M2)            | Role                                                                                    |
| ---------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `src/core/`            | M3 sim: `sim`, `worldgen`, `patterns`, `collision`, `bot`, `hash`, `prng`, `input`; `boxing/` | Pure, deterministic TS: sim, worldgen, scoring, progression. ADR-002. `boxing/` = Boxing's sim, bot, config (Piece 4). |
| `src/input/`           | keyboard, pose, pose-players, replay | `InputSource` impls: pose, keyboard, replay, network. The only layer that sees both pose and core events. |
| `src/pose/`            | M1 pipeline, M2 gestures | Camera manager, worker bridge, One Euro filter, signals, gesture engine, debug HUD. See "Pose pipeline (M1)" and "Gestures (M2)" below. |
| `src/render/`          | M4 view + HUD; `boxing/` | three.js behind `createRenderer()` (ADR-001), scene, chunk views, pools, DOM HUD. `boxing/` = ring view, boxer figure, boxing HUD. |
| `src/net/`             | —                      | Colyseus client + room protocol (M6).                                                   |
| `src/platform/`        | `rate`, `latency`, `menu`, `profile-store`, `stats-view`, `line-chart`, `gpu` | Profile store (named players' match history), game-select menu + "Who's playing?" + Stats pages (DOM), software-WebGL detection. See "Players & match history". |
| `src/games/`           | `types.ts`, `registry.ts`, `skate-run/`, `boxing/` | `types.ts` = the `MiniGame` contract (PLAN §2.6) + `defineGame()`. `registry.ts` = `GAMES` in menu order (the only importer of game folders). One `MiniGame` per `<id>/` folder, default-exported through `defineGame`; each wraps its `core/` + `render/` modules and owns its gesture→input map and keys. |
| `src/main.ts`          | game-agnostic shell    | Boot: `?game=<id>` launches that MiniGame, otherwise the menu; URL params → sim (`?seed`, `?tokens`), inputs (`?input=pose|keyboard|bot|replay:<fixture>`, keyboard always on), rAF loop (sim.step → view.render → HUD; `?clock=manual` for screenshots), calibration gate for pose/replay, restart on JUMP after game over, `window.__game`. |
| `src/debug-bridge.d.ts`| `Window.__game` type   | Debug bridge contract shared by app and Playwright tests.                               |
| `public/models/`       | vendored, gitignored   | MediaPipe wasm + `pose_landmarker_{lite,full,heavy}.task` (model v1). Regenerate: `pnpm vendor:models`. |
| `tests/e2e/`           | `boot`, `pose`, `gestures`, `render`, `two-players`, `boxing` smoke | Playwright; `smoke` project = `*.smoke.spec.ts`, new-headless Chromium (real GPU) with the fake camera fed by `tests/e2e/assets/placeholder-person.mjpeg` (interim, see CREDITS.md). |
| `tests/unit/`          | `boundaries.spec.ts`   | Vitest for cross-cutting checks; module tests are colocated `*.spec.ts`.                |

## Dependency rules (enforced)

Enforced by ESLint core rules in `eslint.config.js` (no plugin), and proven by `tests/unit/boundaries.spec.ts`:

```
core     ─✗→ render, pose, input, net, platform, games, three, @mediapipe/*
core     ─✗→ window, document, navigator, performance, requestAnimationFrame, setTimeout, setInterval, localStorage, Math.random
render   ─✗→ pose
pose     ─✗→ core          (only input/ bridges pose ⇄ core events)
games/a  ─✗→ games/b     (src/games/*/**, regex: also '../b' folder-index imports; '../types' and layers allowed)
games/types.ts ─✗→ any game   (only games/registry.ts imports game folders)
core/<game>/ may import core/input.ts ('../input'), never the input/ layer
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
PoseFrame ─ body.ts: 11 landmarks (nose, ears, shoulders, elbows, wrists, hips), visibility ≥ 0.5 (hold ≤ 300 ms), One Euro in pixel space → Measures
          ─ calibration.ts: waiting → calibrating (still + neutral 2 s) → calibrated {shoulderX, hipY, noseY, torsoLen, shoulderWidth}
          ─ gestures.ts: SignalFrame {leanX, hipRise, hipRiseVel, headDrop, armsUp, tPose, zone, tracking, calibration, pose}
                         + GestureEvents (lanes, jump/grab, slide, revive hold, T-pose recalibrate, tracking lost/restored)
input/pose-source.ts: GestureEvent → core InputEvent via the game's `gestureProfile.toInput` (Skate Run: REVIVE_ACCEPT→REVIVE, TRACKING_LOST→PAUSE, TRACKING_RESTORED→RESUME)
input/replay.ts: PoseFixture → pose-players (instant: fixture time; realtime: rebased onto performance.now)
input/keyboard.ts: ←/→ lanes, Space jump, ↓ slide (down/up), ↑ grab, C recalibrate
```

- **All tuning** lives in `src/pose/gestures.config.ts`.
- **Denominators are calibrated values, not live ones.** leanX uses the calibrated shoulder width; hipRise/headDrop use the calibrated torso. Live shoulder width collapses when the player turns (0.03 in the real recording), which would fire false lane changes. Calibrate at the play position (T-pose 1 s or `C`).
- **The engine is context-free.** It doesn't know whether a run is active, so REVIVE and GRAB relevance is the sim's call (M3).
- **Tests:** `src/pose/testdata/synthetic.ts` builds keyframed synthetic poses. Every test using it is marked `TEMPORARY(synthetic-fixtures)` until per-gesture recordings exist.

## Local 2-player (Phase 2 Piece 3, PLAN §2.5 / M6a)

```
?players=2 → pose worker numPoses 2
PoseFrame ─ pose/players.ts splitter: torso-center screen x (all 4 torso landmarks visible = a body)
            2 bodies → sorted, screen-left = P1; 1 body → the player it was nearest (last 700 ms),
            switches only past the center ± 0.06; a body that crosses over is forgotten at its old slot
          → [P1 frame, P2 frame] → one pose-source (gesture engine + calibration) per player
input/pose-players.ts: + pause-both: < 2 bodies for > 2 s → PAUSE both; both back → RESUME both
                         (a player's own RESUME is held back while both are paused)
main.ts: Player[] {sim (same seed), queue, signals, hud, overSince, best}; keyboard → P1 only
         fresh run waits until all players calibrated (per run); play-again per player
render: ONE renderer + ONE scene; per player: world + skater updated from that sim, then drawn into
        its scissored half (view.ts useSlot). HUD per half (.player-hud boxes).
```

- **Pauses:** each player's own tracking-loss pause (700 ms) still applies to their run alone.
- **Lane mode:** zones are thirds of the whole frame, so 2P forces `lean` (warns).
- **Latency/judder instrumentation** tracks P1 only in 2P.
- **Tests:** `src/pose/players.spec.ts`, `src/input/pose-players.spec.ts`, `tests/e2e/two-players.smoke.spec.ts`. They use synthetic two-person frames (`scriptTwo`) and `tests/e2e/assets/placeholder-two-people.mjpeg`, all marked `TEMPORARY(synthetic-fixtures)` until `two-players.json` exists.

## Registry typing (Piece 4)

- `MiniGame<S>` members are function-valued properties, so strictFunctionTypes checks their parameters contravariantly and a `MiniGame<SkateSim>` no longer fits a `MiniGame<GameSim>` by accident.
- `defineGame<S>(game)` returns a `RegisteredGame = MiniGame<OpaqueSim>`. `OpaqueSim` is branded, so the shell can't make one: every sim it hands to `render`/`hud`/`summary` came from that game's `createSim`. That's why the one cast inside `defineGame` is sound.
- Bridge: `__game.getState<S>(player?)`. The caller names the shape (`SimState`, `BoxingState`); unchecked at runtime. `advance()` returns `getState().t`, which every `GameSim` state has.

## Boxing (Piece 4; control model inverted in M7.15, PLAN-BOXING §2–§4)

The player's body owns the rig; the sim resolves only collision, damage and the opponent's reaction.

```
pose: body.ts (head/torso One Euro; elbows + wrists UNFILTERED, PLAN-BOXING §2.1) → PoseState per frame
      fists.ts: wrist-speed signal + GUARD_START/END posture (hysteresis). No punch detector.
games/boxing/body-input.ts: PoseState + arm lengths (body scan or defaults) → BODY {head, gloves} in boxer-local m
      (shoulder + wrist/arm × armGainM, head + sway/duck/forward × leanGainM). One per pose frame.
      LANE/SLIDE → DODGE/DUCK and JUMP = play again stay gestures. Keys: Z/X punch, ↑ guard, ←/→ sway, ↓ duck.
core/boxing @ 120 Hz, ONE BoxingState for both boxers (events carry `player`):
      body.ts: BodyTrack per boxer: observed pose samples (+ velocity), or a puppet path for keyboard/bot punches,
               guard and dodges. Stale > staleS → puppet. predictPose(track) = drawn pose, ≤ 50 ms ahead.
      collide.ts: per glove per tick, swept spheres (glove vs defender gloves, head, torso) on OBSERVED samples,
               relative motion; the side that closed most strikes; one outcome per extension → hit / block / whiff.
      sim.ts: damage = clean × min(maxMult, speed / refSpeedMps) (× bodyMult torso, × counterMult);
               dizzy, knockdown, count, TKO, decision; boxer.hits (≤ 4) = where each clean hit touched.
games/boxing/authority.ts: boxingAuthority(state, boxer) → S1–S6 / S11–S13 / BREAK / PUPPET, per-channel owner, and
      which overlays are allowed (O1 hit, O2 stun). Only S4 (the fall) hands channels to the sim.
render/boxing/rig.ts: rig = live body + bounded, time-limited offsets (O1 head snap/stagger, O2 stun follower).
render/boxing: ring + 2 × Casual_Hoodie (arms collapsed, floating gloves); slot i = camera behind boxer i's head.
      Gloves and head drawn at the rig; idle bob only for puppets. HUD: stamina pies, clock, count, result.
```

- **Shared sim in the shell:** `MiniGame.sharedSim`. With it, every `Player.sim` is the same object. `record()` tags each queued event with `player` (BODY is queued but not logged). `eachSim()` steps each distinct sim once with all its players' events (frame loop and `advance`). `restart()` replaces a shared sim for everyone (play again, `setSeed`). `view.render` gets `[sim, sim]`, one entry per player, so slot *i* is drawn from boxer *i*.
- **1P:** the bot is boxer 1 (a puppet that perceives glove closing speed > `bot.seeSpeedMps`). `?input=bot` / `?autoplay=1` also puts it on boxer 0. **2P:** no bot.
- **Calibration hooks:** `MiniGame.canRecalibrate(sim, player)` (ignored while that boxer is down), `needsKnees` (framing hint), `poseInput(pose, player, arms)`.
- **Body scan:** Menu → Body scan (`platform/body-scan-page.ts`, `pose/body-scan.ts`) → `ProfileStore` v2 `players[name].body`. At launch `main.ts` passes it to the gesture engine (`setArms`) and to `poseInput`.
- **Tuning:** `core/boxing/boxing.config.ts` (bodies, gains, impact, rules) and `pose/gestures.config.ts` (`fists` guard, `pose` default bone lengths). UNTUNED on real boxing video.
- **Latency:** `tests/e2e/boxing-latency.smoke.spec.ts` measures camera → drawn glove every verify run (gate `latency-camera-to-glove`).
- **Tests:** `core/boxing/sim.spec.ts` (rules through geometry, determinism, bot), `collide.spec.ts` (BX-CL-*), `games/boxing/authority.spec.ts` (BX-H-*, BX-A-1/3), `body-input.spec.ts` (BX-CL-1/7 end to end), `render/boxing/rig.spec.ts` (BX-A-4/5/6), `pose/body-scan.spec.ts`; e2e `boxing.smoke` (menu, keyboard + bot, 2P shared state, pose replay → collisions, screenshots), `boxing-visual.smoke` (rig follows the body 1:1, head snap by zone), `body-scan.smoke`.

## Pose mirroring (continuous body → rig)

Two paths from the same frame, neither replacing the other: discrete gesture events (`GUARD_*`, `DODGE`, `DUCK`, …), and a continuous `PoseState` every frame. Boxing turns the latter into `BODY` events the sim collides; other games bind bones to it.

```
gesture engine push(frame) ─ body.ts (One Euro) + calibration ─┬→ SignalFrame {…, pose: PoseState | null} ─→ input/ → main.ts
                                                               └→ GestureEvents (unchanged)
main.ts frame loop: view.render(sims, interpolate, poses)   poses[i] = player i's PoseState, or null when
                    keyboard/bot, not calibrated, tracking lost, or older than trackingLostMs (frozen feed)
```

**Contract** (`src/pose/pose-state.ts`, re-exported from `src/games/types.ts` as `PoseState`, `ArmState`, `Vec3`, `Quat`):

- **Axes (character frame):** +x = the player's anatomical left, +y = up, +z = forward (toward the camera / opponent). Same frame as the boxer rig (faces +z, its left is +x). `arms[0]` is always the anatomical left arm.
- **Units:** lengths in calibrated torso lengths (shoulder center to hip center); angles in radians; `Quat` = `[x, y, z, w]` (three.js `Quaternion.fromArray`).
- **Neutral:** torso/hips/head angles and `body` offsets are deltas from the calibrated stance; arm rotations are swings from an arm hanging straight down `(0, −1, 0)`.

```ts
interface PoseState {
  t: number;                                  // frame time (performance.now clock)
  body: { sway; duck; rise; forward };        // + = player's left / down / up / closer (fraction of distance)
  torso: { yaw; pitch; roll; rot: Quat };     // Euler 'YXZ': yaw + = turned left, pitch + = bent forward (≥ 0), roll + = left shoulder up
  hips: { roll; rot: Quat };
  head: { yaw; roll; rot: Quat };             // relative to the camera, not the chest; 0 without ears
  arms: [ArmState | null, ArmState | null];   // [left, right]; null = elbow or wrist not tracked
}
interface ArmState {
  upper: Vec3; fore: Vec3;                    // unit bone directions shoulder→elbow, elbow→wrist
  upperRot: Quat; foreRot: Quat;              // swing from (0,-1,0) to upper / fore, no twist
  wrist: Vec3;                                // shoulder→wrist in torso lengths: IK target (× rig torso length, m)
  extension: number;                          // 0 folded … 1 straight (hanging arms read 1)
  reach: number;                              // 0 … 1 forward reach: live punch progress
  speed: number;                              // torso/s, = SignalFrame.fistL/fistR
}
```

**Binding recipe (three.js, renderer side):** for a limb bone with rest direction `restDir` in its parent's space, `bone.quaternion.setFromUnitVectors(restDir, dirInParentSpace)`, where `dirInParentSpace = arm.upper` transformed by the inverse world rotation of the parent (character root with torso `rot` applied). Or two-bone IK with `wrist` as target and the elbow direction as pole. Torso/hips/head: multiply the rig's neutral quaternion by `rot`. Pose frames arrive at ~20–30 Hz; the renderer should smooth or interpolate on `t`.

**How depth is derived:** MediaPipe's per-landmark z is unusable for bone geometry. On Jorge's real recording, a 3D upper arm measured 1.59 torso lengths at p90 against 0.56 in 2D. Depth comes from bone length instead (`gestureConfig.pose.upperArm/forearm`): a bone whose 2D projection is shorter than its length points at the camera by the difference. The arm sign is always forward.

- **Distance scale:** max(torso ratio, shoulder ratio) against calibration. Bending shrinks only the torso, and turning shrinks only the shoulders.
- **Torso yaw:** the shoulder foreshortening, weighted by how far the nose left the shoulder center. On the real recording, shoulders alone read ±1 rad while facing the camera.

**World landmarks:** the worker now also sends `PoseFrame.world` (MediaPipe metric 3D) and `?record=1` saves it. Nothing consumes it yet.

**Tests:**

- `pose-state.spec.ts`:
  - quaternion helpers against three.js
  - a real excerpt of Jorge's recording (`testdata/real-skate-2-10s.json`): calibration, hanging arms down/straight/no reach with the left arm on +x, forearms up at GRAB, sway sign on LANE_LEFT, small yaw while facing
  - hand-built guard/punch arm geometry
- e2e `boxing.smoke` replay: `getSignals().pose` present.

- Reads `fixtures/pose/boxing/*.json` with exact expected counts per drill.
- Checks handedness from a raised-left-hand marker at the start of each file.
- Reports counts and pose-state channels at each punch.
- `GRID=1` sweeps `fists` (including `reference: 'nose' | 'shoulder'`).

## Boxing visual expressiveness (render only)

- `render/boxing/presentation.ts` observes each boxer's `hits` list (where each clean hit touched: zone and time). It owns bounded left/right/chin bruises, hit age, zero-stamina fall timing and count recovery. Repeated split-screen draws are idempotent; a new sim or rewind resets damage. Blocks and regeneration do not create/heal bruises. Core scoring and phases are unchanged: zero stamina starts the visual fall, the next clean hit still starts the official count.
- `render/boxing/animation.ts` samples the existing CC0 Casual_Hoodie Death clip over the fall, holds the floor pose, and blends through a crouch during the final part of a recoverable count. KO/TKO stays down; a decision loser stays standing. Head snap uses a locally vendored UAL `Hit_Head` quaternion track, with a directional stagger. Animation clocks pause with the match.
- `render/big-head.ts` hides the complete `Casual_Head` mesh group. A rounded replacement is 2.6 times the proportional radius, follows the Head bone position AND orientation, and carries a private copy of the existing `FaceFeed` crop. `render/boxing/face-damage.ts` composites redness, bruises and swelling highlights on that copy. No camera capture, inference or pose-layer dependency is added. With no camera, a procedural face provides the same large-head silhouette and damage feedback.
- `render/boxing/visual.config.ts` holds visual tuning. `public/assets/quaternius/boxing/hit-head.json` is baked by `scripts/vendor-boxing-reaction.mjs` from Quaternius UAL Standard's `Hit_Head`; provenance and the unchanged CC0 license are in CREDITS.
- Tests: `presentation.spec.ts`, `rig.spec.ts`, and `tests/e2e/boxing-visual.smoke.spec.ts`. The browser harness loads the shipping GLB and renderer, steps the real boxing sim, and inspects head transforms and texture pixels. Screenshots and fake-camera performance samples are under `tmp/visual-expressiveness/`.

### Live pose in Boxing

Replaced in M7.15 (`render/boxing/live-pose.ts` deleted). The player's body no longer adds clamped expression on top of a sim-placed boxer: it IS the boxer (see Boxing above, and PLAN-BOXING §2.1 / §4). The only render-side additions are the authorized overlays in `render/boxing/rig.ts`, each bounded in size and time (`BOUNDS`), plus live torso/hips/head turns from `PoseState`.

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

## Players & match history

- **Identity is a name, bound to a screen side for one session.** Menu → game → "Who's playing?": one slot per player (1P "Player", 2P "Left player" P1 / "Right player" P2). Each slot's name buttons only answer to that side's hand cursor (the same screen-half split as 2P games); mouse and keyboard work everywhere, and new names are typed. 1P preselects the last P1; 2P always claims explicitly (people swap sides). `?game=` links skip the screen: names come from `?names=A,B`, else the last session, else "Player N".
- **`MiniGame.matchStats(sim, player)`** → `{ result: win|loss|draw|null, stats: { camelCaseKey: number } }`. The shell records it once per player when `summary().over` first turns true (not for `?input=bot`), with the opponent's name (2P), "CPU" (1P shared sim) or null.
- **`platform/profile-store.ts`**: `localStorage['move-arcade.profile']`, `{ version: 1, players: { [name]: { matches[] } }, lastNames }`. `migrate()` upgrades older shapes; data from a newer version makes the store read-only; corrupt JSON is copied to `move-arcade.profile.corrupt-<ms>` before starting fresh. 1000 matches per player.
- **Stats page** (`stats-view.ts`): player × game → W–L–D and win rate, last-20 result chips (letter + colour), one hand-drawn canvas line chart per stat key (`line-chart.ts`, no dependency), and the latest 10 matches as a table.
- Boxing HUD labels show the names (`HudExtras.names`).

## Frame pipeline (target, PLAN §3)

```
camera 720p30 → worker (640x360, PoseLandmarker) → PoseFrame
  → OneEuro → signals → gestures → InputEvent[]
  → GameSim.step(dt, events) @120 Hz fixed → SimState
  → View.render(state, alpha) @60 Hz → DOM HUD
```

## Harness

- Hooks (`.claude/settings.json`, scripts in `.claude/hooks/`): guard human-owned paths, resolved against the checkout that contains the file (PreToolUse); prettier + `tsc --incremental` on `.ts` edits, waiting for the perf lock (PostToolUse); PROGRESS.md reminder (Stop).
- Commands: `/verify`, `/playtest <seed> <input>`, `/milestone-check <M>`. Subagents: `reviewer`, `perf`.
- `pnpm verify` = `tsc --noEmit` → `eslint .` → `vitest run` → `playwright test --project=smoke --project=perf` (`@perf` gates and `@realtime` replays after smoke, one worker).
- **Perf lock** (`scripts/e2e-lock.mjs`, lockfile in the git common dir, shared by every worktree): the Playwright run and `scripts/perf-probe.mjs` hold it; typecheck, lint, vitest and the tsc hook wait for it. Every perf gate logs its GPU and the machine state it observed to `tmp/verify/gates.jsonl` (`tests/e2e/gates.ts`, `machine-state.ts`). AGENTS §4.
- Perf diagnosis (not in verify): `node scripts/perf-probe.mjs [--only …] [--angle d3d11-warp] [--no-draw]` → `tmp/perf/probe-<label>.json`; works against older commits' dev servers (`--base`).
