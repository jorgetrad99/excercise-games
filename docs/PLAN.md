# Move Arcade — Research & Build Plan

**Codename:** `move-arcade` (platform) · first game: **Skate Run** (endless skateboard runner)
**Owner:** Jorge · **Date:** 2026-09-16 · **Status:** v1 — ready for agent kickoff
**Amended 2026-09-16:** Skate Run step propulsion: legs drive speed, chaser, Skyhook power-up, motion modes (§0, §1.5, §2.1–§2.9, §3, §4 M8, §6). Decisions D1–D4 approved by Jorge.
**Target:** Browser (Chrome/Edge first), Full HD USB webcam, laptop with RTX 4060, external 1080p60 display.

This document is the single source of truth for scope, architecture, and the milestone plan. It is written to be executed by an AI coding agent (Claude Code) under the rules in `/AGENTS.md`. Read both before writing code.

---

## 0. TL;DR

- **What:** A Subway-Surfers-style endless runner on a skateboard, controlled by the player's body via webcam (step in place = push/speed, lean = lane, jump = jump, crouch = slide), running entirely in the browser. Infinite procedurally generated world, coins, score multiplier, missions, revive tokens, persistent meta-progression. Local 2-player on one camera and remote multiplayer via a small self-hosted server. Built so more mini-games (soccer, ping-pong) can be added on the same foundation.
- **Stack:** Vite + TypeScript (strict) · MediaPipe Pose Landmarker (`@mediapipe/tasks-vision`) · three.js (r18x) · Vitest + Playwright · Colyseus (Node, MIT) for remote multiplayer · CC0 assets (Kenney, Quaternius, KayKit).
- **Key architectural decision:** the game simulation is a **pure, deterministic TypeScript module** with zero DOM/three.js imports. Inputs are abstracted (`InputSource`: pose, keyboard, replay fixture, network). This single decision makes the game testable by an agent without a human in front of a camera, and makes multiplayer a "shared seed + ghost sync" problem instead of a netcode problem.
- **Out of scope for v1:** menus/UI polish, audio, mobile browsers, accounts/auth, monetization.

---

## 1. Research summary

### 1.1 Body tracking in the browser

**Choice: MediaPipe Pose Landmarker** (`@mediapipe/tasks-vision`, Google AI Edge). Actively maintained (docs updated Aug 2026). Outputs 33 landmarks per person in normalized image coordinates *and* metric world coordinates, plus per-landmark visibility. Runs on WASM with a GPU delegate in the browser.

Why not alternatives:
- TensorFlow.js MoveNet: faster on weak hardware, but 17 keypoints (no hands/feet detail), single-person "Lightning"/multi "MultiPose" variants, and TF.js pose-detection is in maintenance mode. MediaPipe is the better bet for a project that wants soccer (feet) and ping-pong (wrists) later.
- OpenPose/RTMPose via ONNX Runtime Web: more accurate but heavy, no first-party web pipeline. Not worth it for v1.

Facts that shape the design:
- **Model variants:** `lite` (~5.5 MB, fastest), `full` (~9 MB, balanced — default), `heavy` (~29 MB, most accurate, slow). Start with `full`; expose a setting.
- **Multi-person:** `numPoses` option (default 1) allows several people in one frame. Cost scales roughly linearly. **Known limitation:** when two people get close (reported at roughly 75 cm apart at 3.5 m from the camera) one detection can drop. The result array does **not** guarantee stable identity across frames — assign players by screen zone, not by array index.
- **Input resolution:** the model internally works on a small square crop (256×256 for the landmark model). Feeding 1080p gives no accuracy benefit and costs upload/copy time. Request 1280×720@30 from the camera; downscale to ~640×360 before inference. Keep 720p for the preview.
- **Threading:** Google's official `mediapipe-samples-web` runs vision tasks in a **Web Worker** with `OffscreenCanvas`. Do the same so inference never blocks the render loop.
- **Latency budget:** with the GPU delegate on an RTX 4060, `full` inference is well under 16 ms. Target: pose at 30 fps, render at 60 fps, interpolate.
- **Depth is estimated, not measured.** Forward/backward motion (z) is the weakest axis. All v1 gestures use x/y only, normalized by torso size (so distance to camera doesn't matter).

### 1.2 Rendering

**Choice: three.js**, latest stable (r184 as of April 2026; use whatever `npm view three version` says at kickoff, pinned). WebGPU is now baseline in all major browsers and three's `WebGPURenderer` falls back to WebGL2 automatically.

Decision for v1: **use `WebGLRenderer`** behind a `createRenderer()` factory. Reason: the agent will be writing a lot of three.js from training data, and the WebGL path has ten years of examples and zero TSL/node-material surprises. A runner with standard materials gains little from WebGPU. Switching to `WebGPURenderer` later is a one-file change if the factory is respected. (Document this as ADR-001.)

Why not Babylon.js / PlayCanvas / Phaser: Babylon is fine but heavier and less familiar; PlayCanvas pushes you into its editor; Phaser is 2D. Three + hand-rolled game loop is the right size for this.

Physics: **none in v1.** A lane runner is kinematic (lanes, jump arc, AABB/capsule collisions). Add Rapier (`@dimforge/rapier3d-compat`, WASM) only when a mini-game needs it (soccer ball).

### 1.3 Assets (all CC0 unless noted — no attribution required, commercial use OK)

- **Kenney** (kenney.nl) — City Kit (Roads), City Kit (Suburban), Retro Urban Kit, Modular Buildings, Car Kit, Mini Characters (rigged). Consistent low-poly style; glTF downloads.
- **KayKit** (Kay Lousberg, itch.io) — City Builder Bits; Character Pack: Adventurers (rigged + animated).
- **Quaternius** — Universal Base Characters + Universal Animation Library (120+ retargetable animations). Best route for a rigged skater with run/jump/crouch animations.
- **Poly Haven** — HDRIs for lighting/environment (CC0). AmbientCG — PBR textures (CC0).
- **Poly Pizza** (archived Google Poly + community) — mostly **CC-BY**, track attribution in `CREDITS.md`. Good for a skateboard model if Kenney/Quaternius don't have one.
- **Skateboard for M1–M4:** procedural (box + 4 cylinders). Swap for a real model later. Don't block gameplay on art.
- **Pipeline:** everything as `.glb`; run through `gltf-transform` (`optimize`, Draco or Meshopt) at build time; coins/obstacles/rails as `InstancedMesh`.

### 1.4 Multiplayer

**Choice: Colyseus** (Node.js, MIT, self-hostable, room-based, built-in reconnection). Docs are LLM-friendly (`docs.colyseus.io/llms.txt`). Alternatives considered: PartyKit (Cloudflare-centric), Playroom (zero backend but hosted), raw `ws` (fine but you'd rebuild rooms/matchmaking). Colyseus fits a self-hosted Hetzner/Coolify setup.

The critical insight: **an endless runner doesn't need an authoritative physics server.** Both clients run the same deterministic sim from the same seed; the server only brokers the room, distributes the seed, and relays compact per-player state (lane, y, distance, score, alive, timestamp) at 10–20 Hz. The other player renders as a ghost with interpolation. Cheating isn't a concern for a friends game. This makes remote MP maybe 300 lines instead of a netcode project.

Never send video. Never send raw landmarks either (unnecessary); send derived game state. If a "see your friend's skeleton" feature is ever wanted, landmarks are ~500 B/frame — still trivial.

Local 2-player: one camera, `numPoses: 2`, split screen, players assigned to left/right halves of the frame.

### 1.5 Retention mechanics (what makes Subway Surfers sticky, adapted)

| Mechanic | Why it works | v1 implementation |
|---|---|---|
| Score = distance × multiplier | Simple, readable, always going up | Multiplier starts at 1, permanent upgrades via missions (cap 10× in v1) |
| Coins | Visible short-term reward every second | Coin rows/arcs in the world; persisted total |
| Power-ups | Variety + "one more run" | Magnet (10 s), 2× coins (10 s), Hoverboard/"Spare Board" (10 s invulnerability); **Skyhook** (§2.8): guaranteed, earned by steps, the run's rest segment |
| Chaser | Pressure to keep moving without a fail state for slowing down | **The Sweeper** (§2.7): only appears after a near-stop, with a visible warning, and can be escaped |
| Revive tokens | Answers Jorge's "checkpoint" wish without breaking the runner loop | Crash → offer "Revive?" if token ≥ 1 (3 s decision window, gesture: raise both arms). Max 2 revives/run |
| Distance milestones | Progress that survives death | Every 500 m unlocks a permanent thing (board skin, biome, mission tier). Stored in profile |
| Missions (3 active) | Directs play, raises multiplier | e.g. "Jump 20 times", "Collect 300 coins in one run", "Reach 1 km" |
| Near-miss / trick bonus | Skill expression, skateboard flavor | Jump over an obstacle within 0.3 s of contact = "Close call" +50; arms up in air = "Grab" ×2 airtime score |
| Difficulty ramp | Flow; runs last 1–3 min | Speed ceiling +2%/100 m, obstacle density curve, biome change every ~1 km |
| Physical fatigue awareness | Unique to body games; the legs drive speed | Top speed is reached at a jog, so sprinting earns nothing; a Skyhook rest about once a minute; runs target 2–3 min; the results card is the rest between runs; session target 15–20 min (5–7 runs). Unvalidated: confirm by playtest. Tracking-quality coach ("step back", "more light") |

Persist in `localStorage` (v1) behind a `ProfileStore` interface; move to server later.

### 1.6 Agent harness (why this plan looks the way it does)

Two things make a webcam game hostile to an AI agent: it can't stand in front of a camera, and it can't see a 3D scene. The plan removes both problems:
1. **Deterministic core + replayable inputs.** Recorded landmark fixtures (`fixtures/pose/*.json`) drive the gesture engine in tests. Seeded world gen makes runs reproducible.
2. **Fake camera in CI.** Chromium can be launched with a video file as the webcam (`--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<file.y4m|.mjpeg>`). Playwright e2e tests use a short recorded clip of Jorge leaning/jumping. The agent gets real end-to-end verification.
3. **Agent-legible runtime.** `?debug=1&input=keyboard&seed=42` and `window.__game.getState()` let Playwright assert on game state and take screenshots.
4. **LSP over grep.** Claude Code has official LSP plugins (`typescript-lsp`), enabling `goToDefinition`, `findReferences`, `workspaceSymbol`, diagnostics. Rules in `AGENTS.md`.

---

## 2. Product spec (v1)

### 2.1 Player loop
1. Grant camera → pick device (dropdown lists all `videoinput` devices; last choice remembered) → preview with skeleton overlay and a tracking-quality indicator.
2. Calibrate: stand neutral for 2 s (captures shoulder-center x, hip y, nose y, torso length, and knee height left/right when both knees are visible). Progress ring. Recalibrate anytime with a gesture (T-pose 1 s) or key `C`. If the knees aren't visible, the screen says "Step back so your knees are visible" and the run uses `motion=auto` (§2.9).
3. Countdown 3-2-1 → run. Step in place to push (step rate = speed), lean left/right to change lane, jump to jump, crouch to slide, arms up mid-air for a grab.
4. Crash → revive offer (if tokens) → results card (distance, coins, best, missions progress) → "Play again" gesture (jump) or key.

### 2.2 Gestures (v1 spec — implement exactly, tune constants in `gestures.config.ts`)

All positions are normalized image coordinates from MediaPipe, smoothed with a **One Euro filter** per landmark (`minCutoff=1.0, beta=0.007` starting values). Landmarks with `visibility < 0.5` are ignored (hold last value ≤ 300 ms, then mark "lost").

Derived signals (computed every pose frame):
- `shoulderCenter = (L_SHOULDER + R_SHOULDER)/2`, `hipCenter = (L_HIP + R_HIP)/2`
- `torsoLen = |shoulderCenter - hipCenter|` (scale reference; makes everything distance-invariant)
- `shoulderWidth = |L_SHOULDER - R_SHOULDER|`
- `leanX = (shoulderCenter.x - calib.shoulderCenter.x) / shoulderWidth` (mirrored so screen-left = lane-left)
- `hipRise = (calib.hipCenter.y - hipCenter.y) / torsoLen` (positive = up)
- `headDrop = (NOSE.y - calib.nose.y) / torsoLen` (positive = down)
- `kneeLift[L|R] = (calib.kneeY[L|R] - KNEE.y) / torsoLen` (positive = up; MediaPipe landmarks 25/26)
- `armsUp = both WRIST.y < NOSE.y`

Events (edge-triggered, with hysteresis and cooldowns):
- **LANE_LEFT / LANE_RIGHT:** `leanX < -0.35` / `> 0.35` enters; must return inside ±0.20 before another lane event in the same direction. Also support a "3 zones" mode (absolute position) as an alternative — expose in config; playtest both. Thresholds stay unchanged unless the stepping recordings (`skate-jog-lanes`) show false lane events.
- **STEP {leg}:** one knee has `kneeLift > march.enter` while the other stays `< march.planted`; that leg re-arms when `kneeLift < march.rearm`; per-leg refractory period. Unavailable while knees are untracked. The detector lives in the shared `src/pose/march.ts`, which Boxing also uses for MARCH_STEP (PLAN-BOXING §6.3).
- **JUMP:** `hipRise > 0.15` with `hipRise` velocity `> 1.2 /s`; cooldown 500 ms. (Velocity gate prevents slow stretching from triggering.) When knees are tracked, both knees must also rise: `min(kneeLift) > jump.bothKnees · hipRise`. A one-leg lift is never a JUMP; a both-knees lift is never a STEP.
- **SLIDE:** `headDrop > 0.25` for ≥ 100 ms; ends when `headDrop < 0.12`. Cooldown 400 ms. Thresholds stay unchanged unless the stepping recordings (`skate-jog-slides`) show false slides.
- **GRAB:** `armsUp` while airborne.
- **REVIVE_ACCEPT / RECALIBRATE:** `armsUp` held 1 s while not in a run / T-pose (wrists at shoulder height, arms extended) 1 s.
- **TRACKING_LOST:** no pose for 700 ms → game pauses with "Step back into frame" overlay; auto-resume with a 1 s countdown when tracking returns.

Keyboard fallback maps 1:1 (`←/→`, `Space`, `↓`, `↑` = grab, `S` = step; holding `S` auto-repeats and gives full speed). This is not a nice-to-have; it is the agent's primary way to play-test.

### 2.3 World generation (infinite, seeded)

- The player never moves in world space; **the world moves toward the camera** (avoids float precision drift and simplifies pooling). Track "distance travelled" as a number.
- World = queue of **chunks** (length 24 m each, 3 lanes at x ∈ {-2, 0, 2}). Keep ~8 chunks ahead, recycle chunks that pass behind the camera. All chunk content comes from pools (`InstancedMesh` for coins/small obstacles; pooled `Group`s for big props).
- Chunk content is chosen by a **seeded PRNG** (`mulberry32(seed + chunkIndex)`) from a **pattern library**: hand-authored JSON patterns (obstacle layout + coin layout) tagged with difficulty 1–5 and biome. Generation picks patterns whose difficulty ≤ current difficulty, weighted toward the top. Patterns guarantee solvability (at least one lane is passable by run/jump/slide; no two consecutive "must-jump" patterns within 1.5 s of travel).
- **Biomes** (street → park → boardwalk → industrial) rotate every ~1 km; each defines a palette, prop set, and skybox. v1 ships 2 biomes; the third is a milestone unlock.
- **Speed (step propulsion).** Distance sets the ceiling; the player's steps set how close to it they get:
  - Ceiling `C(d) = min(26, 12 + 0.02·d)` m/s. Worldgen's forced-row gap and the solvability validator keep using `C(d)`, so both stay valid for any speed ≤ C.
  - Floor `F = 4` m/s. A jump clears a hurdle only above 2.45 m/s (0.449 s above 0.9 m against 1.1 m to clear), so F keeps a 1.6× margin. The solvability validator also runs at F.
  - Cadence estimate, kept in the sim from STEP events: each STEP adds `1/τ`; every tick it decays by `cadence·dt/τ`; τ = 1.0 s (untuned). Steady stepping at c steps/s settles at c.
  - `target = F + (C − F) · min(1, cadence / 2.6)` (untuned; 2.6 steps/s ≈ a jog).
  - Speed eases toward the target at ≤ +6 m/s² and ≥ −3 m/s², so slowing down reads as coasting (untuned).
  - At C = 26: 0 steps/s → 4 m/s, 1.0 → 12.5, 2.0 (march) → 20.9, ≥ 2.6 (jog) → 26.
  - **Rhythm (D1):** speed is the only consequence of stepping. An uneven or missed rhythm costs nothing beyond speed.
- Pattern difficulty ceiling rises every 300 m.
- Determinism contract: `(seed, inputEvents[]) → identical run`. There is a test for this.

### 2.4 Scoring & progression
- `score += speed·dt·multiplier`; coins `+1` each (`×2` under power-up); grab `+airtime·100`; close call `+50`.
- Profile (persisted): `coinsTotal, bestScore, bestDistance, multiplierLevel, reviveTokens, unlocks[], missions{active[], completed[]}, settings{cameraId, model, laneMode, motion}`.
- Earning revive tokens: 1 per 3 missions completed; also a rare world pickup.

### 2.5 Multiplayer
- **Local (v1.1):** `numPoses: 2`, split screen (two viewports, two cameras in the same scene, two sims sharing one seed). Player assignment: left half of the mirrored frame = P1. If only one pose is visible for > 2 s, pause both.
- **Remote (v1.2):** Colyseus room (`skate-run`, max 4). Host creates → shareable 4-letter code → everyone gets the same seed → 3-2-1 sync start using server time. Each client sends `{lane, y, dist, score, alive, t}` at 15 Hz; ghosts interpolated. Race ends when all crash; leaderboard shown.
- **Chaser in 2P (D2):** each player's independent sim has its own chaser, which only pursues that player when they are slow. Remote multiplayer sends nothing new: the chaser is local sim state.

### 2.6 Mini-game framework (design now, build with game #2)
```ts
interface MiniGame {
  id: string;
  requiredSignals: SignalId[];          // e.g. ['leanX','hipRise'] or ['leftAnkleVel','rightAnkleVel']
  createSim(seed: number): GameSim;      // pure, deterministic
  createView(sim: GameSim, ctx: RenderContext): GameView; // three.js side
  gestureProfile: GestureProfile;        // which events to derive from signals
}
```
Shared: camera manager, pose worker, signal/gesture engine, profile store, net layer, debug HUD. Game-specific: sim, view, gesture profile, patterns/assets. Soccer (penalty shootout: ankle velocity = power, ankle x = direction) and ping-pong (wrist x/y + swing velocity) fit this without changing the shared layers.

**Gesture scoping:** `MiniGame.activeGestures(state, player): DetectorSet` (PLAN-BOXING §8), built once and shared by every game. The gesture engine runs only the detectors in that set. Skate Run:

| Phase | Active detectors |
|---|---|
| running | lanes, jump, slide, grab, march, tracking |
| swinging (Skyhook) | lanes, tracking |
| countdown / paused | tracking, recalibrate |
| crashed | revive hold, tracking |
| over | jump (play again), tracking |

### 2.7 Chaser: the Sweeper

- **Identity:** a municipal street-sweeper machine with spinning brushes and an amber beacon. Procedural (merged primitives), no skinned mesh, no human uniform, badge or dog.
- **Slow:** `speed < V_slow = F + 0.35·(C − F)`, which is under about 0.9 steps/s at steady state (untuned).
- **States:**
  - `calm → warning` after 2 s of being slow. No chaser in the first 20 s of a run, or while `grace > 0`.
  - `warning` (3 s): the HUD shows a rear gap gauge and an amber pulse at the screen edge. Getting back above `V_slow` returns to `calm`.
  - `chasing`: the Sweeper spawns 16 m behind. `gap' = max(speed − V_slow, −3 m/s)`: it closes at most 3 m/s and opens as fast as the player out-runs `V_slow`. At a gap ≥ 30 m it leaves and the state returns to `calm`. The escape window is ≥ 5.3 s even from a full stop.
  - Gap ≤ 0 → **caught = CRASH** through the existing crash path; revive tokens apply.
- **Camera:** while `chasing`, the follow camera eases back from 4.2 m to 7.5 m behind the skater so the final approach is on screen. The chaser isn't drawn while it is off screen.
- **Skyhook (D3):** starting a swing resets the chaser to `calm` (it leaves) and clears the slow timer. The player is unreachable while swinging and lands with grace.
- All chaser state lives in the sim and is covered by the determinism test.

### 2.8 Power-up: Skyhook

- **Identity:** a grapple line: safety-orange climbing rope, steel carabiner, fired from a wrist reel. Anchors are crane hooks (street) and marked branches (park). Pickup icon: a carabiner. No web patterns, no red/blue, no masks or insect motifs, no "web" in any name.
- **Earned and guaranteed:** every 80 STEPs (untuned), the next generated chunk (about 192 m ahead) is a `SKYHOOK_GATE` pattern: no obstacles and a pickup in all 3 lanes, so it can't be missed.
- **Why steps, not distance:** rest scales with the work the body did. Distance-based spawns would give the least rest to tired, slow players. Expected rhythm at a march: about 40 s of stepping plus about 9 s to reach the gate, then a 10 s swing.
- **Swing:** automatic, with no arm or leg input. 10 s at `1.15 · max(speed, C)`. The path arcs between anchors spaced one per chunk (a pure function of the chunk index). Collisions are off. Leaning still changes lanes, to collect overhead coin rows (a pure function of seed and chunk index, rendered and collected only while swinging). The last 1.5 s are a descent; the player lands at speed C with 2 s of grace.

### 2.9 Motion modes (D4)

- `?motion=step|auto`, persisted in the profile's `settings.motion`.
- **step** (default when knees are tracked at calibration): speed per §2.3, chaser on.
- **auto** (fallback when knees aren't tracked, and the accessibility option): speed = `C(d)` as before; no chaser; Skyhook earned every 40 s of running instead of every 80 steps. Match history records the mode.
- The existing determinism, bot and screenshot tests pin `motion=auto` and keep their baselines. Step mode gets its own tests and baselines.

---

## 3. Architecture

```
move-arcade/
├─ AGENTS.md                # agent rules (harness). CLAUDE.md imports it.
├─ CLAUDE.md
├─ docs/
│  ├─ PLAN.md               # this file
│  ├─ ARCHITECTURE.md       # module map + dependency rules (agent-maintained)
│  ├─ DECISIONS/ADR-*.md    # one file per decision
│  ├─ PROGRESS.md           # append-only session log (agent-maintained)
│  └─ features.json         # milestone task list with status (agent-maintained)
├─ .claude/                 # hooks, settings, slash commands, subagents
├─ fixtures/
│  ├─ pose/*.json           # recorded landmark sequences (never edited by agent)
│  └─ video/*.y4m|.mjpeg    # short clips for Playwright fake camera
├─ public/models/           # vendored pose_landmarker_full.task + wasm (no runtime CDN dependency)
├─ assets/                  # source .glb; build step optimizes into public/assets
├─ src/
│  ├─ core/                 # PURE TS. No DOM, no three. Sim, worldgen, scoring, progression rules.
│  ├─ input/                # InputSource impls: pose, keyboard, replay, network
│  ├─ pose/                 # camera manager, worker bridge, signals, gesture engine, filters
│  ├─ render/               # three.js: renderer factory, scene, chunk view, pools, HUD (DOM overlay)
│  ├─ net/                  # colyseus client, room protocol
│  ├─ platform/             # profile store, settings, debug bridge (window.__game)
│  ├─ games/skate-run/      # MiniGame impl: sim + view + gesture profile + patterns
│  └─ main.ts
├─ server/                  # Colyseus (added at M6)
└─ tests/  e2e/ (Playwright)   unit/ (Vitest, colocated also allowed)
```

**Dependency rules (enforced by ESLint `boundaries` or `dependency-cruiser`; CI fails on violation):**
- `core` imports nothing from `render`, `pose`, `input`, `net`, `platform`, or `three`/DOM.
- `games/*` may import `core`, `render`, `pose` types — never each other.
- `render` never imports `pose` (it gets state from `core`).
- Only `input/` knows about both `pose` and `core` events.

**Frame pipeline:**
```
camera (720p30) ─► worker: downscale 640x360 ─► PoseLandmarker.detectForVideo ─► landmarks
   ─► main: OneEuro smoothing ─► signals ─► gesture engine ─► InputEvent[]
   ─► GameSim.step(dt, events)  (fixed 120 Hz accumulator)  ─► state snapshot
   ─► View.render(state, alpha)  (60 Hz, interpolated)      ─► HUD (DOM)
```

**Key interfaces (write these first; they are the contract):**
```ts
type InputEvent = { t: number; type: 'LANE_LEFT'|'LANE_RIGHT'|'JUMP'|'SLIDE_START'|'SLIDE_END'|'GRAB'|'STEP'|'REVIVE'|'RECALIBRATE'|'PAUSE'; leg?: 'L'|'R' };  // leg: STEP only
interface InputSource { start(): void; stop(): void; onEvent(cb: (e: InputEvent) => void): () => void; }
interface GameSim { step(dt: number, events: InputEvent[]): void; getState(): Readonly<SimState>; seed: number; }
interface SimState { t; distance; speed; lane; targetLane; y; vy; sliding; alive; score; coins; multiplier; powerups; chunks: ChunkState[]; lastEvent?: ... }
interface PoseFrame { t: number; poses: Landmark[][] }   // Landmark = {x,y,z,visibility}
interface SignalFrame { t; leanX; hipRise; headDrop; kneeLift; armsUp; tracking: 'ok'|'lost' }
```

**Debug bridge (mandatory from M1):** `window.__game = { getState(), getSignals(), getFps(), inject(event), setSeed(n) }`; query params `?debug=1` (overlay HUD + skeleton), `?input=keyboard|pose|replay:<fixture>`, `?seed=<n>`, `?camera=<deviceId>`, `?model=lite|full|heavy`, `?players=1|2`, `?motion=step|auto`.

---

## 4. Milestones (each has a Definition of Done the agent can verify alone)

Rule: one milestone per session (or less). Don't start Mx+1 until Mx DoD is green and recorded in `docs/PROGRESS.md`.

### M0 — Bootstrap & harness (½ day)
- Vite + TS strict, ESLint (+ boundaries rule), Prettier, Vitest, Playwright (Chromium with fake-camera flags), `pnpm verify` = typecheck + lint + unit + e2e-smoke.
- `.claude/settings.json` hooks (see §5), `typescript-lsp` plugin confirmed working (`workspaceSymbol` returns results).
- `docs/ARCHITECTURE.md`, `docs/features.json`, `docs/PROGRESS.md` created. ADR-001 (WebGL renderer), ADR-002 (pure core).
- Vendored MediaPipe wasm + `pose_landmarker_full.task` in `public/models/`.
- **DoD:** `pnpm verify` green on a hello-world canvas; Playwright test loads the page and sees `window.__game`.

### M1 — Camera & pose pipeline (1 day)
- Camera manager: `enumerateDevices` after permission, dropdown, remembered `deviceId`, request 1280×720@30, graceful fallback.
- Worker-hosted PoseLandmarker (GPU delegate, `VIDEO` mode), main-thread bridge with `PoseFrame` stream, downscale to 640×360.
- Debug view: mirrored video + skeleton overlay + FPS (camera/pose/render) + visibility heatmap.
- Fixture recorder: `?record=1` dumps last 30 s of `PoseFrame[]` to a downloadable JSON. **Jorge records the first fixtures here** (`lean-left-right.json`, `jump.json`, `crouch.json`, `idle.json`, `two-players.json`) and one `.mjpeg/.y4m` clip.
- **DoD:** e2e test with fake camera clip shows ≥ 1 pose detected at ≥ 20 pose-fps for 5 s; unit test: worker bridge reconnects after worker crash.

### M2 — Signals & gesture engine (1 day)
- One Euro filter, signal derivation, calibration state machine, gesture engine per §2.2, keyboard `InputSource`, replay `InputSource` (plays a fixture in real-time or instantly).
- **DoD:** fixture-driven unit tests assert exact event sequences (`jump.json` → exactly N JUMP events, zero LANE events, etc.). Tuning constants isolated in `gestures.config.ts`. Debug HUD shows live signals with thresholds drawn.

### M3 — Core sim (1–2 days)
- `GameSim` for Skate Run: lanes, jump arc (fixed-height, tunable), slide, collision (AABB vs obstacle boxes; three obstacle classes: jump-over, slide-under, wall), coins, score, speed ramp, chunk queue with seeded pattern selection, power-ups, revive.
- Pattern library v1: ≥ 24 patterns across difficulty 1–5, biome-tagged; solvability validator runs in tests over all patterns.
- **DoD:** determinism test (same seed + same event log ⇒ identical state hash after 60 s); solvability test; a headless "bot" test that plays 2 minutes on seed 42 with perfect reactions and never crashes.

### M4 — Renderer & world view (2 days)
- three.js scene: renderer factory, follow camera, lighting (one directional + hemisphere + HDRI env), fog matching biome palette, chunk views bound to sim chunks, pools, `InstancedMesh` coins with spin, procedural skater + board (animation state: run/jump/slide/grab), obstacles from Kenney kits, biome 1 & 2.
- HUD overlay (DOM): score, coins, multiplier, distance, power-up timers, tracking indicator, revive prompt, results card. No menus beyond that.
- Perf gate: 60 fps at 1080p on the target laptop with pose running; draw calls < 150; GPU frame < 8 ms.
- **DoD:** Playwright screenshot tests on seed 42 at t=0/10/30 s (pixel diff tolerance); perf test reads `getFps()` ≥ 55 over 20 s with keyboard input.

### M5 — Progression & persistence (1 day)
- ProfileStore (localStorage, versioned schema + migration), missions (10 templates), milestones, revive tokens, power-up unlocks, settings. Results card wiring.
- **DoD:** unit tests for mission progress + schema migration; e2e: complete a run, reload, verify persisted totals.

### M6 — Multiplayer (2–3 days)
- 6a Local split-screen (`numPoses: 2`, zone assignment, two sims, one seed).
- 6b Colyseus server (`server/`), room protocol, ghost rendering, join-by-code, synced start, leaderboard. Dockerfile + Coolify-ready compose.
- **DoD:** 6a e2e with `two-players.json` replay produces two independent runs; 6b integration test spins up server in-process and two headless clients complete a synced race.

### M7 — Polish & extraction (ongoing)
- Extract `MiniGame` interface for real (move Skate Run behind it), tracking-quality coach, third biome, difficulty tuning from playtest notes, soccer stub (`games/penalty/`) proving the framework.

### M8 — Skate Run step propulsion
- M8.0 Port perf reporting from `448e4cf` (GPU name + delegate in debug stats, software-GL CPU fallback, perf probe). Every later perf run reports the GPU name and delegate.
- M8.1 `activeGestures` detector scoping (unless M7.16 built it).
- M8.2 Shared march classifier (`src/pose/march.ts`) + knee calibration + JUMP both-knees gate. Tests stay provisional until the `skate-*` fixtures exist.
- M8.3 Speed model (§2.3), motion modes (§2.9), `S` key, bot steps at 2.4 steps/s.
- M8.4 Chaser (§2.7): sim, HUD warning, view. Waits until the 1080p fps gate failures are explained or the park biome is decimated.
- M8.5 Skyhook (§2.8): sim, `SKYHOOK_GATE` pattern, view. Same perf precondition as M8.4.
- M8.6 Perf gates 1P/2P re-run serially; measured values and retry counts logged.
- **Render cap for M8:** ≤ +3 draw calls and ≤ +5k triangles per screen slot; no new skinned meshes.
- **DoD:** determinism test with STEP events; solvability at F; chaser trigger, warning, escape and catch at exact ticks; Skyhook earn, gate, chaser reset and landing at exact ticks; fixture tests (provisional until recordings exist) for STEP counts, 0 JUMP while jogging, 0 STEP on jumps, and lanes/slides unchanged while stepping; perf gates green with no threshold changed.
- **Fixtures Jorge records** (`fixtures/pose/skate/`, full body with knees visible, counts said aloud): `skate-still`, `skate-march` (~2 steps/s), `skate-jog` (~2.6 steps/s), `skate-jog-jumps`, `skate-jog-lanes`, `skate-jog-slides`.

Rough total: ~10 focused agent-days. Jorge's human-in-the-loop moments: record fixtures (M1), playtest and tune constants (M2, M4), deploy server (M6).

---

## 5. Harness details (what makes the agent reliable here)

See `AGENTS.md` for the rules; this section lists the *mechanisms* to install in M0.

**Hooks (`.claude/settings.json`):**
- `PostToolUse` (Edit/Write on `*.ts`): run `prettier --write` on the file and `tsc --noEmit -p .` (fast, incremental); surface errors back to the agent.
- `PreToolUse` (Edit/Write): **block** writes to `fixtures/**`, `docs/PLAN.md`, `public/models/**`. These are human-owned.
- `Stop`: if `docs/PROGRESS.md` was not touched this session, remind the agent to log.

**Slash commands (`.claude/commands/`):**
- `/verify` → `pnpm verify` and summarize failures.
- `/playtest <seed> <input>` → runs Playwright in headed mode on the given seed with keyboard/replay input and saves a screenshot + state dump to `tmp/playtest/`.
- `/milestone-check <M>` → reads `docs/features.json`, lists remaining DoD items.

**Subagents (`.claude/agents/`):**
- `reviewer` — read-only; checks a diff against `AGENTS.md` rules and the dependency rules; outputs a checklist.
- `perf` — runs the perf e2e, reads draw calls/fps, suggests concrete fixes.

**Docs the agent consults (via Context7 MCP when available, else vendored):** three.js docs, MediaPipe Pose Landmarker web guide, Colyseus docs (`llms.txt`). Prefer docs to memory for API signatures — three.js changed a lot (r15x → r18x).

**LSP:** install `typescript-language-server typescript` globally, then the official `typescript-lsp` plugin (Claude Code ≥ 2.1). If it misbehaves on Windows without WSL, the known fix is the `.cmd` suffix in the plugin's marketplace command definition; on WSL/Linux it just works.

---

## 6. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Step vs jump confusion (running in place is the primary input) | High | Stepping and jumping are told apart by leg symmetry, not hip motion: STEP = one knee lifts while the other stays planted; JUMP = the hip rise + velocity gate *and* both knees rising together. One shared march classifier (`src/pose/march.ts`); detectors scoped per game and state (PLAN-BOXING §8). Knees untracked → STEP unavailable, `motion=auto` with a "step back" banner. Thresholds tuned only on recorded fixtures; until then step/jump tests are provisional. *Boxing:* running/marching in place is **input** in the knockdown state and the corner (PLAN-BOXING §6.3, §9). |
| Physical fatigue ends sessions | High | Top speed at a jog (2.6 steps/s), so sprinting earns nothing; the chaser only comes after a near-stop (< 0.9 steps/s); a guaranteed Skyhook rest earned by steps; runs target 2–3 min with the results card as rest. Validate by playtest. |
| Lane hysteresis feels laggy | Medium | Offer absolute-zone mode; tune on real fixtures; render lane preview arrow before commit |
| Second player detection drops when close | Known | Split-screen with zone guides; pause when < 2 poses; camera 3+ m back, wide FOV |
| Pose fps dips on integrated GPU laptops | Medium | `lite` model fallback auto-selected when pose-fps < 20 for 3 s |
| Agent writes three.js against an old API | High | Pin version; Context7 docs; renderer factory; e2e screenshot tests catch black screens |
| Agent "verifies" without running anything | High | Hooks + `pnpm verify` in DoD + PROGRESS.md log requirement + reviewer subagent |
| Asset licensing mix-ups | Low | CC0-only default; `CREDITS.md` mandatory for any CC-BY file; a test lists every file in `assets/` and checks it appears in `CREDITS.md` |
| Float drift over long runs | Low | World moves, player static; distance is a scalar |

---

## 7. Kickoff prompt for Claude Code (copy-paste)

> Read `AGENTS.md` and `docs/PLAN.md` fully. Confirm the LSP tool works by running `workspaceSymbol` for "GameSim" (expect none yet) and `documentSymbol` on `package.json`. Then execute **M0** exactly as specified in PLAN §4, creating `docs/ARCHITECTURE.md`, `docs/features.json` (all milestones and DoD items, status `todo`), `docs/PROGRESS.md`, ADR-001 and ADR-002. Do not start M1. When `pnpm verify` is green, append a PROGRESS entry with what was done, what was verified and how, and what you'd do next. Ask me only if a decision is not covered by PLAN or AGENTS.

Follow-up sessions: "Continue with M<n> per PLAN §4. Start by reading PROGRESS.md and features.json."

---

## 8. Open questions for Jorge (answer before M2)
1. Lane mode preference: relative lean (default) vs absolute zones? (Both will be implemented; pick the default.)
2. Play distance: are you standing 2.5–3 m from the Full HD cam with full body visible? If not, confirm FOV before M6a.
3. Server host: Hetzner via Coolify (assumed) — provide domain for WSS.
4. Art direction: Kenney "flat" style vs KayKit/Quaternius "stylized" — pick one family to keep the look consistent.

## 9. Sources consulted (for future re-verification)
MediaPipe Pose Landmarker web guide and `PoseLandmarkerOptions` reference (Google AI Edge) · MediaPipe GitHub issues #4681 (multipose proximity dropout) · three.js releases/docs (WebGPURenderer, r18x) · Colyseus docs and npm · Claude Code official plugin `typescript-lsp` and community LSP marketplaces · CircleCI write-up on LSP vs grep in Claude Code · Kenney / Quaternius / KayKit / Poly Haven asset catalogs (itch.io CC0 listings) · Ubisoft's note on Just Dance camera-controller as prior art for phone/webcam full-body scoring.
