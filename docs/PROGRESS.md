# Progress log

Append-only. Newest entry at the bottom. Each entry covers: date, feature, what changed, what was verified and how, known gaps, next step.

---

## 2026-09-16 — M0 Bootstrap & harness ✅

**Result:** M0 DoD is green. `pnpm verify` passes on a hello-world canvas, and the Playwright smoke test loads the page and asserts `window.__game`.

### What changed

- **Toolchain** (all pinned exactly):
  - vite 8.3.0, vitest 5.0.1, typescript **6.0.3**, eslint 10.10.0 + typescript-eslint 8.70.0, prettier 3.9.7, @playwright/test 1.63.0 (Chromium headless shell 153), @types/node 22.
  - Runtime: `@mediapipe/tasks-vision` 1.0.1 (ADR-003).
- **Why TS 6 and not 7:** npm `latest` is TS 7.0.2, but typescript-eslint 8.70 only supports TS < 6.1. Revisit when typescript-eslint supports TS 7.
- **`three` not installed yet.** Nothing in M0–M3 uses it. It gets added at M4, pinned (0.186.0 today). ADR-001 notes this.
- **Boundaries:** enforced with ESLint core rules (`no-restricted-imports`, `no-restricted-globals`, `no-restricted-properties`) in `eslint.config.js`, not `eslint-plugin-boundaries`. That's one less dependency, and it also bans `Math.random` and DOM globals in core, which the plugin can't. Rules are listed in `docs/ARCHITECTURE.md`.
- **`pose ─✗→ core` is enforced** per PLAN §3 ("only input/ knows about both"). This means M2's gesture engine must emit its own event type or strings, and `input/` maps them to core `InputEvent`. If that's too strict, loosen it to type-only imports in M2 and say so here.
- **App:** `index.html` + `src/main.ts` (canvas loop with fps). `window.__game = { getState(): {seed, frame}, getFps() }`, typed in `src/debug-bridge.d.ts`. `src/core/prng.ts` (mulberry32) plus a determinism unit test.
- **Playwright:** `smoke` project (`*.smoke.spec.ts`) runs Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`. The webServer is Vite on 5173.
- **Hooks** (`.claude/settings.json` merged with your existing `enabledPlugins`):
  - `guard-paths.mjs`, `format-and-typecheck.mjs`, `remind-progress-log.mjs`.
  - Deviation: the Stop hook uses `git status --porcelain` instead of `git diff --name-only HEAD`. That also works before the first commit and sees untracked files. It prints a `systemMessage` so the reminder is actually visible (plain stdout from a Stop hook isn't shown).
- **Commands:** `/verify`, `/playtest`, `/milestone-check`. **Subagents:** `reviewer`, `perf` (PLAN §5).
- **Vendoring:** `pnpm vendor:models` copies the wasm from the pinned npm package and downloads `pose_landmarker_full.task` from model version **1** (not `latest`, whose md5 differs), md5-checked. Per your decision, the agent runs the script and `public/models/` is gitignored.
- **Docs:** `ARCHITECTURE.md`, `features.json` (M0–M7, M0 marked done), ADR-001 (WebGL renderer), ADR-002 (pure core), ADR-003 (MediaPipe dependency + vendoring).
- `git init` (the repo had no commits).

### Verified, and how

- `pnpm verify` → exit 0: `tsc` clean, `eslint .` clean, vitest 2 files / 3 tests passed, playwright smoke 2/2 passed.
- **Boundary rules actually fire:** `tests/unit/boundaries.spec.ts` lints synthetic bad files through the ESLint API:
  - core importing three or render, using `window`, calling `Math.random`
  - render importing pose, pose importing core, games importing a sibling game
  - it also checks that a legitimate `games → core` import passes.
- **Vendoring check isn't vacuous:** I hid `pose_landmarker_full.task` and the smoke test failed (`Received: NaN`), then passed once the file was restored. The check uses response size, because Vite's SPA fallback answers 200 for missing files. `pnpm vendor:models` run twice: fresh download, then an idempotent no-op.
- **guard-paths:** a scratch script fed 7 Windows-style paths → `docs/PLAN.md`, `fixtures/…`, `public/models/…` and `.claude/settings.json` exit 2; `src/main.ts`, `docs/PROGRESS.md` and `public/modelsX.txt` exit 0.
- **format-and-typecheck:** a deliberately bad `.ts` printed `TS2322`, exit 0. It also fired live in-session on an Edit (the harness reported the file was reformatted).
- **remind-progress-log:** printed the reminder while PROGRESS.md was missing.
- **LSP:**
  - `workspaceSymbol "GameSim"` → no symbols (expected).
  - `workspaceSymbol "mulberry32"` → `src/core/prng.ts` line 2, so the server works.
  - `documentSymbol` on `package.json` → "No LSP server available for file type: .json". The typescript-lsp plugin only covers TS/JS, so this part of the kickoff check can't pass as written.

### Known gaps / notes for Jorge

- My first `prettier --write .` reformatted **AGENTS.md and CLAUDE.md** (emphasis `*x*`→`_x_`, table alignment, blank lines; content unchanged). Both are now in `.prettierignore`. PLAN.md wasn't touched (mtime unchanged).
- **Context7 MCP** returned "Invalid or expired OAuth token". Re-auth it before M1, since MediaPipe and three API calls are supposed to be checked there.
- `/playtest` and the `perf` agent are written but have nothing to exercise until M2 and M4.
- `--use-file-for-fake-video-capture=fixtures/video/<clip>` isn't wired yet. It needs your clip (M1).

### Next step

M1: camera manager + worker-hosted PoseLandmarker loading from `/models/`. First action: re-auth Context7 and check the `FilesetResolver.forVisionTasks('/models/wasm')` + `PoseLandmarker.createFromOptions` signatures for tasks-vision 1.0.1. Blocked on you for fixtures and the video clip before M1's DoD can go green.

---

## 2026-09-16 — M1 Camera & pose pipeline (code done; real-fixture DoD pending)

**Result:** the full pipeline runs end to end: webcam → worker PoseLandmarker (GPU) → skeleton overlay. `pnpm verify` passes. The fake-camera e2e currently runs on an **interim placeholder clip** I generated. It is **not** your recorded fixture, and M1.D1 stays `in_progress` until your clip replaces it.

### What changed

- **`src/pose/camera.ts`:** `getUserMedia` with `ideal` 1280×720@30, so other modes still open. The last device is remembered in `localStorage`. If the chosen device is unplugged or busy, it falls back to the default camera without overwriting your saved choice. Permission-denied errors are rethrown so the panel can offer Retry. `listCameras()` runs after permission so devices have labels.
- **`src/pose/pose.worker.ts`:** module worker. `FilesetResolver.forVisionTasks('/models/wasm', true)`, `PoseLandmarker` in `VIDEO` mode.
  - Tries the GPU delegate on an `OffscreenCanvas` first and falls back to CPU if either creation or warm-up fails.
  - Runs one warm-up detect before posting `ready`.
  - Sends only `{x, y, z, visibility}` back to the main thread.
- **`src/pose/bridge.ts`:**
  - One frame in flight at a time (frames get dropped, never queued) and ImageBitmaps are transferred, not copied.
  - Restarts the worker on `error`, on a posted `fatal`, when a frame gets no result within 3 s, or when init takes over 30 s. Backoff runs 0.5 s → 10 s.
  - Events still queued from a dead worker are ignored, and dispose is final.
- **`src/pose/pipeline.ts`:** `requestVideoFrameCallback` → `createImageBitmap` resized to 640 px wide (aspect kept, so 640×360 for 16:9) → bridge. Tracks camera/pose fps, inference ms, and processed vs with-pose frame counts.
- **`src/pose/pose-panel.ts`:**
  - Mirrored `<video>` with the skeleton on a canvas mirrored the same way.
  - Landmark dots are colored by visibility, and a 33-cell heatmap strip sits under the video.
  - Stats line: camera/pose/render fps, inference ms, delegate, worker state, restarts, resolution, frames with a pose.
  - Camera `<select>` with a Retry button, safe against fast camera switching.
- **`src/pose/recorder.ts`:** `?record=1` keeps a rolling 30 s buffer of PoseFrames. The **Download last 30 s** button or the `R` key saves `pose-<timestamp>.json` as `{version: 1, recordedAt, model, video: {width, height}, frames}`. `t` is rebased to 0 ms. Landmarks are **raw, not mirrored**; mirroring is left to M2 signals.
- **`src/main.ts` / debug bridge:** URL params `?input=pose` (default) | `keyboard`, `?debug=1`, `?record=1`, `?model=lite|full|heavy`, `?camera=<deviceId>`, `?players=2` (sets `numPoses: 2`). `window.__game.getPoseStats()` was added. `getSignals`/`inject`/`setSeed` wait for M2/M3.
- **`scripts/vendor-models.mjs`** now also vendors `lite` and `heavy` (model v1, md5-pinned) for `?model=`.
- **Placeholder clip:** `scripts/make-placeholder-clip.mjs` → `tests/e2e/assets/placeholder-person.mjpeg` (1280×720, 4 s @ 30 fps, 2.2 MB, committed).
  - Source: MediaPipe's own Apache-2.0 testdata image `male_full_height_hands.jpg`, sha256-pinned, swaying ±200 px and bobbing 40 px. Listed in the new `CREDITS.md`.
  - Deliberately **not** put in `fixtures/`, which is yours.
- **Playwright `smoke` project:** now `channel: 'chromium'` (new headless). The old headless shell only got SwiftShader, at 230 ms per inference. New headless uses the RTX 4060 through ANGLE/D3D11. The fake camera is fed the placeholder clip.
- `index.html`: the `100vw/100vh` rule is scoped to `#game`, and an empty favicon was added.

### Problems hit and how they were solved

1. **Vite dev returned 500 on `/models/wasm/vision_wasm_module_internal.js?import`.** MediaPipe's loader `import()`s the vendored JS, and Vite rewrites that import and refuses `public/` JS. The loader checks for a `self.import` hook first, so the worker installs one built with `new Function('url', 'return import(url)')`, which Vite's import analysis can't see. Documented in ARCHITECTURE.md.
2. **Warm-up tripped the watchdog:** the first GPU inference took over 3 s. Fixed with a warm-up detect before `ready`.
3. **Headless GPU:** measured the renderer per launch mode: headless-shell → SwiftShader; new headless → RTX 4060.

### Verified, and how

- **`pnpm verify` → exit 0:** tsc clean, eslint clean, vitest 4 files / 7 tests, playwright smoke 3/3.
- **Pose e2e** (`tests/e2e/pose.smoke.spec.ts`, fake camera = placeholder clip, `?input=pose&debug=1&record=1`), measured over 5 s: `poseFps 29.8, 149/149 frames with a pose, delegate GPU, video 1280x720, camera 30 fps, infer ~7–10 ms, restarts 0`, with no page errors. It asserts ≥ 20 pose-fps, > 90 % of frames with a pose, 0 restarts, and 1280×720 video.
  - The same test clicks **Download last 30 s** and checks the JSON: version 1, model full, 1280×720, > 100 frames, `t[0] = 0`, 33 landmarks.
  - Screenshot: `tmp/e2e/pose-smoke.png`. The skeleton lines up with the mirrored video, and the heatmap is all green.
- **Not vacuous:** before fix 1, the same pipeline reported 0 frames with a pose.
- **Unit tests:**
  - `src/pose/bridge.spec.ts` (DoD M1.D2): reconnect after a crash (old worker terminated, new worker gets `init`, frames flow again, late events from the dead worker are ignored); watchdog and `fatal` restarts with backoff timing.
  - Mutation check: removing the respawn `setTimeout` fails 2 tests; removing the stale-worker guard fails 1.
  - `src/pose/recorder.spec.ts`: 30 s window and rebasing.
- **Reviewer subagent** on the diff: all rules ✅. It reported 8 real issues, all fixed before commit:
  - GPU warm-up failure didn't fall back to CPU
  - fast camera switching leaked a stream
  - unhandled AbortError from `play()`
  - no init timeout
  - stale worker events could reach the replacement
  - dispose could respawn a worker
  - a fallback camera overwrote the remembered choice
  - `instanceof DOMException` check on camera errors
- `vite build` succeeds (worker gets its own chunk). The production build was **not** e2e-tested; M1 targets the dev server.

### Known gaps

- **M1.D1 isn't truly done** until `fixtures/video/<your clip>` replaces `FAKE_CLIP` in `playwright.config.ts`. That's a one-line change, and I'd keep the ≥ 20 pose-fps assertion. The placeholder is one still person moved around, so it proves the plumbing, not tracking quality on real motion.
- **M1.5 (fixtures) is yours.** The recorder is ready.
- **Not automatable here:** permission-denied UI, real device switching between two physical cameras, real-webcam fps and tracking at your play distance. See the playtest note.
- **CI caveat:** on a machine without a GPU, new headless falls back to SwiftShader (≈ 4 pose-fps measured here), so the ≥ 20 pose-fps assertion would fail. That's fine locally; it matters once CI exists.
- `.claude/settings.json` has your uncommitted context7 plugin change. I left it out of the commit.

### Playtest note for Jorge

1. `pnpm install && pnpm vendor:models` (only on a fresh clone), then `pnpm dev`.
2. Open `http://localhost:5173/?debug=1` in Chrome and allow the camera.
3. Check:
   - skeleton alignment when you raise your left hand (it should move on the screen's left, like a mirror)
   - pose fps ≥ 25 in the stats line with `delegate GPU`
   - picking your Full HD camera in the dropdown, then reloading: it should stay selected
   - denying permission in site settings, then Retry
4. Record fixtures at `http://localhost:5173/?debug=1&record=1`: do the movement, then press `R` (or the button) within 30 s. Save the files as `fixtures/pose/lean-left-right.json`, `jump.json`, `crouch.json`, `idle.json`, and `two-players.json` (the last one with `&players=2`).
5. For the fake-camera clip, record ~5 s of yourself with any tool and convert it: `ffmpeg -i in.mp4 -t 5 -vf scale=1280:720,fps=30 -q:v 5 -f mjpeg fixtures/video/jorge-lean-jump.mjpeg`.

### Next step

Once your fixtures land: swap the e2e clip to `fixtures/video/…`, flip M1.D1 to done, then start M2 (One Euro filter, signals, gesture engine, fixture-driven event tests).

---

## 2026-09-16 — M2 Signals & gesture engine (code done; recorded-fixture DoD pending)

**Result:** the full gesture path works: PoseFrame → smoothing → calibration → signals → edge-triggered events → core `InputEvent`, with keyboard and replay sources and a live signal HUD. `pnpm verify` passes. Per your instruction, the event-sequence tests run on **synthetic** pose sequences, each marked `TEMPORARY(synthetic-fixtures)`. M2.D1 stays `in_progress` until they're rewired to per-gesture recordings.

### What changed

- `src/pose/gestures.config.ts`: every tuning constant, with units (PLAN §2.2 values).
- `src/pose/one-euro.ts`: One Euro filter.
- `src/pose/body.ts`: 7 landmarks (nose, shoulders, wrists, hips).
  - Visibility < 0.5 → hold ≤ 300 ms, then lost.
  - One Euro filtering in **pixel space**.
  - `measure()` computes shoulder/hip centers, torso length and shoulder width (aspect-corrected), `armsUp`, and T-pose.
- `src/pose/calibration.ts`: waiting → calibrating → calibrated. You need to be neutral (arms down, not T-posing) and hold still for 2 s; drift > 0.08 torso restarts the count.
- `src/pose/gestures.ts`: the engine. Signals: `leanX, hipRise, hipRiseVel, headDrop, armsUp, tPose, zone, tracking, calibration`. Events:
  - LANE_LEFT/RIGHT in lean mode (±0.35 enter, ±0.20 re-arm) or zones mode (thirds ± 0.03)
  - JUMP (rise > 0.15 and velocity > 1.2/s over 100 ms, 500 ms cooldown), then GRAB (arms up while airborne, once per jump)
  - SLIDE_START (> 0.25 for 100 ms) / SLIDE_END (< 0.12, 400 ms cooldown)
  - REVIVE_ACCEPT (arms up 1 s, once per hold); RECALIBRATE (T-pose 1 s)
  - TRACKING_LOST (no raw pose for 700 ms; `tick()` also covers "no frames at all") and TRACKING_RESTORED; CALIBRATED
- `src/core/input.ts`: `InputEvent` per PLAN §3, **plus `RESUME`** (tracking came back after PAUSE; PLAN §2.2 auto-resume needs a signal).
- `src/input/`:
  - `keyboard.ts`: ←/→, Space, ↓ down/up = SLIDE_START/END, ↑ = GRAB, C = RECALIBRATE; ignores auto-repeat.
  - `pose-source.ts`: gesture → InputEvent mapping. REVIVE_ACCEPT→REVIVE, LOST→PAUSE, RESTORED→RESUME; CALIBRATED is UI-only.
  - `replay.ts`: `instant` or `realtime` playback.
- `src/pose/signal-hud.ts` (`?debug=1`): 5 s plots of leanX / hipRise / headDrop with enter (red) and exit/re-arm (amber) threshold lines, a status line (calibration %, tracking, armsUp, T-pose, zone, velocity), and the last 7 events.
- `src/main.ts`:
  - Keyboard is always on as the fallback.
  - `?input=pose` (default) feeds camera frames into the pose source.
  - `?input=replay:<name>` loads `/fixtures/pose/<name>`; a value containing `/` is used as the URL.
  - `window.__game` gained `getSignals()`, `getEvents()`, and `inject({type})`. `setSeed` waits for M3.

### Decisions / deviations from PLAN §2.2 (flip them if you disagree)

1. **Calibrated denominators.** leanX divides by the calibrated shoulder width, and hipRise/headDrop by the calibrated torso length, not live per-frame values. In your recording, live shoulder width drops from 0.12 to 0.03 when you turn (18.5 s), which would turn a small shift into a huge leanX and fire false lane changes. Trade-off: if you walk closer or farther away, you need to recalibrate (T-pose 1 s or `C`).
2. **One Euro runs in pixels.** `minCutoff 1.0, beta 0.007` were tuned for pixel units. In normalized coordinates, beta would be effectively 0, adding ~160 ms of lag and flattening jumps.
3. **The engine doesn't know game context.** It fires REVIVE_ACCEPT whenever arms are up for 1 s, and GRAB during its own airborne window. The M3 sim ignores events that don't apply.
4. **Zones mode:** at calibration the zone starts at center (the sim's start lane). If you calibrate off-center you get one catch-up LANE event.

### Verified, and how

- **`pnpm verify` → exit 0:** tsc and eslint clean; vitest **27 passed + 1 skipped** (7 files); playwright smoke **5/5**. Pose e2e still runs at 30 pose-fps on the GPU.
- **`src/pose/gestures.spec.ts`**, TEMPORARY synthetic exact sequences (30 fps, ±0.002 jitter):
  - idle 12 s → `[CALIBRATED]` only; pacing never calibrates
  - lean L → `[LANE_LEFT]`; L, R, L → 3 events; holding 3 s → 1; wobbling between 0.30 and 0.55 → 1; a 0.25 lean → none
  - the same lean at 0.6 scale gives the same events (distance invariance)
  - quick jump → `[JUMP]`; two jumps → 2; a slow rise to the same height → none (velocity gate)
  - crouch → `[SLIDE_START, SLIDE_END]`; a 60 ms dip → none
  - jump with arms up → `[JUMP, GRAB]`; arms up standing → none; arms up 2.5 s ×2 → `[REVIVE_ACCEPT ×2]`
  - T-pose → `[RECALIBRATE, CALIBRATED]`; recalibrating mid-slide → `SLIDE_END` first
  - pose gone 1.2 s → `[TRACKING_LOST, TRACKING_RESTORED]`; a 400 ms gap → none; `tick()` without frames → LOST
  - zones: walking left then far right → `[LANE_LEFT, LANE_RIGHT, LANE_RIGHT]`; calibrating in the left third → catch-up `LANE_LEFT`
- **Mutation checks:** removing the jump velocity gate fails the slow-rise test. Removing the lean re-arm condition fails 2 lean tests.
- **`one-euro.spec.ts`:** a constant signal passes through exactly; ±4 px jitter is damped to < 2 px; a 300 px step is > 250 px after 4 frames with beta, versus < 200 px with beta = 0.
- **`input.spec.ts`:** keyboard mapping (repeat ignored, stop is clean, stop mid-slide sends SLIDE_END); replay `instant` and `realtime` (fake timers) both → `[LANE_LEFT, JUMP]`.
- **`gestures.smoke.spec.ts` (e2e):**
  - real key presses plus `inject` give the exact event list
  - a synthetic fixture served as `/fixtures/pose/synthetic-lean-jump.json` via `?input=replay:` gives `[LANE_LEFT, JUMP]`, with signals calibrated and tracking ok
  - HUD screenshot: `tmp/e2e/signal-hud.png`
- **Reviewer subagent:** boundaries ✅. It found 3 real bugs, all fixed with tests: recalibrating mid-slide didn't end the slide, zones calibration silently offset the lane, and keyboard `stop()` while ↓ was held didn't end the slide. Its other flags weren't bugs: `createGestureEngine` length (passes ESLint's counting after a small extraction) and the skipped combined-recording test (skipped on purpose).
- **Real-data sanity** (read-only, from `~/Downloads/pose-2026-09-16T18-42-19-146Z.json`, not copied into the repo; output in `tmp/probe-combined.txt`):
  - It calibrated at 0–4 s while you were close to the camera. After you stepped back, hipRise sat ~+0.7 above that baseline, so the early JUMP at 5.6 s and the LANE_LEFTs come from stale calibration.
  - **The real jump at 21.4 s was detected**, with velocity peaking at 2.75 torso/s against the 1.2 gate and hipRise +0.4 over the pre-jump level.
  - Recording rate was ~20 pose-fps (50 ms median frame interval), not 30. Thresholds still worked at that rate.

### Known gaps

- **M2.D1:** real per-gesture fixtures are needed. Every test to swap: `grep -rn "TEMPORARY(synthetic-fixtures)" src tests`.
- **`fixtures/pose/combined-raw.json` isn't in the repo** (the only recording is in Downloads). The sanity test in `gestures.spec.ts` skips until that file exists, then asserts it runs cleanly with finite signals and a plausible event count.
- **Not tested with a live body:** real lean/jump/crouch feel and false positives while running in place are playtest items.
- **Calibration after walking to position:** there's no auto-recalibrate when the torso size changes a lot. If playtests show people forget, add "torso length changed > 25 % for 2 s → recalibrate".
- **Two players:** only the first pose is used (`?players=2` detects two, but zone assignment is M6).

### Playtest note for Jorge

1. `pnpm dev`, then open `http://localhost:5173/?debug=1`. The signal HUD is bottom-right, the camera panel top-left.
2. Stand at your play distance and hold still until the HUD reads `calibrated` (2 s). To redo it: T-pose 1 s, or press `C`.
3. Check each gesture against its HUD line:
   - **lean:** past the red line fires LANE; come back inside amber before the same side fires again
   - **jump:** hipRise spike over the red line
   - **crouch:** headDrop over red = SLIDE_START, under amber = SLIDE_END
   - **arms up mid-jump:** GRAB; **arms up 1 s standing:** REVIVE
   - **step out of frame:** PAUSE after 0.7 s, RESUME when you're back
4. **Zones mode** is config-only for now: set `laneMode: 'zones'` in `gestures.config.ts`. Try both and tell me the default (PLAN §8 Q1).
5. **Per-gesture fixtures:** use `http://localhost:5173/?debug=1&record=1`. Do one gesture type repeatedly (e.g. 5 jumps), press `R`, and save as `fixtures/pose/jump.json`. Then `lean-left-right.json`, `crouch.json`, `idle.json` (30 s standing and fidgeting), and `two-players.json` (with `&players=2`). Also tell me the exact counts you performed (e.g. "5 jumps, 3 lefts") so the tests can assert exact sequences.
6. **Replay any recording:** `http://localhost:5173/?input=replay:jump.json&debug=1`.

### Next step

M3 (core sim) can start without fixtures. When recordings land, rewire the TEMPORARY tests first: about 30 minutes, plus tuning in `gestures.config.ts` if the counts don't match.

---

## 2026-09-16 — M3 Core sim (DoD green)

**Result:** Skate Run's simulation is a pure, deterministic core module. It covers lanes, the jump arc, sliding, AABB collisions (hurdle / bar / wall), coins, score, the speed ramp, seeded chunk generation from a 28-pattern library, the power-ups (magnet, 2× coins, hoverboard, rare revive token) and revive, plus pause/resume. All three DoD tests pass. Nothing renders it yet; that's M4.

### What changed

- `src/core/sim.config.ts`: every tuning constant, with units.
  - speed 12 + 0.02·d, capped at 26 m/s
  - jump 1.4 m high, 0.75 s airtime
  - slide tap lasts 0.6 s
  - countdown 3 s; resume countdown 1 s
  - revive window 3 s, max 2 per run, 2 s grace afterwards
  - power-ups last 10 s
- `src/core/types.ts`: `SimState`/`ChunkState` as plain JSON data.
- `src/core/sim.ts`: `initState`/`tick`/`cloneState`, plus `createGameSim` (PLAN's `GameSim`: `step(dt, events)` on a fixed 120 Hz accumulator, `getState`, `alpha`, `drainEvents`).
- `src/core/collision.ts`: player, obstacle and pickup boxes.
- `src/core/patterns.ts`: 28 ASCII patterns. There are 7/6/7/4/4 at difficulty 1–5, some tagged street-only or park-only.
- `src/core/worldgen.ts`: speed/difficulty/biome curves; pattern choice; forced-row gap rule (1.5 s of travel); power-up spawn rolls.
- `src/core/bot.ts`: planning bot (DFS over cloned sim states).
- `src/core/hash.ts` (FNV-1a over JSON); `src/core/testing.ts` (test worlds + `botRun`).
- `eslint.config.js`: core may import its own `./input` (the `InputEvent` contract). The `input/` layer is still blocked, which a new boundaries test checks.

### Decisions / deviations (flip if you disagree)

1. **Patterns are ASCII grids in TS, not JSON files.** A 12×3 grid is readable at a glance, and the parser checks it.
2. **Chunk RNG mixes the seed:** `mulberry32(hash(seed, index))`, not `seed + index`. Otherwise seed 43's world is seed 42's shifted by one chunk.
3. **The determinism contract is tick-stamped.**
   - `tick()` is exact. `GameSim.step()` applies live events at the next tick, and the accumulator drops time after a stall of more than 0.25 s.
   - Replays and M6 multiplayer must log `(tick, type)`, not `InputEvent.t`.
4. **Hoverboard = 10 s of invulnerability** (PLAN §1.5 literally), not Subway Surfers' "absorbs one crash".
5. **Slide:** a held crouch slides until SLIDE_END; a tap (keyboard) lasts 0.6 s. ↓ in the air fast-falls and slides on landing.
6. **Close call:** a jump that clears a hurdle, started ≤ 0.3 s before contact, scores +50, at most once per jump.
7. **Grab:** GRAB while airborne adds airtime·100 on landing.
8. **The sim ignores RECALIBRATE**, and movement events during countdown/pause.
9. **The start is 2 empty run-up chunks** (48 m) after the 3 s countdown.

### Verified, and how

- **`pnpm verify` → exit 0:** tsc and eslint clean; vitest **264 passed + 1 skipped** (12 files); playwright smoke **5/5**.
- **M3.D1 determinism** (`tests/unit/core/determinism.spec.ts`):
  - Replaying the bot's 60 s seed-42 log through `createGameSim` gives an identical state hash every time.
  - The hash changes with a different seed, or with one event moved by one tick.
  - Random mashing (crashes, revives, pauses) replays identically.
  - Frames of 1/60 s and ticks of 1/120 s give identical states.
- **M3.D2 solvability** (`src/core/patterns.spec.ts`): every pattern is played by the planning bot in the real sim.
  - Scope: from all 3 lanes, at the speed where its difficulty unlocks and at 26 m/s, starting right at the chunk edge. That's 168 cases.
  - It's not vacuous: 3 deliberately impossible grids (full wall, diagonal walls at 26 m/s, hurdle row followed by a bar row) all fail.
  - Structural rules also pass: obstacles only in rows 3–10, ≤ 1 forced row, none at difficulty 1.
- **M3.D3 bot** (`tests/unit/core/bot.spec.ts`): seed 42 for 120 s of running.
  - It never crashed, and was never invulnerable (no hoverboard pickup, no grace) — asserted, so it survived on merit.
  - Probe: 2815 m, 26 m/s, 418 coins, 20 jumps, 44 slides, 77 lane changes, 17 close calls.
  - Seeds 1, 7, 1234 and 99999 each survive 60 s.
- **Mutation checks:** jump height 1.4 → 0.7 fails 33 tests; slide height 0.9 → 1.2 fails 33 tests.
- **`src/core/sim.spec.ts`** (22 mechanics tests): countdown, speed cap, lane clamp, jump arc/airtime, slide tap/hold, each obstacle class, hoverboard, close call, coins/high coins, magnet+2×, pickups, grab bonus, revive flow and limits, game over with and without tokens, pause/resume (including during the revive offer and the countdown), air slide, `drainEvents` at 60 Hz.
- **`src/core/worldgen.spec.ts`:**
  - curves; determinism per seed, and a different seed is not just a shift
  - difficulty ceiling and biome tags; all 5 difficulties reached
  - forced-row gap over 50 seeds × 150 chunks
  - power-up kinds all appear
- **Reviewer subagent:** boundaries ✅, and the eslint exception still blocks `../input/*`.
  - It found 3 bugs, all fixed with tests: `lastEvent` dropped events (now per-tick `events` + `GameSim.drainEvents()`); no GAME_OVER on a no-token crash; the event-timing contract was undocumented.
  - Minor items also fixed: `-Infinity` in the state, pausing in the countdown shortened it to 1 s, the revive window kept running while paused, an air slide tap didn't slide, `revive` didn't clear the held slide, double close calls on a JJJ row, and the forced-gap rule looked only one chunk back.

### Known gaps

- Pattern solvability is checked in isolation plus 5 bot seeds. Transitions between chunks aren't checked exhaustively.
- **Not tuned by feel.** Jump airtime, slide length, obstacle sizes and the speed curve need playtesting once M4 renders them.
- Profile-driven values (revive tokens, multiplier) are sim options; M5 will wire them.

### Next step

M4 renderer (starting now, per your instructions).

---

## 2026-09-16 — M4 Renderer & world view (DoD green; perf gate partly human)

**Result:** the game is playable and visible:
- three.js (r186, pinned) street biome and park biome with Kenney CC0 models
- procedural skater, instanced coins and power-ups
- DOM HUD with countdown, revive prompt and results card
- restart on jump

Both M4 DoD tests pass: screenshot baselines at seed 42 t = 0/10/30 s (plus a 60 s park frame), and ≥ 55 fps over 20 s at 1080p. All 9 e2e and 266 unit tests pass.

### What changed

- **Dependencies:** `three@0.186.0` + `@types/three@0.186.0`, exact pins. **ADR-004** covers three and the Kenney assets.
- **Assets:** `public/assets/kenney/{city,car,nature}/`, 10 CC0 GLBs plus kit licenses and colormaps (≈ 375 KB, committed). Every file is listed in `CREDITS.md`, enforced by `tests/unit/credits.spec.ts`.
- `src/render/renderer.ts`: `createRenderer` (WebGLRenderer, ACES, sRGB, PCF shadows), per ADR-001.
- `src/render/models.ts`: GLTF load with a box fallback; `fitParts` fits a model into the sim's collision box; `instanced()` pools.
- `src/render/biomes.ts`: street and park looks (sky/fog, road/ground colours, obstacle and prop models, backdrop blocks).
- `src/render/world-view.ts`: everything in the live chunks is redrawn into instanced pools each frame — road/ground tiles, lane dashes, props, blocks, obstacles, coins spinning by sim time, pickups.
- `src/render/skater.ts`: procedural rider and board; ride / slide / air / grab / crashed / hover poses from state.
- `src/render/view.ts`: scene, hemisphere light + sun with shadow, RoomEnvironment PMREM, biome fog; follow camera computed purely from state.
- `src/render/hud.ts`: score, coins, multiplier, distance, power-up timers and revive tokens, tracking pill; centre card for get-ready / countdown / paused / revive (with timer bar) / results (with best).
- **`src/main.ts`:** game loop.
  - Params: `?input=pose|keyboard|bot|replay:<f>`, `?seed`, `?tokens` (revive tokens until M5), `?clock=manual`.
  - Pose/replay runs wait for calibration; any key starts them anyway (keyboard fallback).
  - Jump restarts after game over, but only once the results card has been up for 1 s.
- **Debug bridge:** `getState()` now returns the full SimState. New: `setSeed`, `advance(seconds)`, `getRenderStats()`.
- **Core:** `GameSim.context` + `setController()` for bot autoplay. **Keyboard:** Enter = REVIVE.
- **Pose panel:** a compact corner thumbnail outside `?debug=1`.

### Decisions / assumptions (override any)

1. **Art direction = Kenney flat** (PLAN §8 Q4, as you instructed).
   - Street: jersey barrier = hurdle, highway gantry = slide bar, delivery trucks = walls, lamps and cones, coloured building blocks.
   - Park: log = hurdle, gantry = bar, cliff blocks = walls, trees and rocks, hedges.
2. **RoomEnvironment instead of a Poly Haven HDRI**, so no binary until the look is locked.
3. **Screenshot and perf tests use `?input=bot`,** the in-browser planner from M3, with the keyboard source still live.
   - With keyboard only and no key presses, the run crashes at about 7 s, so t = 10/30 would just show the results card.
   - Screenshots use `?clock=manual` (`advance()`) for exact sim times.
4. **Revive tokens default to 1 per run (`?tokens=`)** until M5's profile store.
5. **Hoverboard/grace shows as a floating board.** There's no magnet pull animation yet: coins just disappear.

### Verified, and how

- **`pnpm verify` → exit 0:** tsc and eslint clean; vitest **266 passed + 1 skipped** (13 files); playwright smoke **9/9**.
- **M4.D1** (`tests/e2e/render.smoke.spec.ts`): seed 42, bot, manual clock, 1280×720.
  - `toHaveScreenshot` at t = 0/10/30/60 with `maxDiffPixelRatio: 0.01`. Baselines are in `tests/e2e/render.smoke.spec.ts-snapshots/*-win32.png`.
  - Re-running with `--repeat-each 2` matched every time.
  - At t = 60: distance > 1000 m (park), 0 crashes, draw calls 51–53 (< 150), no console errors or warnings.
- **M4.D2 perf** at 1920×1080, bot + keyboard: `getFps()` sampled 20× over 20 s → min 59, mostly 60; 51 draw calls.
- **Perf with pose running** (fake camera, 1920×1080): render 60 fps and pose 28–31 fps on the same GPU (RTX 4060 Laptop per `nvidia-smi`).
  - The run holds at "Get ready" until calibration, and a key press starts it.
- **HUD flow e2e (keyboard):**
  - crash → "Revive?" → Enter revives → crash again → results card
  - Space within 1 s is ignored; Space after 1 s starts a new countdown at t = 0
  - screenshot `tmp/e2e/results-card.png`
- **Unit:** `GameSim.setController(bot.act)` hashes identically to the headless `botRun` over 20 s. Credits test. Keyboard Enter test.
- **Visual check** of baselines t10 (street), t60 (park), and the results card: models oriented and scaled sensibly, HUD readable.
- **Reviewer subagent:** boundaries ✅, pins ✅, sizes ✅. It found 3 bugs, all fixed:
  - pose/replay mode blocked the keyboard fallback until calibration
  - a late jump right after the crash skipped the results card
  - a restart in the same frame skipped the calibration gate

  Minor items fixed: PMREM/RoomEnvironment not disposed, NaN `?tokens`, a frozen "3" shown while calibrating (now "Get ready"), a stale doc string. The e2e console allowlist covers only ANGLE X4122 shader-precision warnings and MediaPipe's own glog lines.

### Known gaps

- **M4.6 perf gate (in_progress):**
  - "GPU frame < 8 ms" isn't measured; it needs `EXT_disjoint_timer_query`.
  - "60 fps on the external 1080p60 display with you playing" is your playtest.
  - The automated fps numbers come from a 60 Hz rAF in headless Chromium.
- **Rendering is only interpolated for distance.** Lane changes and jump height step at 120 Hz; smooth them if they judder on high-refresh displays.
- **Replay:** gestures in the 3 s countdown right after calibration are ignored by the sim. They still show in `getEvents()`.
- **Screenshot baselines are Windows-only** (`-win32`). CI on Linux would need its own baselines.
- **Bot mode never restarts after game over** (it isn't an attract loop).
- **Not built yet:** audio, magnet pull, near-miss/grab effects.

### Open questions for Jorge (defaults picked so nothing is blocked)

1. **Art family:** keep Kenney flat (current), or switch to KayKit/Quaternius? ADR-004 lists what a switch touches.
2. **Lane mode default:** lean (current) vs zones (PLAN §8 Q1, still open from M2).
3. **Hoverboard:** 10 s invulnerability (PLAN §1.5, current), or Subway Surfers' "absorbs one crash"?
4. **Feel constants** in `src/core/sim.config.ts`: jump 1.4 m / 0.75 s, slide tap 0.6 s, speed 12 → 26 m/s. Tune after your first body playtest.

### Playtest note for Jorge

1. `pnpm dev`, then `http://localhost:5173/?input=keyboard&seed=42`. ←/→ lanes, Space jump, ↓ slide, ↑ grab (in the air), Enter revive, Space to play again.
2. Watch the bot: `http://localhost:5173/?input=bot&seed=42` (street, park after about 45 s).
3. **Body:** `http://localhost:5173/?seed=42` (pose is the default). Stand at play distance until "Get ready" disappears (calibrated), then play. Add `&debug=1` for the big camera panel and signal HUD.
4. **Perf check on the external display:** `http://localhost:5173/?seed=42&debug=1`, then `window.__game.getFps()` and `window.__game.getRenderStats()` in DevTools.

### Next step

M5 (progression & persistence) when you give the go-ahead. Per your instructions I stopped at M4.

---

## 2026-09-16 — Input-to-screen latency: measured, filter retuned, render judder fixed

**Result:** a pose gesture now reaches the screen about 25–30 ms sooner (jump ≈ 221 → 191 ms, lean ≈ 257 → 225 ms, crouch ≈ 372 → 348 ms, measured from movement start to the next frame after the reaction is drawn). Steady-state lane-change judder is gone (60 Hz: 48 → 0.6 mm per frame). Most of what's left is gesture *design*: thresholds, the velocity window and the slide hold. Those are feel decisions for real per-gesture recordings.

### How it was measured

- **Live stages** (`pnpm latency:pipeline LABEL=…`, `tests/e2e/pipeline-latency.tool.spec.ts`): fake camera → worker → gesture engine on this laptop (RTX 4060, 1080p, 60 Hz). The bot keeps the run alive, and ArrowUp presses time the event → sim → render path.
  - The same numbers are live in the game at `?latency=1` and via `window.__game.getLatency()`.
  - New `PoseFrame.timing`: requestVideoFrameCallback `captureTime`, callback, bitmap ready, result back, infer ms.
- **Algorithmic detection delay** (`pnpm latency:gestures`, `tests/tools/gesture-latency.tool.ts`):
  - Inputs: human-like jump/lean/crouch motion profiles on top of the body proportions and real still-standing noise from your recording (read-only from Downloads).
  - At 30 pose-fps, averaged over 7 sampling phases.
  - Split into *geometry* (thresholds, no filter) and *filter* lag; false events over 60 s idle at 1×/2×/4× noise.
  - `GRID=1` sweeps the One Euro parameters.
- **Render judder** (`pnpm latency:judder`, `tests/tools/frame-judder.tool.ts`): the real sim + bot for 120 s, frames at 60/120/144/165/240 Hz with ±0.3 ms rAF jitter. Each frame's drawn position is compared with the continuous position at that instant.
- **Not visible to software:** sensor exposure + USB + driver time before `captureTime`, and panel scan-out after the frame is composited. For true motion-to-photon, film yourself and the screen at 240 fps with `?latency=1`. The white square flashes on the frame an event is drawn; count frames from movement start.

### Before → after (p50, ms)

| Stage | Before | After |
| --- | --- | --- |
| camera capture → video frame callback | 9.4 | 9.5 |
| downscale to 640 px | 0.8 | 0.8 |
| worker round trip (infer 11.2) | 11.6 | 11.5 |
| gesture engine | 0.0 | 0.0 |
| **detection: jump** (geometry + filter) | 129 + 43 | 129 + 14 |
| **detection: lean** | 167 + 38 | 167 + 10 |
| **detection: crouch** (incl. 100 ms hold) | 291 + 33 | 291 + 10 |
| event → next rAF (waits for the frame) | 9.1 | 9.5 |
| sim step + render | 1.4 | 1.3 |
| render → next frame (≈ on screen) | 15.3 | 15.1 |
| render lag from 120 Hz stepping (lateral / vertical) | ≈ 3.8 / 1.3 | ≈ 0 |
| **end-to-end jump / lean / crouch** | **221 / 257 / 372** | **191 / 225 / 348** |

- **Keyboard for comparison:** key press → next frame 26 ms p50 / 33 ms p95, unchanged.
- **Detection delays on your real recording:** the same 9 events fire, 5 of them 40–120 ms earlier. Lane changes: 7.32 → 7.18 s, 8.48 → 8.43 s, 16.75 → 16.68 s, 25.27 → 25.15 s. Slide: 25.00 → 24.92 s.
- **Idle robustness is unchanged:** 0 false events at 1×/2×/4× your noise; leanX sd 0.052 → 0.050.

**Judder, SD of drawn − ideal position (mm):**

| Refresh | Lateral before → after | Vertical before → after | Constant lag, lateral |
| --- | --- | --- | --- |
| 60 Hz | 48 → 0.6 | 20 → 1.0 | 45 mm (≈ 4 ms) → 0 |
| 144 Hz | 31 → 18* | 15 → 4.5 | 48 → 2 mm |
| 165 Hz | 30 → 17* | 15 → 4.3 | 49 → 3 mm |

\* What remains above 60 Hz is the first tick of a lane change: nothing can be drawn before the input exists. p95 is 1–34 mm. Forward motion was already extrapolated and stays at ~0.

### What changed

- **One Euro filter in normalized image-height units** (`body.ts`: x × aspect, y). The params went from `{1.0, 0.007 px}` to `{minCutoff 1.0, beta 30, dCutoff 1.0}`.
  - Pixel beta 0.007 ≈ 5 in these units.
  - The sweep showed your still-standing noise is mostly slow sway no cutoff removes: idle jitter is flat across all params. So a high beta costs nothing and cuts filter lag 3–4×.
- **Calibration averages over the hold window** (`calibration.ts`): stillness is measured against the window's mean, not its first frame. The calibration values are that mean.
  - Without this, the lower-lag filter made calibration on your recording never complete, because single-frame sway reset the hold.
  - New `calibration.spec.ts` fails on the old algorithm.
- **Render extrapolation** (`render/interp.ts`, `GameSim.previous()`): draw position = last tick + last tick's velocity × alpha.
  - Clamped at the target lane and at the ground so stops never overshoot.
  - Animation time uses the same alpha. Screenshot tests (manual clock, alpha 0) are unchanged.
- **Latency instrumentation:**
  - `platform/latency.ts` (stages, refresh rate, forward/lateral judder) and `platform/latency-overlay.ts` (`?latency=1` table + flash square)
  - `?autoplay=1` (bot drives while the camera input is live)
  - keyboard events now carry the OS `KeyboardEvent.timeStamp`
- **Tools, run on demand and not in verify:** `pnpm latency:gestures | latency:judder | latency:pipeline`, `vitest.tools.config.ts`, and the Playwright `tools` project. Results go to `tmp/latency/*.json`.

### Verified

- **`pnpm verify` → exit 0:** vitest 268 passed + 1 skipped (14 files); playwright smoke 9/9. The screenshot baselines didn't change.
- **Before/after reports:** `tmp/latency/{gestures,pipeline,judder}-{before,after}.json`. "Before" = this commit's code with `body.ts`, `gestures.config.ts` and `calibration.ts` reverted.

### Remaining levers (not changed; they're feel decisions)

1. **Crouch holdMs 100 + enter 0.25 torso** is the biggest delay (291 ms geometry). Holding 50 ms or entering at 0.2 would save ~60–80 ms, with some false-slide risk while running in place.
2. **Jump:** rise 0.15 torso + velocity over a 100 ms window. A 66 ms window saves ~20 ms.
3. **Lean enter 0.35 shoulder widths:** try 0.3 in zones mode.
4. **Low-latency canvas** (`desynchronized: true`) could save a compositor frame (~16 ms) on Chrome/Windows. It needs testing for tearing.
5. **30 pose-fps sampling** costs up to 33 ms of quantization. The camera is capped at 30 fps; a 60 fps camera would halve it.

Tune 1–3 against real per-gesture recordings, not synthetic motion.

### Playtest note for Jorge

- `http://localhost:5173/?seed=42&latency=1` shows the live table (pipeline, pose/keyboard events, your display's refresh rate, judder).
- For true motion-to-photon, film yourself and the screen at 240 fps. Jump, then count frames from your hips starting to rise to the white square.

---

## 2026-09-16 — Art: Quaternius replaces Kenney (approved by Jorge from the screenshot comparison)

**Result:** street and park are now dressed with Quaternius CC0 models, with a rigged skater on a procedural board. Draw calls are 57–59 (Kenney was 51–53) and the game holds 60 fps at 1080p on the street, in the park, and with the pose worker running. Decision record: ADR-005.

### What changed

- **`scripts/vendor-quaternius.mjs`:** downloads the chosen files from Quaternius' public Google Drive folders, then converts them.
  - `npx obj2gltf@3.2.0` for OBJ; `@gltf-transform/cli@4.5.0` to prune and resize textures to 512 px.
  - Output goes to `public/assets/quaternius/{character,streets,cars,transport,buildings,nature}`, 7.6 MB committed.
  - Kenney assets removed. `CREDITS.md` lists every file, and the credits test passes.
- **`render/models.ts`:**
  - new model list
  - procedural barrier / height bar / log / beam / construction box
  - `loadModels` also returns animations
- **`render/merge.ts`:** merges each model's flat-colour parts into one vertex-coloured mesh. On the street this took draw calls from 241–267 to 57–59.
- **`render/world-view.ts` + `biomes.ts`:**
  - Street: buses as long walls, construction box for walls under 5 m, parked cars and street furniture, Quaternius buildings as backdrop.
  - Park: hedge walls, maple/birch trees, flowers.
  - Props and backdrop don't cast shadows.
- **`render/skater.ts`:** Casual_Hoodie (5 of its 24 animation clips kept).
  - Ride: Idle_Neutral plus a crouch.
  - Jump: tuck. Grab: Wave arm up. Slide: deep crouch. Crash: end frame of Death.
  - Bones bend about the character's side axis.
  - Two bugs fixed along the way: GLTFLoader strips dots from bone names, and the mixer only writes changed values, so bends accumulated until bones were restored each frame.

### Verified

- **`pnpm verify` → exit 0:** vitest 268 passed + 1 skipped; playwright smoke 9/9.
- **Screenshot baselines** at seed 42 t = 0/10/30/60 were regenerated intentionally for the new art. Jorge reviewed the before/after sheet (`tmp/art/compare-seed42.png`) and the pose sheet (`tmp/art/poses2.png`) before this commit.
- **Perf at 1920×1080:**
  - bot run: 60 fps for 20 s
  - pose worker running: 60 fps, pose 30 fps
  - park biome at 1450 m: 60 fps, 59 draw calls, 862k triangles

### Known gaps / next

- **No Quaternius jump/crouch clips**, so those poses are bone overrides. A skate-specific animation set (e.g. Universal Animation Library retargeted) would read better.
- **Heavier than Kenney** (up to ~860k triangles). Check on a mid-range laptop; the first levers are fewer backdrop trees or `gltf-transform simplify` on the buildings.
- **Downtown City MegaKit** (newer, itch.io-only) wasn't used: scripting its download failed twice.

---

## 2026-09-16 — Fix: Stop hook's false "PROGRESS.md not updated" reminder

**Bug:** `.claude/hooks/remind-progress-log.mjs` reminded whenever `git status --porcelain` listed any file but not `docs/PROGRESS.md`.

- Once PROGRESS.md was committed it disappeared from that list.
- The long-uncommitted `.claude/settings.json` (context7 plugin) kept the list non-empty.
- So the hook fired on every stop, even though the entries were in history (`git log -- docs/PROGRESS.md`: last entry committed in `8ef2072`).

### What changed

- **Hook:**
  - ignores `.claude/` and `tmp/`
  - lists untracked files individually
  - handles rename/quoted porcelain paths
  - runs git in `CLAUDE_PROJECT_DIR`
  - the message names the files that triggered it
- **`.claude/settings.json` committed:** only `enabledPlugins` changed (adds `context7@claude-plugins-official`, which AGENTS.md §1 requires); hooks are unchanged.

### Verified

Ran the hook in four states:

- only `.claude/` dirty → silent
- untracked `src/` file → reminder naming it
- code + PROGRESS.md dirty → silent
- run from `C:/` with `CLAUDE_PROJECT_DIR` → silent

Then `pnpm verify`.

---

## 2026-09-16 — Phase 2, Piece 1: closer follow camera

**Result:** the skater is ~1.7× taller on screen (≈ 40% of frame height at 1280×720, was ≈ 25%). FOV stays 60°. The horizon and look-ahead are unchanged, so you see obstacles just as early.

### What changed

- **`render/view.ts`:** camera eye `(x·0.65, 3.6, 6.4)` → `(x·0.7, 2.8, 4.2)`; look target `(x·0.8, 1.3, −9)` → `(x·0.85, 0.8, −9)`.
  - The lower look target tilts the view down so the board clears the bottom edge.
  - Lateral follow is a touch stronger, so lane changes keep the skater centred at the closer distance.
  - I didn't narrow the FOV: that would magnify the road ahead too and crop the side lanes.
- **Screenshot baselines** at seed 42 t = 0/10/30/60 regenerated on purpose.

### Verified

- **`pnpm verify` → exit 0:** vitest 268 passed + 1 skipped; playwright smoke 9/9. Draw calls are still 59 at t = 60.
- **Before/after sheet:** `tmp/camera/compare-seed42.png`. Raw frames are in `tmp/camera/{before,after}/`.

### Known gaps

- Coins you've already passed in the side lanes still pass close to the camera in the bottom corners (t = 30). This was already there before and is less visible now.
- **Playtest note:** `http://localhost:5173/?seed=42`. Check that jumps over the tall bars and lane changes at the edges don't feel cramped.

---

## 2026-09-16 — Fix: missed coins looming past the camera

**Bug:** coins and pickups the player didn't collect stayed drawn until their chunk recycled. At the closer camera (Piece 1), they passed right in front of it as large discs in the bottom corners (seed 42, t = 30).

- **Fix:** `render/world-view.ts` `drawItems` skips coins and pickups more than `BEHIND_CULL` = 1.5 m behind the player.
- **Sim:** untouched. It's a render cull only.
- **Verified:**
  - `pnpm verify` → exit 0 (vitest 268 + 1 skipped, smoke 9/9).
  - The seed 42 t30 baseline was regenerated on purpose; t0/10/60 still pass unchanged.
  - Before/after: `tmp/coins/{before,after}-t30.png`.
- **Done before Piece 2**, so the MiniGame refactor's regression screenshot diff can require zero baseline changes.

---

## 2026-09-16 — Phase 2, Piece 2: MiniGame framework extraction + game-select menu

**Result:** Skate Run now runs behind the `MiniGame` contract (PLAN §2.6) with no change in behaviour. `main.ts` is a game-agnostic shell. `?game=<id>` launches a game directly; without it a plain DOM menu lists the registered games. `window.__game.getActiveGame()` reports the active id. As agreed (option A), Skate Run is wrapped where it lives: no `core/`/`render/` files moved.

### What changed

- **`src/games/types.ts`:** `MiniGame<S>`:
  - the PLAN fields: `id`, `requiredSignals`, `createSim`, `createView`, `gestureProfile`
  - plus what the shell actually needed: `title`, `fixedDt`, `mountHud`, and `summary(sim)` → `{started, over, score}` (calibration gate, results/best, play again)
  - `createView(canvas)` takes the canvas rather than the sim, because the view outlives restarts
  - `GameSim` = `seed`, `step`, `getState`, `drainEvents`
- **`src/games/skate-run/`:**
  - `index.ts` wraps `core/sim`, `core/bot`, `render/view`, `render/interp` (render extrapolation), `render/hud`, plus the latency judder sample
  - `gestures.ts` holds the gesture → input map, which used to be hard-coded in `input/pose-source.ts`
- **`input/pose-source.ts`, `input/replay.ts`:** `toInput` is now a required option, so the shared input layer has no Skate Run table. `input.spec.ts` passes `SKATE_GESTURES`; assertions unchanged.
- **`src/platform/menu.ts`:** one button per game; the first button is focused, so Enter launches it.
- **`src/main.ts`:**
  - `launch(game)` mounts the signal HUD, latency overlay, pose panel and HUD in the same order as before, and starts the keyboard.
  - Bridge calls that need a run throw a clear "no game launched" error while the menu is up.
  - Events injected before launch are dropped.
- **`eslint.config.js`:** the "games never import each other" rule now applies to `src/games/*/**`, so the shared `games/types.ts` can import layer types.
- **Docs and tooling:** every e2e URL plus AGENTS §5, `/playtest` and ARCHITECTURE got `game=skate-run`; `features.json` M7.1 → done.

### Verified

- **`pnpm verify` → exit 0:** vitest 268 passed + 1 skipped (unchanged); playwright smoke 10/10, including the new `boot.smoke` menu test:
  - no `?game`: menu visible, `getActiveGame()` null, no render
  - click "Skate Run": menu gone, `getActiveGame() === 'skate-run'`, frames render, no console errors
- **Regression screenshots:** the seed 42 t = 0/10/30/60 test passes against the pre-refactor baselines. Re-running with `--update-snapshots` left all four PNGs **byte-identical**: `git status` is clean for the snapshots dir.
- **Review:** the reviewer subagent went over the diff. Fixed from its findings:
  - `drainEvents` runs every frame in the shell again (it had moved into `view.render`, so events would pile up while models load)
  - the bridge before launch throws a clear error instead of a TypeError
  - the input queue is cleared at launch

### Known gaps / deferred to Piece 4 (when a second game exists)

- **Registry typing:** `MiniGame<SkateSim>` fits `MiniGame[]` through method-parameter bivariance. Nothing checks that the sim passed to `summary`/`render`/`hud` came from the same game. The fix is a `defineGame` that closes over its sim type (a session object); it's only worth it with two games.
- **Bridge types:** `__game.getState()` and `advance()` cast to Skate Run's `SimState` (`ponytail:` comments). Widen when boxing lands.
- **Contract imports:** `games/types.ts` uses `HudExtras`, `RenderStats` and `Drawn` from `render/` and `platform/`. There's no lint rule stopping it from importing a specific game.
- **Directory-index imports:** the games rule doesn't catch `../penalty` (from `games/<id>/`). Adding `'../*'` would also block `../types`; revisit if Piece 4 moves the files.
- **The menu is mouse/keyboard only**; there's no pose selection yet.
- **Playtest note:** `http://localhost:5173/?seed=42` shows the menu → Skate Run. `?game=skate-run&seed=42` skips it.

---

## 2026-09-16 — Phase 2, Piece 3: local 2-player (Skate Run)

**Result:** `?players=2` runs two independent Skate Run runs from one camera on one seed, split screen. Bodies are assigned to players by screen half with hysteresis. If only one body is visible for > 2 s, both runs pause. All five agreed defaults are implemented as listed:

1. own 0.7 s pause per player + pause both after > 2 s
2. shared calibrated start, per-player play-again
3. no rival skater in your half
4. keyboard → P1 only
5. lean lanes forced in 2P

### What changed

- **`src/pose/players.ts`:**
  - Splitter: a body = all 4 torso landmarks visible (the gesture engine's presence rule).
  - Two bodies → sorted by mirrored x, screen-left = P1.
  - One body → keeps the player it was nearest to within `trackingLostMs`, and switches only past center ± 0.06. When it crosses over, its old slot is forgotten.
  - `createPauseBoth(2000)` pause/resume rule.
- **`src/input/pose-players.ts`:** splitter → one `pose-source` (gesture engine + calibration) per player, plus pause-both. A player's own RESUME is held back while both are paused.
- **`input/replay.ts`:** now returns `PosePlayers` (with a `players` option), so replay goes through the same split as the camera.
- **`src/main.ts`:** `Player[]` runs (sim, queue, signals, HUD, results/best).
  - The calibration gate is decided per run, but a fresh run waits for every player.
  - Latency/judder instrumentation tracks P1 only.
  - Bridge: `getPlayerCount()`, `getState(i)`, `getSignals(i)`, `inject({…, player})`; `setSeed`/`advance` apply to all players.
- **Rendering:**
  - `render/view.ts`: one renderer and one scene. For each player, world + skater are updated from that sim and drawn into a scissored half (`useSlot`, whole-pixel slots). `renderer.info` is summed across slots.
  - `games/types.ts` `GameView.render(sims[])`.
  - HUD `.hud` is now `absolute`, so it can live in a `.player-hud` half box; 1P layout is unchanged.
- **Test assets:**
  - `scripts/make-placeholder-clip.mjs` also builds `tests/e2e/assets/placeholder-two-people.mjpeg` (same Apache-2.0 source; listed in `CREDITS.md`). Regenerating left the 1-person clip byte-identical.
  - `synthetic.ts` `scriptTwo()` makes two-person frames and alternates pose order per frame.

### Verified

- **`pnpm verify` → exit 0:** vitest 283 passed + 1 skipped (17 files); playwright smoke 14/14.
- **1P regression:** re-rendered seed 42 t0/10/30/60 baselines are **byte-identical** (`git status` clean on the snapshots).
- **Unit (TEMPORARY(synthetic-fixtures)):**
  - Splitter: array order, hysteresis walk, detector miss keeps identity, forget after 700 ms, partial torso = no body.
  - Pause-both timing.
  - Exact per-player event sequences through the real gesture engines: P1 `LANE_LEFT, JUMP`; P2 `LANE_RIGHT, SLIDE_START, SLIDE_END`.
  - Short dropout pauses only that player; long dropout pauses both; a player back early can't resume both; zones → lean warning.
- **e2e `tests/e2e/two-players.smoke.spec.ts`:**
  - Replay of a synthetic two-person fixture: exact per-player event lists (P1 `LANE_LEFT, JUMP`; P2 `PAUSE, RESUME, LANE_RIGHT`), both calibrated, lanes −1/+1, jumps 1/0, two HUDs. Stress-run 6× in parallel: stable.
  - Manual clock, seed 42, P2-only lane change: P1 `running`, 70 m, 6 coins; P2 `over` at 56 m, 0 coins. Keyboard moves only P1.
  - Split-screen screenshot baseline `two-players-seed42-t10.png` (bots).
  - The first version of the replay test also asserted P2 crashing. That failed under parallel load, because in a realtime replay the lane change lands at a timing-dependent distance. Collision/score independence moved to the deterministic manual-clock test.
- **Perf, 1920×1080, RTX 4060 Laptop, two bodies on the fake camera, bots driving both runs, measured serially:**

  | | draw calls | triangles | render fps | pose fps | bodies |
  |---|---|---|---|---|---|
  | 1 player (existing test) | 57 | 614k | 59–60 | 27–31 | 1 |
  | 2 players | **110–114** | 1.13–1.26 M | 59–60 | **25–30** (median 25–26) | 2 in 15/15 samples |

  Estimated 110–120 draw calls → **came in at 110–114**, i.e. exactly 2× the 1P scene. The real cost is pose inference: about −4 pose-fps with two bodies, roughly +7 ms sampling interval.
- **Review:** the reviewer subagent went over the diff. Fixed:
  - own RESUME breaking pause-both
  - splitter vs engine presence mismatch
  - one missed frame resetting hysteresis
  - global calibration gate freezing a run in progress
  - pause-both updating while stopped
  - player init order
  - P2 events in latency stats
  - fractional viewport widths
  - test naming, zones test, TEMPORARY tag

### Known gaps

- **TEMPORARY(synthetic-fixtures):** the replay e2e uses synthetic frames and the perf test a composited clip of one person twice. Replace them with `two-players.json` and a real two-person clip. Two real people standing close (PLAN §1.1: ~75 cm apart) may drop detections, which these tests can't show.
- **Latency not re-measured with 2 bodies.** The pose-fps drop suggests ~+7 ms of sampling delay. Run `pnpm latency:pipeline` with a real 2-person setup.
- **Pause-both is edge-triggered.** A player who is on the results screen, or who starts a new run while both are paused, isn't paused again. Rare; make it level-based if playtests hit it.
- **Lone-body switching** uses the fixed center line even if both players last stood in the same half (`ponytail:` note in `players.ts`).
- **No rival skater** in your half, as agreed; ghost later if wanted.
- **The narrower half-screen aspect** (640×720 at 720p) crops the sides of the street. Maybe widen the FOV for 2P after a playtest.
- **Playtest note for Jorge:** `http://localhost:5173/?game=skate-run&players=2&seed=42`. Stand side by side about 1 m apart and both hold still to calibrate. Check:
  - assignment stays put when one person leans across the middle
  - stepping out < 2 s pauses only you, > 2 s pauses both
- **Artifacts:** `tmp/two-players/replay.png`, `tests/e2e/two-players.smoke.spec.ts-snapshots/two-players-seed42-t10-smoke-win32.png`.

---

## 2026-09-16 — Phase 2, Piece 4: Boxing

### Step 1 — Research: how Wii Sports Boxing actually plays

Sources: [StrategyWiki](https://strategywiki.org/wiki/Wii_Sports/Boxing) and [Wii Sports Wiki](https://wiisports.fandom.com/wiki/Boxing_(sport)) (both blocked my fetcher; content via search snippets), [MiiWiki](https://miiwiki.org/wiki/Boxing), [Ducksters tips](https://www.ducksters.com/games/wii-sports-boxing.php), [GameFAQs TKO Q&A](https://gamefaqs.gamespot.com/wii/683180-wii-sports-wii-sports-resort/answers/442032-how-do-you-do-a-tko-in-boxing).

Confirmed:

- **Controls:** each hand (Wiimote / Nunchuk) punches on its own. Straight = thrust forward; hook = swing sideways; uppercut = start low, swing up. Tilt both left/right = dodge (sway); hold both upright near the face = guard high, flat = guard body.
- **Health:** a pie of **10 segments** per boxer. Harder punches take more pieces. In the original, a boxer needs a certain number of hits before the pie drops; Club changed it to drop on every hit.
- **Punch recovery:** "the harder the punch the longer it takes your boxer to recover"; "wait until your glove stops moving, then punch again". Wild flailing doesn't register. Rhythm is the skill.
- **Counter:** holding your guard and dodging a hard punch at the last moment briefly slows the game so you can throw a hard counter. Jabs can't knock you down; hooks, uppercuts and counters can.
- **Dizzy:** enough head hits make a boxer dizzy (stars): **guard dropped, can't punch, can only dodge**. In Club it lasts a short time.
- **Knockdown:** pie empty → down. The announcer counts to **10**; not up in time = KO, and the match ends. Each knockdown makes getting up less likely, and a boxer who gets up has **max health 2 segments lower**. **Three knockdowns = TKO.**
- **Match:** **3 rounds of up to 3 minutes**; a KO ends it. If it goes the distance, it's a decision on points.

Not confirmed (brief vs. sources):

- **Stamina drain from missed/blocked punches:** no source says Wii Boxing drains the *attacker* for whiffs. That's a Punch-Out!!-style rule. It's in the brief, so I keep it, but small (see design).
- **"Doesn't recover from dizzy until knocked down":** sources say dizzy is triggered by head hits and (in Club) wears off after a short time. The brief chains dizzy → knockdown. I follow the brief: dizzy = stamina at zero, and the next clean hit knocks you down. Round end also clears it, so nobody stays dizzy forever if the other side stops punching.
- **Decision:** Wii scores "on points" (formula unpublished). Per the brief, knockdowns decide it first, then clean hits landed, then a draw.

**Result:** `?game=boxing` is a playable Wii-Sports-style boxing match on pose, keyboard or bot input. 1P is against a reactive bot; `?players=2` is one shared match with split screen. The Piece 2 leftovers are closed (defineGame typing, generic `getState`, folder-index lint gap). `pnpm verify` is green. **The pose thresholds are untuned:** they're set from synthetic poses only (see playtest note).

### Step 2 — Design decisions (made without a checkpoint, as asked; final values, revisions marked)

**Gesture mapping (pose → events), `pose/fists.ts` + existing detectors:**

- **Punch:** each wrist on its own. Signal = the wrist's **3D speed relative to the nose** (x aspect-corrected, y, MediaPipe z × `zWeight`), in calibrated torso lengths/s, over a 70 ms window.
  - Fires when the fist is armed, beyond `rearm` (0.6 torso) from the nose, faster than `speed` (2.5/s), and not mostly downward (dropping the hands isn't a punch).
  - *Revised during build:* the first design used radial speed away from the face. Writing the tests showed it misses hooks (they sweep *around* the head) and uppercuts (they start by moving *toward* the chin). So it's total speed plus the gates.
  - No punch-type classifier. The event carries `aim = {x, y}`: the unit direction of that motion in the puncher's frame (+x = puncher's right, +y = up). The sim reads the vector directly.
- **Recovery (the Wii "wait until the glove stops"):** a fist disarms when it fires. It re-arms only when the wrist is back within `rearm` of the nose **and** nearly still (< `rearmSpeed` 1/s), so the retraction can't fire. A second, independent gate lives in the sim: a fist is busy for `travel + retract` seconds, so keyboard and bot follow the same rhythm.
- **Guard:** both wrists within `guard.enter` (0.35 torso) of the nose → `GUARD_START`; either past `guard.exit` (0.45) → `GUARD_END`. Tracking loss or recalibration also sends `GUARD_END`.
- **Dodge:** reuses the lean detector (`LANE_LEFT/RIGHT` → `DODGE_LEFT/RIGHT`) and the slide detector (`SLIDE_START` → `DUCK`). A dodge is a timed move in the sim (0.45 s), like Wii's sway. No new "held" state to sync.
- **Known risk:** a big hook rotates the shoulders and could cross the lean threshold, giving a false dodge. The sim makes it harmless mid-punch: you can't dodge while a fist is travelling. Needs a real-camera playtest.

**Sim rules (`core/boxing/`), one shared state for both boxers:**

- **Stamina** = Wii's pie: 10 segments.
  - A clean hit taken: −0.7. A counter hit (within 0.8 s after dodging a punch): ×1.5 = −1.05. A blocked hit taken: −0.15.
  - *Revised:* the first cut was −1 / −0.25. In bot-vs-bot, 10/10 matches then ended by TKO inside round 1 (~45 s).
  - A whiffed punch costs the attacker −0.3 (the brief's rule, kept small since Wii doesn't do this).
  - Regen: +0.5/s after 1 s without punching or being hit; landing a clean hit gives +0.2.
- **Dizzy** at 0 stamina: guard doesn't count, can't punch, can still dodge, no regen. The next clean hit is a knockdown.
  - *Added after review:* if **both** boxers are dizzy (whiffs and blocks can empty both pies), neither could ever act until the bell, so both come round at 1 segment.
- **Aim vs. defence, straight from the vector:**
  - A side dodge is caught only by a punch sweeping toward that side (lateral > 0.5).
  - A duck is caught only by an uppercut (up > 0.5).
  - The guard stops everything except uppercuts (up > 0.5 splits the guard).
- **Knockdown:**
  - Counted 1…10, one count per 0.8 s.
  - Get-up count = `2 + 3·(knockdowns−1) + floor(6·rng)`, where rng is seeded from (seed, tick). First knockdown gets up at 2–7; second at 5–10, and 10 = KO. So each knockdown makes getting up less likely.
  - Getting up: max stamina −2 (Wii), refilled to the new max.
  - 3 knockdowns = TKO.
- **Match: 3 rounds × 60 s**, with a 4 s break (stamina refilled to each boxer's current max, dizzy cleared) and a 3 s intro. A KO or TKO ends it early. If it goes the distance, the winner is whoever suffered fewer knockdowns, then more clean hits landed, else a draw.
  - **Why 60 s:** full-body shadow-boxing is far more tiring than flicking a Wiimote. One minute is a standard amateur/fitness boxing interval. At roughly one clean hit per 1.5–2 s from an active player, 60 s gets through the 10-segment pie about once, so a round usually has a knockdown and a match ~1–2. A full match is ≤ 3.5 min including breaks and counts.
- **Bot:** stateless, a pure function of (state, seed, tick), so it can't break determinism.
  - It reacts once per thrown punch, 0.08 s after the punch leaves (`reactS`): guard 55 %, sway 20 %; when dizzy, sway 70 %.
  - Otherwise, on a 0.1 s grid, it drops its guard and punches in 15 % of decisions (about 1.2 punches/s, a sustainable human pace): straight 60 %, hook 25 %, uppercut 15 %.
  - *Revised:* reacting on the 0.1 s grid missed most 0.18 s punches; the first 35 % punch rate was too lethal.

**Two-player:** Piece 3 only supported "N independent runs" (one sim per player). Extended the shell with `MiniGame.sharedSim`: one sim for all players. The shell tags each queued event with `player`, steps each distinct sim once, restarts it for everyone, and passes `[sim, sim]` to `view.render`, so slot *i* draws from boxer *i*'s point of view. Details under "What changed".
- **Fairness (found in build):** punches that land on the same tick used to resolve boxer 0 first. Bot-vs-bot won 9/10 for boxer 0, then 31/9 for boxer 1 with tick-parity alternation (both bots punch on the same grid). Now the order is a seeded coin flip per tick: **32–28 over 60 seeds**, average match 101 s, results TKO 50 / KO 9 / decision 1, matches ending in round 1: 17, round 2: 39, round 3: 4 (tuning measured before the two review fixes; the rules they touch rarely trigger between bots). Humans punch less relentlessly than two bots, so expect longer matches.
- **Pause in 2P (added after review):** PAUSE/RESUME come from each player's own tracking, but the match is shared. `pausedBy[player]` holds it until every player who paused is back.
- **Assets:** nothing new. Boxers reuse the CC0 Quaternius `Casual_Hoodie` (`SkeletonUtils.clone`, already in `three`) with the upper-arm bones scaled to ~0, plus floating sphere gloves. Wii Sports Miis have no arms either. **No download, no CREDITS change, no new dependency, no ADR.**

### What changed

- **Core:**
  - `src/core/input.ts`: new events `PUNCH_LEFT/RIGHT`, `GUARD_START/END`, `DODGE_LEFT/RIGHT`, `DUCK`, plus optional `aim` and `player` on `InputEvent`.
  - `src/core/boxing/`: `boxing.config.ts` (all rule tuning), `types.ts`, `sim.ts` (tick, rules, `createBoxingSim`), `bot.ts`, `sim.spec.ts`.
- **Pose:**
  - `body.ts`: tracks z (One Euro) and exposes both wrists in `Measures`.
  - `fists.ts`: the new detector.
  - `gestures.ts`: `PUNCH_*`/`GUARD_*` events with `aim`; `SignalFrame` gains `fistL`, `fistR`, `guard`; `GUARD_END` on tracking loss or reset.
  - `gestures.config.ts`: `fists` block.
  - `testdata/synthetic.ts`: boxing arms (`fists: 'ready'|'guard'`, `punchL/R`, `hookR`, `upperL`).
- **Input:**
  - `pose-source.ts` passes `aim` through.
  - `keyboard.ts` takes a `KeyMap {down, up}`. `SKATE_KEYS` is the default, so Skate Run is unchanged, and any held key with an `up` event is released on `stop()`.
- **Games:**
  - `types.ts`: property-style members, `sharedSim`, `keys`, `createSim(seed, {…, players})`, `mountHud(root, player)`, `summary(sim, player)`, `GameSim.getState(): {seed, t}`, and `defineGame` / `OpaqueSim` / `RegisteredGame`.
  - `registry.ts`: `GAMES`.
  - `skate-run/index.ts` default-exports `defineGame`.
  - `boxing/` (`index.ts`, `gestures.ts` with the gesture map and keys).
- **Render:**
  - `boxing/view.ts`: ring, 2 boxers, per-slot eye camera.
  - `boxing/boxer.ts` and `boxing/hud.ts`.
  - Exported for reuse: `useSlot` (view.ts), `rig` (skater.ts), `loadModel` (models.ts, one model with the box fallback; `loadModels` now uses it).
- **Shell (`main.ts`):**
  - Imports the registry.
  - `restart()` and `eachSim()` handle shared sims.
  - Queued events are tagged with `player`.
  - The keyboard is created at launch with the game's keys.
- **Bridge (`debug-bridge.d.ts`):** `getState<S>(player?)`; `inject` accepts `aim`. The three Skate e2e specs now say `getState<SimState>()`, and `advance()` no longer casts.
- **Lint (`eslint.config.js`):**
  - Games rule is a regex, `^[.][.]/(?!types$|[.][.]/)`, so `../boxing` (a folder index) is caught. A gitignore group `'../*'` also matched the `..` parent of `../../core`, which is why it's a regex.
  - `games/types.ts` may not import `./<game>`.
  - `core/*/**` may import `../input` (core's contract), but `core/` itself may not (the reviewer caught that loophole).
- **Docs:** ARCHITECTURE (module map, rules, new "Registry typing" and "Boxing" sections), AGENTS §5, features.json M7.6 and M7.7.

### Verified

- **`pnpm verify` → exit 0:** tsc, eslint, vitest 306 passed + 1 skipped (18 files), playwright smoke 19/19. After the review fixes and the boot-poll fix: **3 consecutive green runs**.
- **Unit, `src/core/boxing/sim.spec.ts` (14 tests):**
  - Clean hit after travel time.
  - Recovery (the same fist is ignored until ready; the other fist is free).
  - Block drain; an uppercut splits the guard.
  - A sway beats a straight → whiff + counter ×1.5.
  - Hook-into-sway and uppercut-vs-duck from the aim vector.
  - Dizzy → no punching, dodging works, no regen → knockdown → get up with max −2.
  - Count of 10 = KO; 3rd knockdown = TKO.
  - Rounds, break refill, decision by knockdowns then hits, draw.
  - 2P pause needs both players back.
  - Both-dizzy clinch.
  - Pause/intro.
  - Bot vs bot reaches a result using every mechanic.
  - **Determinism:** same seed → same hash, other seed differs, 1/120 s frames = 1/60 s.
  - The 1P bot defends > 30 % of off-grid punches.
- **Unit, `src/pose/fists.spec.ts` (7 tests, TEMPORARY(synthetic-fixtures)), exact sequences through the real gesture engine:**
  - Idle 5 s → nothing.
  - Straight → one `PUNCH_RIGHT`/`PUNCH_LEFT` with |aim| < 0.5.
  - Out → half back → out = one punch; full returns = two.
  - A slow 1.2 s reach = nothing.
  - Right hook → aim.x < −0.5; left uppercut → aim.y > 0.5.
  - Guard start/end.
  - Tracking loss mid-guard → `GUARD_START, GUARD_END, TRACKING_LOST`.
- **Unit, `tests/unit/boundaries.spec.ts`:** `../boxing`, `../boxing/index` and `../boxing/gestures` rejected from `games/skate-run`; `../types` allowed; the contract can't import `./boxing`; the registry can; `core/boxing` → `../input` OK; `core/` → `../input` rejected.
- **e2e, `tests/e2e/boxing.smoke.spec.ts` (5 tests; stress-run `--repeat-each 4 --workers 6` → 20/20):**
  - The menu launches Boxing.
  - 1P manual clock, seed 42: the X key puts boxer 0's right fist out; 12 s later the bot has landed hits.
  - 2P: an injected P2 punch lands on boxer 0 for exactly −0.7; `getState(0)` deep-equals `getState(1)`; Z from the keyboard drives boxer 0; nobody else punches (no bot in 2P); two HUDs.
  - Realtime pose replay of a synthetic fixture: events exactly `PUNCH_RIGHT, PUNCH_RIGHT, GUARD_START, GUARD_END`, straight aim |x| < 0.5, hook aim x < −0.5; calibration opened the gate (tick > 0).
  - Screenshot baselines: `boxing-seed42-t8`, `boxing-seed42-down` (the count running), `boxing-2p-seed42`. Draw calls < 150.
- **Skate Run regression:** `render.smoke` seed 42 t0/10/30/60 and `two-players` baselines pass unchanged (`git status` shows no snapshot changes for them).
- **Perf** (1920×1080, RTX 4060 Laptop, bots, no pose worker):

  | Mode | fps | draw calls | triangles |
  | --- | --- | --- | --- |
  | 1P | 60 | 43 | 15k |
  | 2P | 60 | 86 | 31k |

  Pose + boxing together isn't measured separately; Skate's pose-perf test covers the worker cost.
- **Visual check** of screenshots at intro/fight, dizzy (stars), knockdown (count, Death pose), TKO results card and 2P split, in `tmp/boxing/*.png`.
  - **Fixed from that check:** the player's own gloves in guard covered the opponent. They're now low and wide, fading back to centre as a punch extends.
- **Verify flake, `boot.smoke` "renders frames":** failed 2 of 6 full `pnpm verify` runs, both times stuck at 1 frame when its **5 s default** poll expired, at smoke-suite startup.
  - It never failed in 5 standalone smoke runs, nor after running vitest and then booting.
  - On a fresh server (`vite --force`, :5174) Skate Run boots in 2.2 s with no dep reload. Even idle, a fresh page stalls ~1.7 s on first-frame shader compile.
  - Probable cause: the new boxing spec adds GPU pages that boot in parallel with it at startup. Not proven; I couldn't reproduce it outside verify.
  - Fix: its poll now uses the same 20 s startup budget as every other boot poll (render, two-players, boxing). The assertion is unchanged.
  - I first blamed a dep re-optimization on the long-running :5173 dev server (started 12:16, before this session; left running). The second failure ruled that out as the whole story.
- **Review:** the reviewer subagent went over the diff. Fixed from its findings:
  - the PROGRESS numbers were stale
  - one player's RESUME restarted a 2P match while the other was still out
  - both-dizzy stall
  - untested `GUARD_END` on tracking loss
  - `Event` type name shadowing the DOM type
  - core `../input` lint loophole

### Known gaps

- **Pose tuning is synthetic-only (TEMPORARY(synthetic-fixtures)).** `fists.speed`, `rearm`, `rearmSpeed`, `guard.*` and `zWeight` have never seen a real person. Concerns:
  - MediaPipe wrist z is noisy.
  - A straight punch at the camera foreshortens and may drop wrist visibility.
  - A natural boxing stance may sit inside `guard.enter` (always guarding).
  - A hook's shoulder turn may cross the lean threshold. The sim ignores dodges while a fist is out, but a lean just *before* the punch would still sway.

  Needs a recorded `boxing.json` and a clip.
- **Keyboard punches are straights only** (`ponytail:` note in `games/boxing/gestures.ts`), so on keyboard you can't catch a swaying or ducking bot with hooks/uppercuts.
- **2P half-screen:** own gloves sit mostly off the narrow 640 px slot; scale the offset by aspect if playtests miss them.
- **No sound or hit-stop / slow-motion counter** (Wii slows the game on a last-moment dodge). `drainEvents()` output is ready for juice later.
- **Latency/judder instrumentation** reports nothing for Boxing (`render` returns null: there's no forward motion to judge).
- **The menu is still mouse/keyboard only.**
- **Playtest note for Jorge:**
  - **1P:** `http://localhost:5173/?game=boxing&seed=42&debug=1`. Stand ~2.5 m back in a boxing stance and hold still to calibrate. Throw straights, hooks and uppercuts. Check:
    - one punch = one event
    - pulling back never fires
    - rapid flailing without returning to the face does **not** register
    - fists at the chin = guard, while your normal stance is *not* guard
    - lean = sway, and duck works
  - The debug HUD's signal plots don't draw `fistL`/`fistR` yet; read them via `__game.getSignals()`.
  - **2P:** `?game=boxing&players=2`, standing side by side facing the camera: each half shows your boxer's view.
  - **Keyboard:** `?game=boxing&input=keyboard`: Z/X punch, ↑ guard, ←/→ sway, ↓ duck.

## 2026-09-16 — Boxing playtest bugs: punches, 2P detection, skeleton overlay

### 1. Punches never registered: where it broke

The break was in the gesture engine, `pose/fists.ts`, **before any event existed**. `getEvents()` never showed a `PUNCH_*`; the shell → sim path was fine (keyboard and replay e2e both drive it).

- **Cause:** a wrist armed only when its **3D** distance from the nose was < `rearm` (0.6 torso).
  - That distance included `wrist.z − nose.z`.
  - MediaPipe z is relative to the hip midpoint, and on Jorge's real recording (`~/Downloads/pose-2026-09-16T18-42-19-146Z.json`) that gap is 0.33 / 0.87 / 3.1 torso (p10/p50/p90).
  - Result: **0 of 1010 wrist-frames could arm**, so no punch or guard could ever fire.
  - The synthetic poses put the nose at z = 0, which hid it.
- **Fix:**
  - The face zone and guard use 2D distance.
  - Depth only counts as displacement from where the fist rested when it armed (`restZ`).
  - Arming needs the wrist near the face and slow for `rearmMs` (100 ms, new config). This keeps "out → half back → out" as one punch now that the half-back point is inside the 2D zone.
- **Regression:** `testdata/synthetic.ts` puts the nose at z = −0.3. Four `fists.spec` tests failed with the old code and pass with the fix.
- **Real-data check:** the same recording through the fixed engine arms and fires (one `PUNCH_RIGHT` during an arm swing in a Skate Run session; before the fix nothing could fire). True-positive rate on real punches is still unmeasured: there is no boxing recording.

### 2. Two players

- **URL:** `?game=boxing&players=2`. The menu has no player-count choice, so launching Boxing from the menu is always 1P.
- **`numPoses`:** main.ts passes `numPoses: playerCount` to the worker. Verified with the two-person fake camera: `getPoseStats().lastPoseCount === 2`, and `getSignals(0)` / `getSignals(1)` are both `tracking: ok`, one per half (`tmp/diag/boxing-2p-debug.png`).
- **Not a bug in the pipeline, as far as I can find.**
  - In 2P each half shows your opponent from your point of view, so one boxer per half is expected.
  - If both players stand close to the camera, the splitter needs both shoulders **and hips** visible (≥ 0.5) per body. Otherwise that body doesn't count.

### 3. Skeleton overlay

- **With `?debug=1` it was never broken** (verified in boxing 1P and 2P: `tmp/diag/boxing-1p-debug.png`).
- The raw-feed screenshot matches the non-debug compact thumbnail, which has never drawn the skeleton since M1. `pose-panel.ts` is unchanged since `f7a4432`, so this is not from the HUD refactor.
- **Changed:** the skeleton is now drawn in the compact thumbnail too, in every game. The heatmap and stats stay debug-only (`tmp/diag/boxing-1p-compact.png`).

### Verified

- `pnpm verify` → exit 0: vitest 306 passed + 1 skipped; playwright smoke 19/19.

## 2026-09-16 — Features: 2P auto-pause, hand-hover menu (Piece 2b), cabezota faces (Piece 5, Boxing)

### 4. Auto-pause when a second body is missing

- **Already worked in every game, no code change.** The rule lives in the game-agnostic `input/pose-players.ts` and emits `PAUSE`/`RESUME` for both players.
  - Boxing's shared sim holds the match until every `PAUSE` is answered.
  - One player's own tracking loss already pauses the match after 0.7 s.
  - After 2 s the pause-both rule takes over, so that player coming back alone can't resume it.
- **New e2e** `boxing.smoke` "2P pose replay: one body missing > 2 s…": events exactly `1:PAUSE, 0:PAUSE, 1:PAUSE, 0:RESUME, 1:RESUME`, phase `paused` in between.

### 5. Hand-hover menu

**Design / estimate (given before building; it matched the spec, so no stop):** ~400 lines incl. tests, about half a day. The cost is mostly the camera moving to boot, not the cursor.

- **Cursor:** each body's higher raised wrist maps from a box around its shoulders (a "physical interaction zone", in shoulder widths) onto the whole screen, One Euro smoothed.
  - Hands below mid-chest = no cursor.
  - Bodies split by screen half with the same splitter as 2P games, so each player gets their own cursor (P1 cyan, P2 amber).
- **Dwell:** 1 s on the same button clicks it once; leaving re-arms. Mouse/keyboard unchanged.
- **Player count:** the menu gains a "Players 1 | 2" choice (hoverable), since 2P used to be URL-only.

**What changed:**

- `pose/hand-cursor.ts` (+ spec): `handPoint`, `createHandCursors`, `createDwell`.
- `gestureConfig.cursor`: zone, `lowered`, filter, `dwellMs`.
- `platform/menu.ts`: player-count buttons, cursor dots with a dwell ring.
- `main.ts`:
  - With `?input=pose` the camera opens at boot, with `numPoses` 2 on the menu.
  - Frames go through one `frameSink` (menu → game).
  - Launching restarts the worker when the game needs another body count (`pose-panel setNumPoses`; checked: menu 2 poses → 1P Boxing 1 pose, tracking ok).
  - `playerCount` is now set at launch.
- `window.__game.injectPose(frame)` feeds frames like the camera (tests).

**Verified:**

- `hand-cursor.spec` (5 tests):
  - hands down → null
  - left/right/up mapping
  - zone center → screen center
  - 2 bodies → screen-left is P1
  - dwell timing/re-arm
- e2e `menu-hover.smoke` (2 tests):
  - a half dwell selects nothing
  - a full dwell on "2" then Boxing launches Boxing with 2 players
  - hands down shows no cursor, and the mouse still works

  It caught a real bug: the cursor's `display: grid` beat `[hidden]`.
- Menu with the fake 2-person camera: `tmp/diag/menu-camera.png`.

**Known gaps:**

- **Zone and dwell values are untuned**; a real person may find the box too big or small.
- A lone player standing right of center is labelled P2 (cosmetic).
- If both hands are raised, the cursor follows the higher one and can flip.
- **Playtest:** `http://localhost:5173/?debug=1` → raise a hand, hover "2" then a game for 1 s each. Try it with two people.

### 6. Cabezota faces (Boxing)

**Design / estimate:** ~250 lines, about half a day. No new model or dependency.

- **Crop:**
  - Square around the nose, sized 2× ear-to-ear (eyes ×3.4 when an ear is hidden), lifted 15 % toward the forehead.
  - Oval-masked into a 192 px canvas at ≤ 15 Hz.
  - Box smoothed with the landmarks' One Euro filter.
- **Head:** the rig's `Head` bone scaled ×1.8, plus a sphere-cap mesh (unlit, alpha-tested) textured with the crop. The cap sits at the head bone but keeps the boxer's facing.
- **Who wears what:** in 2P each boxer wears its player's face. **In 1P both boxers wear P1's face (you fight yourself)**, because your own boxer is only gloves from your view. Changing that is one expression in `render/boxing/view.ts`.

**Found while building:**

- **Cropping from the live `<video>` put the face half out of the box.** The landmarks are ~100 ms older than the current video frame.
  - The pipeline can now snapshot the exact frame it sends to the worker (`snapshot`/`frameImage`).
  - It only starts when a game sets `faces: true`, so Skate Run pays nothing.
- **A fixed 0.35 blend lagged** a swaying head by half a face. Replaced with the One Euro filter (`tmp/diag/crop.png` centered).

**What changed:**

- `pose/face-crop.ts` (+ spec for `faceBox`), `render/big-head.ts` (`FaceFeed`, `createBigHead`), `boxer.ts`/`view.ts` wiring.
- Contract: `MiniGame.faces?` and `createView(canvas, faces?)`.
- `PosePlayers.onFrames` (per-player split frames).
- `pipeline` snapshot option.

**Verified:**

- Screenshots with the fake camera: 1P `tmp/diag/face-1p-zoom1.png`, `-zoom3.png`; 2P `tmp/diag/face-2p-zoom2.png`.
- Perf at 1920×1080 with crops on: 1P 59–60 fps, pose 27–30; 2P 59–60 fps, pose 22–27.
- `boxing-seed42-*` baselines still pass within their 1 % tolerance (the head is a few hundred px), so they were not rewritten.

**Known gaps:**

- **No automated test that a face reaches the head:** replay has no camera image, and the fake clip moves.
- The crop edge shows background (no segmentation).
- Head turns aren't mirrored on the cap.
- Dim rooms give dark faces (unlit material, by design).

**Skate Run:** the rig code is reusable as-is (same `Head` bone, same helper). But the follow camera sits behind the skater, so the face is never on screen. This is separate work: a front-facing moment (results turnaround, intro shot) or a camera change, not a one-liner.

**Playtest:** `http://localhost:5173/?game=boxing` (and `&players=2`). Check that the face stays centered through sways and ducks, and whether ×1.8 reads as fun. `HEAD_SCALE` and `CAP_*` are in `render/big-head.ts`.

### Verified (whole session)

- `pnpm verify` → exit 0: vitest 314 passed + 1 skipped (20 files); playwright smoke 22/22.
- One earlier run failed the 2P Skate Run perf test: a single pose-fps sample of 16 while 3 new GPU pages ran in parallel. The rerun alone had min 23, and the next full verify was green (min 21). Watch it.

## 2026-09-16 — Pose mirroring (M7.10): continuous PoseState, handedness, boxing tuning harness

Branch `feat/pose-mirroring`. Upstream of rendering only: no files under `src/render/` or `assets/` were touched. Codex binds the rig on `feat/visual-expressiveness`.

### 1. Continuous pose for mirroring (`src/pose/pose-state.ts`)

**Research:** the standard approach is rotation retargeting. Kalidokit, three-mediapipe-rig and three-vrm all take bone directions from landmark pairs and rotate the rig's rest bones onto them (`Quaternion.setFromUnitVectors`), or use two-bone IK on the wrists. I output both forms in the rig's own axes, so the renderer needs no pose-layer knowledge.

**Contract:** `SignalFrame.pose: PoseState | null` every frame. The shell passes `poses[i]` as the new 3rd argument of `GameView.render(sims, interpolate, poses)`; the type is re-exported from `games/types.ts`. Full shape, axes, units and binding recipe: `docs/ARCHITECTURE.md` "Pose mirroring". Summary:

- **Axes:** +x = player's left, +y up, +z forward (the boxer rig's frame).
- **Lengths:** torso lengths.
- **Rotations:**
  - `torso`/`hips`/`head`: Euler YXZ + quaternion, as deltas from the calibrated stance.
  - `arms[0|1]`: `upper`/`fore` unit directions, `upperRot`/`foreRot` swings from a hanging arm, and `wrist` as the IK target.
- **Live punch channel:** `extension` (0 folded … 1 straight), `reach` (0 … 1 forward) and `speed`, continuous next to the unchanged `PUNCH_*` events.
- **Null** when not calibrated, tracking is lost, or the pose is older than `trackingLostMs` (the renderer falls back to sim animation).

**Found on real data (Jorge's Skate Run recording):**

- **MediaPipe z is unusable for bone geometry.** A 3D upper arm reads 1.59 torso lengths at p90 (0.56 in 2D), and straight hanging arms read 70–87 % straight. Depth is reconstructed from bone lengths instead: `gestureConfig.pose.upperArm 0.5 / forearm 0.48`, from the recording's median 2D lengths.
- **Torso yaw from shoulder width alone was wrong:** ±1 rad, sign flipping every frame while facing the camera. It is now weighted by the nose's sideways offset (`pose.yawNose`). Result: median |yaw| < 0.2 while facing; the two real turns read −1.10 / +1.14, agreeing in sign with the head (±1.57).
- **Torso roll read ±π through a turn** (atan2 on a flipped line). It now uses the vertical drop over the calibrated width.
- **World landmarks** (`PoseFrame.world`, metric 3D) are now sent by the worker and saved by `?record=1`, so your boxing recording lets the tool compare them against the bone model.

### 2. Handedness: what the real data says

- **Checked:** MediaPipe's left labels sit at larger raw x (`lShoulder` median x 0.524 vs `rShoulder` 0.373). This matches the anatomy for an unmirrored camera and every left/right convention in the code (fists aim, lean, cursor, synthetic poses, boxer rig: left glove on +x = screen-left from behind).
- **My first hypothesis, rejected:** MediaPipe swapping left/right labels, which would call for a "force shoulder order" fix. In the recording, the 24 frames with swapped shoulder order are a real 180° body turn at 18.5–20 s. Wrists stay continuous, and path length is 31.23 raw vs 31.37 "fixed". Wrist-only swaps by elbow proximity: 2/569 frames. **So no label canonicalization was added**; it would have broken real turns.
- **Remaining candidates** (none can be proven without a boxing recording):
  - (a) Body motion leaks into both wrists' speed, which is measured against the nose (head bobs, ducks, sways). There is now `fists.reference: 'nose' | 'shoulder'`. The default stays `nose` (no behaviour change): both give the identical single `PUNCH_RIGHT` at 14.2 s on the Skate recording, so that data can't choose.
  - (b) A driver-mirrored camera would swap every punch. Each drill below starts with a raised-left-hand marker, and the tool reports `hand ok | SWAPPED`.
  - (c) Rendering, out of my scope. Reading `boxer.ts`, the self-view left glove is on screen-left, which looks right.
- **Not verified on real punches.** There is no boxing recording yet, so true-positive rate and hand confusion are still unmeasured.

### 3. Tuning harness: `pnpm tune:boxing`

`tests/tools/boxing-tune.tool.ts`, not in verify.

- **Input:** `fixtures/pose/boxing/<drill>.json`, with the exact counts per drill encoded in `DRILLS`.
- **Per-drill output:**
  - events got vs expected, and the count error
  - the handedness marker
  - world landmarks present?
  - at each punch: aim, bone-model `reach`/`extension`, world-landmark reach
- **Also:** the Skate recording as a no-boxing false-positive check.
- **`GRID=1`:** 1080 `fists` sets (reference × speed × rearm × zWeight × velocityWindowMs × rearmMs) ranked by total count error; about 4 s per drill file. Writes `tmp/tune/boxing-<LABEL>.json`.
- **Smoke-tested only** on a throwaway synthetic `straight-right.json` in `tmp/` (8/8). Nothing was tuned on it.

### Boxing fixture protocol (for Jorge)

**Setup:** `http://localhost:5173/?game=boxing&debug=1&record=1`, default model (full), normal room light.

- Stand **2.5 m** from the camera, whole body in frame **including hips** (hips out of frame = no tracking).
- The recorder keeps the **last 30 s**: do the drill, then press `R` (or the button) right away.
- Save each file under the exact name below into `fixtures/pose/boxing/`.

**Every file starts the same way:**

1. **LEFT hand straight overhead for 2 s**, right hand down (handedness marker).
2. Drop into your normal upright boxing stance and **hold still 3 s** (calibration; the stance you calibrate in is the mirroring neutral).
3. The drill, with fists back to your chin and **still for ~0.5 s between punches**, unless the drill says otherwise.

| File | Drill | Count |
| --- | --- | --- |
| `idle-stance.json` | Stance, light bounce, small fidgets, no punches | 20 s |
| `straight-left.json` | Left straights (jab) at head height | **8** |
| `straight-right.json` | Right straights | **8** |
| `hook-left.json` | Left hooks | **6** |
| `hook-right.json` | Right hooks | **6** |
| `uppercut-left.json` | Left uppercuts | **6** |
| `uppercut-right.json` | Right uppercuts | **6** |
| `alternating.json` | L, R, L, R … straights, ~1 s apart | **5 L + 5 R** |
| `both-hands.json` | Both fists together | **5** |
| `guard.json` | Fists at chin 3 s → relaxed stance 2 s | **4 cycles** |
| `sway.json` | Lean left 1 s → center → lean right 1 s → center | **4 each side** |
| `duck.json` | Quick duck (~0.5 s down) | **5** |
| `forward-back.json` | Step forward ~50 cm, back, guard up | **4 round trips** |
| `close-alternating.json` | Same as alternating at **~1.8 m** | **5 L + 5 R** |

- If a count comes out different (you threw 7), tell me the real number; the tool's table is the ground truth.
- **Optional:** a ~10 s phone video of the alternating drill, for a fake-camera e2e: `ffmpeg -i in.mp4 -t 10 -vf scale=1280:720,fps=30 -q:v 5 -f mjpeg fixtures/video/boxing-alternating.mjpeg`.

**Then:** `pnpm tune:boxing` (current config), then `GRID=1 LABEL=grid pnpm tune:boxing`. Paste me the table, or leave the `tmp/tune/*.json` files.

### What changed

- **New:** `pose/pose-state.ts` (+ spec), `pose/testdata/real-skate-2-10s.json` (8 s excerpt of your recording, 11 landmarks, 4 decimals, 54 KB), `tests/tools/boxing-tune.tool.ts`, `pnpm tune:boxing`.
- **`body.ts`:** tracks ears and elbows too; `Measures` gains `lShoulder`/`rShoulder`.
- **`fists.ts`:** zone/guard/reach stay nose-relative; speed/aim use `fists.reference`.
- **`gestures.ts`:** `SignalFrame.pose`.
- **`gestures.config.ts`:** `fists.reference`, `pose.{upperArm, forearm, yawNose}`.
- **Worker / recorder / types:** `PoseFrame.world`.
- **`games/types.ts`:** `GameView.render(…, poses)` + type re-exports.
- **`main.ts`:** passes live, non-stale poses to `render`.
- **e2e `boxing.smoke` replay:** asserts `getSignals().pose` is present.
- **Docs:** ARCHITECTURE "Pose mirroring", features.json M7.10.

### Verified

- **`pnpm verify` → exit 0** (`tmp/verify-pose-3.log`): tsc, eslint, vitest 322 passed + 1 skipped (21 files), playwright smoke 22/22. 2P perf pose-fps 23–30, render 60.
- **Two earlier red runs, both perf gates only:**
  - `verify-pose-1`: pose smoke 18.5 pose-fps, 2P render 51 fps.
  - `verify-pose-2`: one 2P pose-fps sample of 19.
  - Both ran while the machine sat at 74 % CPU with Codex's worktree active. The same pose test passed alone, then run 3 was green.
  - An A/B on the 2P perf test with vs. without the world-landmark copy was inconclusive: the run *without* it dropped to 0–11 pose-fps. The added per-frame work is two landmark-array copies and arithmetic, far below inference cost. Watch this gate.
- **`src/pose/pose-state.spec.ts` (8 tests):**
  - three.js equivalence of the quaternion helpers
  - the **real-recording excerpt**: calibrates; pose null before, non-null after; hanging arms upper.y < −0.8, extension > 0.9, reach < 0.1, left arm upper.x > +0.2 / right < −0.2; forearms fore.y > 0.5 at GRAB; LANE_LEFT sway > 0.3; median |yaw| < 0.2
  - hand-built guard (reach < 0.05) / straight at the camera (reach > 0.99) / halfway
- **Probe** of the full real recording through the engine (every 0.5 s): numbers quoted in §1.
- **`pnpm tune:boxing`:** runs with no drills (lists missing files, no-boxing check: nose 1 / shoulder 1 punch). With a throwaway synthetic drill it gave 8/8 and a 1080-set grid in 4.6 s.
- **Not verified:**
  - real punch detection rate, hand confusion, and the `reference`/threshold choice (needs the drills)
  - world-landmark quality (needs a new recording)
  - how the pose looks on a rig (Codex)

### Known gaps

- `fists` thresholds stay synthetic-tuned (TEMPORARY). Tuning is one `GRID=1` run once the drills exist.
- **Arm depth sign is always forward** (`ponytail:` in `pose-state.ts`): a hook wind-up behind the shoulder mirrors in front.
- Head pitch isn't estimated.
- A simultaneous torso bend + turn under-reads both.
- **Calibration stance = mirroring neutral.** Calibrating bent over (as in the Skate recording at 4 s) skews the torso angles.
- No smoothing on PoseState beyond the landmark One Euro filter; the renderer should interpolate on `t` (~20–30 Hz input).

### For Codex (render binding)

Consume `poses[i]` in `GameView.render`. Your `render/boxing/pose-state.ts` adapter maps 1:1:

| Adapter field | PoseState source |
| --- | --- |
| `torso` | `torso.rot` |
| `hips` | `hips.rot` |
| `head` | `head.rot` |
| `shoulderL` | `arms[0].upperRot` |
| `elbowL` | `arms[0].foreRot` |
| `wrists[0]` | `arms[0].wrist` × rig torso length (m) |

The same axes: +x left, +y up, +z forward. Arm quats are swings from a hanging arm, not from a T-pose. Null = use the gameplay animation.

### Next

Jorge records the 14 drills → `pnpm tune:boxing` + `GRID=1` → set `fists` (and `reference`), `pose.upperArm/forearm` from the drills. Then rewire the TEMPORARY synthetic fist tests to the drills.

## 2026-09-16 — Visual expressiveness (M7.11): Codex handoff rescued, rebased, verify split

### What changed

- **Rescue:** Codex's uncommitted work in the git-ignored worktree `tmp/visual-expressiveness-worktree` is now `wip(render): unreviewed Codex handoff…`, plus the audit `docs/HANDOFF-visual-expressiveness-audit.md`. The branch is pushed to `origin`.
- **Rebased onto `main` (6708eb4):**
  - `ARCHITECTURE.md`: kept both sections.
  - `features.json`: Codex's duplicate `M7.10` is now **`M7.11`**, and `M7.9` keeps main's note.
- **Audit correction:** the "face-crop regression on main" was wrong. My temporary worktrees had no `public/models/`, which is git-ignored. With the models present, pure `main` produces live crops (GPU delegate, 30 pose-fps, test green). Retracted in the handoff note.
- **Playwright concurrency (Codex had set `workers: 1` globally):**
  - Restored parallel `smoke`.
  - Added a `perf` project that runs after smoke on one worker, holding the timing-sensitive tests: `@perf` fps/pose-fps gates (5) and `@realtime` wall-clock pose replays (4).
  - `test:smoke` = `--project=smoke --project=perf`; AGENTS §4 and ARCHITECTURE updated.
  - This also creates the `--project=perf` that `.claude/agents/perf.md` expects.
  - `PLAYWRIGHT_PORT` (Codex) is kept: another session's dev server holds 5173.

### Verified

- **Why the split and not plain parallel:**
  - Parallel runs on this machine failed 3/3 (ambient CPU ~50 % from another session's `tmp/perf-wt` bisect with 5 Vite servers): 14 pose-fps, 44 fps, 1 frame in the menu test, and replay lane changes lost (`two-players` replay `[0,0]` vs `[-1,1]`).
  - Global `workers: 1` passed 2/2.
- **Split runs:**
  - Two red runs, each on a single sample of the 2P gate (18 and 19 pose-fps; the other 14 samples were 22–30). The same gate run alone passed 2/2.
  - One red run on 53 fps / 17 pose-fps while the other session was active.
  - `tmp/verify-ve-3b.log` (load 30 %): **exit 0**, together with the live-pose change below.
- **The 2P pose-fps gate is marginal under background load.** It was already noted in the pose-mirroring entry (one sample of 19). It isn't loosened.

### Live pose in Boxing (step 3b): rewrite, not a patch

- **Removed** Codex's `render/boxing/pose-state.ts`: it used a view-construction feed, `forward` as torso units, arm swings as deltas on the idle pose, and no smoothing.
- **New `render/boxing/live-pose.ts`:**
  - `LivePose` is a structural subset of `PoseState`. `tsc` checks the Boxing view against `GameView<BoxingSim>`, so contract drift fails to compile.
  - `createLiveSmoother`: exponential easing, τ 0.08 s.
  - `createLiveFeed`: wall-clock dt, capped at 0.1 s.
- **`view.ts`:** `render(sims, interpolate, poses)` maps `poses[i]` to boxer i.
- **Sim authority (your decision):**
  - Live lean is clamped to ±6 cm and scaled by 1 − the sim dodge amount, so a sim dodge replaces it.
  - Live arms nudge only a glove at rest, clamped to ±12 cm; a punch is always the sim's.
  - Torso/hips/head turns are clamped (0.35/0.2/0.5 rad) and off while floored.
  - The sim's duck no longer yields to live pose.
- **Arm read:** wrist = upperRot·(0,−1,0)·0.28 m + foreRot·(0,−1,0)·0.27 m. Arm bones stay collapsed.
- **Bug caught by the new unit test:** `slerpQuaternions(IDENTITY, out, t)` with `out` as its own target always returned identity. Fixed with a temp.

### Verified

- `pnpm exec vitest run src/render/boxing` → 10 passed. `live-pose.spec.ts` covers:
  - null/still has no influence
  - forward = fraction × 2.5 m, not × 0.5
  - clamps (lean, head angle)
  - hanging/forward/sideways arm read
  - full reach capped at 12 cm
  - easing (1 − e⁻¹ after τ), fade on null, no jump at dt 0
- `boxing-visual` e2e, new test "the sim stays authoritative", on the shipping GLB:
  - live sway + forward moves the head 3–8 cm
  - a sim dodge with a live sway lands at the same head position (3 dp) as the same dodge without live pose
  - a both-arms reach moves resting gloves forward 5–12 cm
- **`pnpm verify` → exit 0** (`tmp/verify-ve-3b.log`): tsc, eslint, vitest 332 + 1 skipped, playwright 26/26 (smoke + perf).
- **Not verified:** how live expression feels with a real body. Playtest: `/?game=boxing&input=pose&seed=42&debug=1`: turn your head, lean slightly, raise your guard, sway fully. The lean should stay small; a full sway only shows when the sim registers a dodge.

### Next

Item 1: map the sim state to fall/get-up (dizzy ≠ down).

### Knockdown and hit reactions (step 3c)

- **Floor state now follows the sim** (`presentation.ts` `flooredBy`):
  - Dizzy is standing: the sim still lets a dizzy boxer dodge and be hit. It shows as an eased wobble (τ 0.15 s) plus stars scaled by the same weight, so a clinch break that clears dizzy fades out instead of popping.
  - The fall starts with the referee count (`phase 'down'`, from `now − phaseT`) or a TKO.
  - The rise ends exactly when the count reaches `getUpAt` and the sim resumes.
  - **Fixed a second Codex bug:** a KO boxer fell twice. It stood back up when the phase became `over`, because `terminalAt` restarted the fall. The fall start now carries over from the count.
- **Head-snap direction (measured on the rig before the fix, not assumed):**
  - UAL `Hit_Head` always turned the face toward the boxer's left (+x), and Codex's yaw kick had its sign flipped. A left-cheek hit turned the face 0.47 *into* the punch.
  - Now a left-cheek hit mirrors the clip across the sagittal plane, a chin shot keeps only the clip's pitch, and the kick yaws away from the blow.
- `hitS` from config replaces the 0.44 literals.

### Verified

- `presentation.spec.ts` (7 tests), all on real sim flows:
  - dizzy stays standing and wobbles; cleared dizzy still > 0.5 one tick later and < 0.01 after 1 s
  - a real punch on a dizzy boxer → `down` → floor > 0.95 → monotonic rise → < 0.05 on the last counted frame → 0 at `fight`
  - a KO holds floor = 1 on every tick through `over`
  - a TKO falls from < 0.2 to 1
  - pause freezes presentation
- `boxing-visual` e2e on the real rig:
  - the head stays up while dizzy (`tmp/visual-expressiveness/dizzy-standing.png`)
  - new test "head snaps away from the blow": left cheek Δx < −0.15, right cheek Δx > +0.15, uppercut Δy > +0.1 with |Δx| < 0.1
- **`pnpm verify` → exit 0** (`tmp/verify-ve-item1.log`): vitest 334 + 1 skipped, playwright 27/27. The existing Boxing baselines still match.
- **Not verified:** whether the fall/get-up timing and snap strength *feel* right. Playtest: `/?game=boxing&seed=42` (keyboard, bot): drain the bot to dizzy (it should wobble, not fall), land one more punch (fall, count, get up on the count), then hook each side (head turns away).
- **Not done:** no UAL body-hit clip (body hits don't exist in the sim).

### Next

Item 3: real swelling.

### Face swelling (step 3d)

- **New `render/boxing/swelling.ts`:** the head's face cap *and* the shell under it bulge outward at each damage zone, by `damage × swellM` (4.5 cm at full damage on a ~31 cm head) with a gaussian falloff (σ 0.3 rad, cut at 3σ).
  - Bump centres come from the face-cap vertex nearest to where each bruise is painted (`BRUISE_SPOTS`, now shared with `face-damage.ts`), so swelling always sits under its bruise.
  - Normals are recomputed where the surface moved; the rest keep exact sphere normals, so there's no crease at the UV seam or poles.
  - It runs only when damage changes (a few hundred vertices × 3 zones), not every frame.

### Verified

- `swelling.spec.ts` (4 tests):
  - no damage = exact sphere
  - a left-cheek hit bulges the left cheek by 0.8–1.0 × `swellM` on both surfaces and the right cheek by < 0.1 ×
  - grows with damage, back to a sphere on reset
  - a chin hit peaks below the equator
- `boxing-visual` e2e: one real clean hit grows the rendered face radius by > 5 mm, a beating grows it further, and a restart restores it (6 dp).
- **`pnpm verify` → exit 0** (`tmp/verify-ve-swelling-3.log`): vitest 338 + 1 skipped, playwright 27/27.
- **Two red runs before that**, both on Skate Run's 1080p fps gate (54, then 45). Swelling code can't reach Skate Run, and the gate passed 2/2 alone and in a full `--project=perf` sequence 9/9. The desktop compositor (`dwm`) was using ~39 % of the GPU.
- **Not verified visually:** swelling barely reads while the face is unlit, so I'll re-check it after step 3e.

### Next

Item 2: light the face like the shell (the seam).

### Lit face, no seam (step 3e)

- **The three causes of the sticker look, all fixed:**
  1. The face cap was an unlit `MeshBasicMaterial` over a lit shell. It's now `MeshStandardMaterial` with the shell's roughness.
  2. The face texture was transparent outside the oval, and filtering pulled transparent-black texels into a **dark fringe** (measured 141 vs 192 skin). The canvas is now opaque skin (`SKIN`, shared with the shell colour), the crop is clipped to the oval, and skin feathers in over the oval's outer 20 %.
  3. The cap floated 1.5 % above the shell. It's now at 0.3 % with a polygon offset.
- **Baselines regenerated** (all 3 Boxing screenshots, `--update-snapshots=all`), after reviewing the diff:
  - `boxing-seed42-t8` changed only inside the face oval (2 % of pixels: key-light shading on the lower face, rim line gone); ring, gloves, body and HUD are unchanged.
  - The knockdown shot had passed within tolerance but still showed the old rim line, so it was refreshed too.
  - A re-run against the new baselines passes.

### Verified

- New e2e "the face is lit like the head" reads real WebGL pixels in the harness (sky light only, so shading along the equator depends on nothing but normal.y):
  - **Seam sweep:** 36 samples from the face (0.6 rad) across the oval edge onto the bare shell (1.3 rad); every channel stays within 24 of the shell. Before the fix it failed with a jump of 54 (unlit face 227 vs shell 192, fringe 141).
  - **Light response:** dimming the sky light darkens the face centre by > 60 (RGB sum). Before the fix it failed with 0.
- **Swelling is now visible under light:** `tmp/visual-expressiveness/count-recovered-damage.png` shows the left-cheek bulge on the silhouette.
- **`pnpm verify` → exit 0** (`tmp/verify-ve-lit.log`): vitest 338 + 1 skipped, playwright 28/28.

### Known gaps

- **Everything above is verified on the harness and fake camera only.** Playtest with a real camera: `/?game=boxing&input=pose&seed=42&debug=1` and `/?game=boxing&players=2&input=pose&seed=42`. Check:
  - your face on the big head under ring lighting (no seam)
  - bruises and swelling where you get hit
  - dizzy wobble (no fall)
  - fall → count → get-up
  - head turning away from hooks
  - small live lean and glove motion that never looks like a dodge or punch the sim didn't score
- Branch `feat/visual-expressiveness` is rebased and **not pushed**. `origin` still has the pre-rebase rescue commits, and updating it needs a force-push, which AGENTS forbids agents to run. Your call: push with lease, or push under a new branch name.
- UAL body-hit clips: none (the sim has no body hits).

### Next

M7.11 is complete on the agent side and waits on the playtest above. The branch is ready to merge into `main` after the playtest.

---

## 2026-09-16 — Perf diagnosis (1P/2P Boxing) + movement-detection research

### TL;DR

1. **The slowness isn't a code regression. Your Chrome renders WebGL in software.**
   - Its GPU process was launched with `--use-angle=d3d11-warp-webgl` (WARP = Microsoft's CPU rasterizer), has run since 2026-09-15 22:18, and was using 4.4 CPU cores continuously.
   - A tab of that Chrome was connected to the dev server.
   - Reproduced by launching Chromium with `--use-angle=d3d11-warp`:

     | | Normal GPU: render / pose-fps | WARP: render / pose-fps / infer |
     | --- | --- | --- |
     | Boxing 1P | 60 / 30 | 32 / 4.8 / 188 ms |
     | Boxing 2P | 60 / 25 | 22 / 2 / 492 ms |
     | Skate Run | 60 / 30 | 8 / 1.2 / 478 ms |

   - The worker still said `delegate GPU`, so nothing in the HUD showed it.
   - **At 2–5 pose-fps, detection is also broken.** That is the connection you suspected, but through the browser, not our features.
   - **Check `chrome://gpu` in your Chrome.** Then turn on Settings → System → "Use graphics acceleration when available" and relaunch. I can't change that setting for you.
2. **On a working GPU, no recent feature regressed anything measurable.** 60 fps and 29–30 pose-fps in 1P. 2P is the tight case: 23–29 ms of inference against a 33 ms camera interval.
3. **Research (item 2):** keep the thresholds and tune them on recordings first. Details in `docs/RESEARCH-movement-detection.md`. **Waiting for your decision.**

### How it was measured

- **`scripts/perf-probe.mjs`**, not in verify. It runs Chromium with the fake camera at 1920×1080 and patches the page from outside the app, so any commit can be measured:
  - rAF callbacks timed by name (`frame` = sim + render, `draw` = pose panel overlay)
  - 2D `drawImage` bucketed by target size (1280×720 = face snapshot, 192×192 = face crop)
  - WebGL texture uploads, `createImageBitmap`, `toDataURL`, long tasks
  - `getFps` / `getPoseStats` / `getRenderStats` sampled for 10 s
  - Options: `--angle d3d11-warp` (software GL), `--no-draw` (page draw calls become no-ops), `--viewport`
- **Feature attribution:** the same probe against worktrees of `a79349b` (latency work), `8ef2072` (Quaternius), `bf938fb` (Boxing), `be2a33a` (hover menu), `f4a903c` (faces), `6708eb4` (mirroring = HEAD).
- **`tmp/bench/`:** a throwaway page that runs PoseLandmarker in workers with a chosen delegate / model / layout, to compare cheaper 2P paths without touching the app.
- **`tests/tools/punch-sampling.tool.ts`:** synthetic punches (continuous smoothstep profile, sampled at arbitrary instants, 8 phases) through the real gesture engine at 30…10 pose-fps.
- **Noise:** this laptop was also running your WARP Chrome, VS Code and Codex. The same code gave 2P pose-fps means of 23.9, 25.2, 27.6, 28.3 and 29.7 across runs, and one run spiked to 47 ms of inference (pose min 4). Treat differences under ~3 pose-fps as noise.
- **Raw data:** `tmp/perf/probe-*.json`, `tmp/perf/punch-sampling.json`.

### Numbers (normal GPU, RTX 4060 Laptop, 1080p, fake camera capped at 30 fps)

| Scenario | Render fps | Pose fps mean (min) | Infer p50 ms | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- |
| M4 gate / latency work, Skate 1P (`a79349b`) | 60 | 30 (29) | 12.2 | 51 | 39.7k |
| Skate 1P, HEAD | 60 | 29.7–30 (27) | 12.4–15.4 | 57 | 586k |
| Skate 2P, HEAD | 60 | 25–29.8 (19) | 26.6–28.7 | 114 | 1.17 M |
| **Boxing 1P**, HEAD | 60 | 29.6–30 (27) | 10.6–11.4 | 44 | 16.2k |
| **Boxing 2P**, HEAD | 60 | 23.9–29.7 (20) | 24.8–28.8 | 88 | 32.5k |
| Boxing 1P keyboard (no camera) | 60 | – | – | 43 | 15.5k |
| Menu, camera on (2 poses, 1 body) | – | 26–30 | 18–24 | – | – |
| Menu → Boxing 1P (worker restart) | 60 | 30 (29) | 10.6 | 44 | 16.2k |
| Boxing 1P `debug=1&record=1` | 60 | 30 (29) | 12.3 | 44 | 16.2k |
| Boxing 1P / 2P, main thread throttled 4× | 59 (47) / 60 (42) | 29 / 26.1 | 12.3 / 23.1 | | |

**Where one second of main-thread time goes (Boxing 2P pose, HEAD before the fixes, ms per s):**

| Stage | Cost |
| --- | --- |
| Sim + render (`frame`) | 138 ms/s = 2.2 ms per frame p50 |
| Face snapshot: full 720p `drawImage`, every submitted frame | 16 ms/s (0.55 ms × 28/s) |
| Downscale bitmap for the worker | 5.6 ms/s |
| Face crops (192²) | 0.6 ms/s |
| Face texture upload | 0.8 ms/s |
| Pose panel overlay redraw (60 Hz) | 9.4 ms/s |
| Leftover `FACEDBG` `toDataURL` log | 2.2 ms/s; under WARP, **39 ms per call** every 2 s |

Pose inference runs in the worker: 25 ms per frame in 2P. It's the only big item.

### What each recently added feature costs (answers to your list)

- **`numPoses: 2`: the largest cost.**
  - Inference 11 → 23–29 ms.
  - With `numPoses: 2` and only one body in view (the menu) it is still 18–24 ms. The detector runs every frame while looking for the second person.
  - In 2P this leaves 5–10 ms of headroom in a 33 ms camera interval, so any contention costs pose frames. That's why the 2P perf gate is the one that flakes (baseline verify this session: red, min 15 pose-fps while your WARP Chrome used 4.4 cores).
- **Live face capture:** yes, it copies the **full 720p frame on every submitted frame** (≈ 30/s) although crops run at ≤ 15/s.
  - Measured 0.5 ms per copy, 15–20 ms/s: about 1–2 % of one core, no fps effect.
  - **Not changed:** a face-region crop would save ≈ 10 ms/s for a noticeably more complex snapshot/result pairing.
  - The crop and texture upload together are < 1.5 ms/s.
- **Oversized head:** +1 draw call and +768 triangles (the face cap). No measurable cost.
- **Hover menu (camera always on):** only costs while the menu is up (2-pose inference, no render).
  - Launching restarts the worker for 1 pose. Measured after the restart: 30 pose-fps, 0 restarts, same as a direct launch.
- **Pose mirroring:** world-landmark copy + PoseState math sit inside the 2.2 ms `frame` and the worker round trip.
  - Worktree before/after (`f4a903c` → HEAD): no difference beyond noise.
- **Park biome (Quaternius):** 39.7k → 586k triangles in 1P, 1.17 M in 2P. Skate frame p50 1.3 → 2.1 ms, inference +1–3 ms from GPU sharing, fps unchanged on this GPU.
  - Not Boxing's problem; still open (see gaps).
- **Renderer vs inference:** with every page draw call turned into a no-op (`--no-draw`), 2P inference was 24–25 ms vs 27–30 ms drawn. So rendering costs 2P ≈ 2–5 ms. Render resolution (1920×1080 vs 960×540) made no difference.

**Against the M4 / latency numbers** (60 fps / 51–59 draw calls / 28–31 pose-fps):
- Skate 1P still holds 60 fps and ~30 pose-fps. Triangles ×15 since the Quaternius swap; draw calls 51 → 57.
- Boxing 1P matches the old Skate numbers.
- **The only real regression on a GPU is 2P pose-fps: 28–31 → 24–29, min dips to 15–20.** It comes from `numPoses: 2`, which is inherent to 2P, not from the faces or the menu.

### Levers evaluated (measure → decision)

| Lever | Measured | Decision |
| --- | --- | --- |
| Lite model | GPU 1P: 9.7–10.7 vs 10.8–11.6 ms. GPU 2P: 17.6–20.2 vs 18.9–19.5 ms (bench). In-game 2P: 22.6 vs 25.4 ms | ≈ 0–10 %, within noise |
| Lite auto-fallback (PLAN §1.1 "pose fps < 20 for 3 s") | **Not wired: nothing in `src/` implements it.** CPU delegate: lite 34–47 ms vs full 50–52 ms | **Deliberately not wired.** A worker restart costs 2–3 s of lost tracking mid-match for ≤ 10 % back. Needs your OK because it deviates from PLAN §1.1 |
| Two workers × 1 pose on overlapping 60 % halves, instead of 1 worker × 2 poses | Each worker 17.5 ms (GPU shared) vs 18.9–19.5 ms for one 2-pose worker; throughput identical (both hit the 30 fps camera cap) | Rejected: no gain, and it breaks when a player crosses the middle |
| **CPU delegate when WebGL is software** | Bench (no render): CPU 50 ms vs GPU-on-WARP 188 ms. In-game WARP after the fix: render 32 → 50 fps (1P), 22 → 34 (2P); pose-fps 4.7 / 3 (WARP rendering eats the same cores) | **Done**, plus a visible warning: the real fix is enabling the GPU |
| Pose panel overlay only on new poses | 5.2–11.4 → 3.7–5 ms/s (15.4 in debug, was 19.9) | Done |
| Remove leftover `FACEDBG` `toDataURL` console log | 1–2.5 ms/s; 39 ms stalls under WARP | Done |
| Face snapshot as a face-region crop | ≈ 10 ms/s possible saving | Not worth it (see above) |
| Park triangles | See above | Not changed: no fps effect on a GPU; asset decimation is its own task |

### Does pose-fps explain missed punches? (the question behind item 2)

`tests/tools/punch-sampling.tool.ts`, detection rate over 8 sampling phases. Out = time to full extension; "snap" = straight back with no pause.

| Punch | 30 | 25 | 20 | 15 | 12 | 10 pose-fps |
| --- | --- | --- | --- | --- | --- | --- |
| Full reach, out 60 ms, snap | 1 | 1 | 1 | 1 | 0.88 | 0.75 |
| 0.5 reach, out 60 ms, snap | 1 | 1 | 1 | 0.63 | 0.63 | 0.50 |
| 0.5 reach, out 90 ms, snap | 1 | 1 | 1 | 1 | 0.75 | 0.75 |
| ≥ 0.5 reach, out ≥ 120 ms | 1 | 1 | 1 | 1 | 1 | 0.88–1 |
| 0.3 reach, any speed | 0 | 0 (one 0.38) | 0 | 0 | 0 | 0 |

- **At ≥ 20 pose-fps, sampling rate doesn't lose punches.** Shallow punches fail at every fps because of `fists.rearm` (0.6 torso reach), a threshold question.
- **Caveat:** synthetic motion has no motion blur and no MediaPipe tracking lag on a fast wrist; both are worse at low fps. Only real drills can measure those.
- **Found on the way:** the keyframe `script()` sampler always puts a frame on each keyframe, so every synthetic punch got its peak for free (the first run said 100 % everywhere). The tool samples a continuous profile instead. The existing TEMPORARY fist tests still use `script()`; this doesn't invalidate them (they test sequences, not rates), but keep it in mind.

### What changed

- **`src/platform/gpu.ts`** (+ spec): `glRenderer`, `isSoftwareRenderer`, and `warnSoftwareGl`, a red banner shown once telling the player to enable graphics acceleration.
- **`pose.worker.ts`:** reads its own WebGL renderer before creating the landmarker. Software GL → CPU delegate. Reports `gpu` in `ready`.
- **`bridge.ts`, `pipeline.ts`:** `PoseStats.gpu`; the warning fires when the worker's GL is software. The debug stats show a `gpu …` line.
- **`render/renderer.ts`:** the same check for the page's renderer.
- **`pose-panel.ts`:** the skeleton/heatmap redraw only when a new PoseFrame arrived.
- **`face-crop.ts`:** removed the leftover `FACEDBG` log.
- **Tools:** `scripts/perf-probe.mjs`, `tests/tools/punch-sampling.tool.ts`.
- **Docs:** `docs/RESEARCH-movement-detection.md`; features M7.11, M7.12.

### Verified

- **`pnpm verify` → exit 0** (`tmp/perf/verify-perf.log`): tsc, eslint, vitest 323 passed + 1 skipped (22 files), playwright smoke 22/22. The 2P perf test sampled pose-fps 24–25.
- **The session-start verify was red** (`tmp/perf/verify-start.log`): the 2P Skate perf gate hit min 15 pose-fps while your WARP Chrome was using 4.4 cores. That's the flake described above, not a code change.
- **After-probe on GPU** (`probe-after.json`): Boxing 1P 60 / 29.6 pose (infer 11.4, delegate GPU), 2P 60 / 25.2 (24.8), Skate 1P 60 / 29.7, Skate 2P 60 / 28.9. Same as before within noise.
- **WARP e2e by hand:** banner shown; stats `delegate CPU`, `gpu ANGLE (Microsoft, Microsoft Basic Render Driver …)`. Screenshot `tmp/perf/warp-banner.png`.
- `gpu.spec.ts`: the WARP string is the one Chromium actually reported; the RTX string is the real one from this machine.

### Known gaps

- **Your real Chrome is unverified from here:** I saw the GPU process flag and the dev-server connection, not `chrome://gpu`. After enabling acceleration, open `http://localhost:5173/?game=boxing&debug=1` and check that the stats line says `delegate GPU` and `gpu ANGLE (NVIDIA …)`, with pose ≈ 30 (1P) / ≈ 25 (2P).
- **The real webcam isn't measured:** a dim room can drop a webcam to 15 fps. `camera … fps` in the debug stats shows it.
- **2P has little headroom** (≈ 5–10 ms). A bigger lever would be a 60 fps-capable camera + a 1-pose "tracker" path, not worth it until 2P is played for real.
- **Park biome at 586k / 1.17 M triangles** is still open (decimate Quaternius props or cut instance counts).
- **Lite auto-fallback per PLAN §1.1 is not wired**, on purpose (table above). Your call.

### Item 2 decision needed

`docs/RESEARCH-movement-detection.md`. My recommendation:
1. Record the drills and tune the thresholds (built, ~2 h each side).
2. Pilot pose-embedding k-NN only for guard/duck/lean if they stay fragile across people (~1 day, no dependency, < 0.1 ms per frame).
3. No sequence model for punches now: it would add 100–200 ms of detection latency.
4. No other MediaPipe task applies.

---

## 2026-09-16 — Named players, match history and stats charts (item 3)

**Result:** before a match the menu asks "Who's playing?". Each player claims a slot by hovering (or with the mouse) and picks or types a name. Every finished match is saved under that name, and a new **Stats** page in the menu charts each stat across matches. No accounts, no new dependency.

### 3a. Who's playing?

- **Flow:** Menu → players 1|2 → game → **"Who's playing \<game\>?"** → Start.
- **Slots:**
  - 1P has one slot, "Player", **preselected with the last P1**, so a rematch is one hover on Start.
  - 2P has "Left player · P1" and "Right player · P2", and **always claims explicitly**: the same two people may have swapped sides since last time.
- **Choices per slot:** recent names (up to 6, most recently played first), "Player N", and a text field + Add for new names (keyboard; hands can only pick). A name taken by the other slot is disabled. Start is enabled only when every slot has a name.
- **Claiming is tied to your side of the screen:** a slot's name buttons only react to the hand cursor from that side, the same screen-half split the 2P games use. So the body on the left can't claim "Right player". Mouse and keyboard work on everything. Back/Start react to either hand.
- **Identity is still positional during the match.** The name is bound to the side you claimed it from. Swapping sides mid-session swaps the names. Knowing who is who from the body itself would need re-identification; not built, and I don't recommend it for a living-room game.
- **Direct `?game=` links skip the screen.** Names come from `?names=Ana,Beto`, else the last session, else "Player N".
- **The Boxing HUD shows the names** instead of You/Opponent (CPU in 1P).

### 3b. Match history (`platform/profile-store.ts`)

- **Format:** `localStorage['move-arcade.profile']` = `{ version: 1, players: { [name]: { matches[] } }, lastNames }`.
- **Each match:** `{ game, at, players, opponent, result, stats }`. `opponent` is the other name in 2P, `"CPU"` in 1P Boxing, null in 1P Skate Run.
- **What gets saved:** the new `MiniGame.matchStats(sim, player)` contract, recorded once per player when a match first ends (not for `?input=bot`).
  - **Boxing:** result win/loss/draw; `cleanHits` (clean hits are what decide the match on points), `hitsTaken`, `knockdownsScored`, `knockdownsTaken`, `rounds`.
  - **Skate Run:** result null; `score`, `distance`, `coins`.
- **Schema and migration (PLAN §2.4 / M5 pattern):**
  - `migrate()` upgrades an unversioned object to v1.
  - Data from a **newer** version makes the store read-only, so this build never overwrites it.
  - **Corrupt** JSON is copied to `move-arcade.profile.corrupt-<ms>` before a fresh profile starts. If that backup can't be written, nothing is overwritten either.
  - Blocked storage works in memory for the page.
  - Cap: 1000 matches per player (`ponytail:` note).
- **There was no ProfileStore before this.** M5 hasn't been built. This is the M5.1 store, holding only what item 3 needs. PLAN §2.4's single-player fields (coins total, multiplier, tokens, missions, settings) get added when M5 is built, as a v2 migration.

### 3c. Stats page (`platform/stats-view.ts`, `platform/line-chart.ts`)

- **Layout:** player chips × game chips, then:
  - **Record:** matches, W – L – D, win rate.
  - **Last 20 results** as W/L/D chips (letter + colour, never colour alone).
  - **One small line chart per stat** (small multiples, one axis each, zero-based, whole-number gridlines for counts).
  - **The latest 10 matches as a table** (the accessible view).
- **Hover:** a crosshair on the chart; a readout under it shows the value, match number, opponent, result and date. When not hovering, it shows the latest match.
- **Charts are drawn on a canvas by hand (~140 lines), with no library and so no ADR.**
  - There is one series per chart, and the only interaction is hover.
  - A library (Chart.js ≈ 70 KB gz, uPlot ≈ 20 KB) would bring its own theming, a runtime dependency and an ADR, and buy nothing needed here.
  - The series colour is the dataviz reference palette's dark slot 1 `#3987e5`, validated against the menu surface `#1b1f3b` (lightness band, chroma, ≥ 3:1 contrast: all pass).
- **Screenshots:** `tmp/e2e/stats-page-14b.png` (14 seeded matches, hover), `tmp/e2e/stats-page.png` (the e2e's real match), `tmp/e2e/who-1p.png`.

### Also changed: perf gates run in their own serial Playwright project

- **Why:** item 3's verify went red 3× on the 2P pose-fps gate, with one or two samples of 19 against ≥ 20. The same gate was already red at session start before any change. It measures a GPU that the other smoke pages use at the same time.
- **A/B on that gate alone:** item-3 tree 20–27 and 20–26; previous commit 2–30 in the same window. So it's noise, not item 3.
- **Fix:** `playwright.config.ts` now has a `smoke-perf` project: the three `perf` describe blocks, `dependencies: ['smoke']`, `workers: 1`. `smoke` excludes them. `pnpm test:smoke` runs both.
- **No threshold changed.** With the gates isolated, 2P pose-fps sampled **26–30**.
- AGENTS §4 and ARCHITECTURE Harness updated.

### What changed

- **New:** `platform/profile-store.ts` (+ spec, 7 tests), `platform/stats-view.ts`, `platform/line-chart.ts` (+ spec), `tests/e2e/player-stats.smoke.spec.ts`.
- **`platform/menu.ts`:**
  - pages: home / who's playing / stats
  - Stats button
  - slot-restricted hover
  - the dwell key covers every `data-*`
- **`games/types.ts`:** `MiniGame.matchStats`. Boxing and Skate Run implement it.
- **`main.ts`:** profile store, `names`, `recordMatch`, `?names=`, `launch(g, count, names)`.
- **`render/hud.ts`:** `HudExtras.names`. **`render/boxing/hud.ts`:** names on the pies (escaped).
- **e2e:**
  - `menu-hover.smoke` rewritten with two synthetic bodies: the right hand can't claim the left slot; both claim, hover Start, 2P Boxing launches with the names on both HUDs; plus mouse + typed name.
  - `boot.smoke` / `boxing.smoke` pick a name before Start.
- **Harness:** `playwright.config.ts` `smoke-perf`, `package.json` `test:smoke`.
- **Docs:** ARCHITECTURE "Players & match history", AGENTS `?names=`, features M5.1 (in_progress), M7.13.

### Verified

- **`pnpm verify` → exit 0** (`tmp/perf/verify-stats-4.log`): tsc, eslint, vitest 332 passed + 1 skipped (24 files), playwright 24/24 (21 smoke + 3 smoke-perf). 2P pose-fps 26–30.
- **`player-stats.smoke`:**
  - 2P bot-vs-bot Boxing to the end with `names=Ana,Beto`: both records saved; opponents cross-linked; `cleanHits` = the sim's `landed`; Ana's knockdowns taken = Beto's scored; W/L matches `winner`; no duplicate after the results card stays up.
  - After a reload, Stats shows "Ana · Boxing: 1 match", 5 charts and 1 table row.
  - 1P: opponent "CPU", HUD shows "Cleo".
- **The hover e2e caught two bugs while writing it:**
  - a `<button>` outside any form still reports `type === 'submit'`, so every button was being ignored
  - my synthetic "left" body was actually on the right: negative `walk` = screen-left

### Known gaps

- **Not played with a real camera:** the two-person hover flow is tested on synthetic poses only. Button spacing within a slot may be tight for a hand cursor at 2.5 m; a playtest will tell.
- **No rename, delete or merge of players** (a typo creates a new player). Add when needed.
- **Stats only cover matches that reach the end.** Quitting mid-match (reload) records nothing.
- **Skate Run 2P** saves each player's run with the other as opponent and no result (independent runs).
- **On a small window, the compact camera thumbnail (top-left) can cover part of the left slot.**

### Playtest note for Jorge

1. `http://localhost:5173/?debug=1`: raise a hand, hover **2**, hover **Boxing**. Each of you hovers your own column's name, then either hovers **Start**.
2. Play to the end, then Menu (reload) → **Stats** → your name → Boxing.
3. To see charts with more data without playing: `?game=boxing&input=keyboard&autoplay=1&names=Ana,Beto` finishes bot matches under those names.

## 2026-09-16 — Boxing spec: docs/PLAN-BOXING.md (draft, awaiting sign-off)

Branch `docs/plan-boxing`, from `feat/visual-expressiveness` (`a68568a`). Docs only; no code.

### Why

- **Jorge asked for three things; none was ever specified:**
  - knockdown from the player's perspective
  - effort-driven recovery (marching, jumping, running in place)
  - the trainer between rounds
- **The Boxing spec only ever existed as chat:**
  - `docs/PLAN.md` doesn't mention Boxing.
  - Its rules lived in the Piece 4 chat brief and in PROGRESS notes written after the fact.
- **So M7.11 is done against its own spec,** while the game still misses the requirement. The gap was the spec, not the execution.
- **Blocked:** the control-model inversion these requirements depend on isn't built or merged anywhere. The latest rig work (`2c446ae`) is explicitly sim-authoritative.

### What changed

- **New `docs/PLAN-BOXING.md`, the source of truth for Boxing:**
  - control model (player owns the rig, the sim resolves consequences)
  - closed list of authorized overlays
  - body calibration additions
  - the authority table S1–S13 with exact handover ticks, read through a pure `boxingAuthority()`
  - R1 player-perspective knockdown, R2 effort recovery, R3 free movement, R4 trainer, all as testable `BX-…` IDs
  - gesture scoping per game/state
  - fixtures to record
  - open decisions D1–D4
- **Jorge's decisions written in:**
  1. The random get-up roll is removed. Need = `needBase × n`, with a 2 s floor and an 8 s KO cap.
  2. Detectors are scoped per game/state, so the Skate jump gate is never active on the canvas.
  3. Wii shake-to-get-up is the reference behaviour.
- **`features.json`:** new M7.15 (inversion) through M7.19 (trainer), all `todo`. M7.11 is left `done` on purpose.

### Verified

- **Docs only.** `features.json` parses.
- **`pnpm verify`: exit 1, twice, each time on a different perf gate.** Every other check passed: tsc, eslint, vitest 338 passed + 1 skipped, and all non-perf e2e.
  - Run 1 (`tmp/boxing-spec/verify-spec.log`): 2P pose-fps, lowest sample 19 against ≥ 20.
  - Run 2 (`verify-spec-2.log`): 1080p fps 46 against ≥ 55.
- **Perf gates run alone:** `playwright test --grep @perf --workers=1` → exit 0, 24 passed (`perf-serial.log`). fps 60, pose-fps 27–31.
- **Why that points to load, not this change:** the code is byte-identical to `a68568a`, and this branch lacks the serial `smoke-perf` project from `feat/perf-diagnosis-and-player-stats`. No threshold was touched.
- **Committed with verify red, on Jorge's explicit call (2026-09-16):** docs-only branch, code byte-identical to `a68568a`, and both failures are independent of this change. This is an exception to AGENTS §3, recorded here so the history is honest.
- **The perf failures are an OPEN issue, not noise.** Two different gates failed on the same code, and 1080p at 46 vs ≥ 55 isn't marginal. GPU state investigation follows in the next entry.

### Known gaps / flags for Jorge

- **PLAN.md §6 needs the wording in PLAN-BOXING §8.3.** PLAN.md is human-owned, so I didn't edit it.
- **Feature ID collision:**
  - `feat/visual-expressiveness` has M7.11 = visual expressiveness.
  - `feat/perf-diagnosis-and-player-stats` has M7.11 = perf diagnosis, plus M7.12 and M7.13.
  - Merging both needs a renumber. The new items start at M7.15 to avoid both.
- **Pacing numbers are untuned start values:** needBase 6, the point per gesture, decay, the gains.
- **Fixtures to record:** PLAN-BOXING §11.

### Next

Jorge signs off on the spec (and D1). Then M7.15, the inversion, runs against it.


## 2026-09-16 — Spec rebased onto feat/player-authority: D1–D4, PLAN §6, feature renumbering, WIP snapshot

Branch `docs/plan-boxing` in `tmp/plan-boxing-worktree`, rebased onto `feat/player-authority` (`12c1ddf`). Docs only.

### Jorge's decisions, written into PLAN-BOXING

- **D1: overlays only as additive, bounded, time-limited offsets on the live pose.** New §4.1 general rule: any future sim effect on a player-owned part follows it, or needs Jorge's sign-off.
  - **Conflict found while applying it:** my draft O2 scaled the player's sway/arms by 0.6 and swapped in a slower smoother, which is an override.
  - **Redefined:** O2 is `clamp(slow(live) − live, bound)` + wobble. The dizzy walk penalty moved into the sim (`MOVE` speed).
  - **New tests:** BX-A-4 (the player still moves head/torso/wrist while O1 and O2 are both active), BX-A-5 (offsets end in time), BX-A-6 (a single rig-write path that always reads `live`).
- **D2: positions in the sim, out-of-reach punches whiff.**
  - `MOVE` events are sampled at 10 Hz and quantized, so replays stay deterministic.
  - Reach is 1.1 m.
  - §7 lists what changes for the bot: approach to reach, retreat when low, slower than the player, and the kiting risk measured by BX-MV-7.
  - Bot-vs-bot baselines get re-baselined, not deleted.
- **D3: the 11 s break is interruptible.**
  - `WALK_OUT` (shared march classifier) is accepted after `cornerMinS` = 2 s, and the walk-out is paced by the player's march.
  - 2P waits for the last boxer.
  - BX-TR-5…8.
- **D4:** arms stay free in the corner. No frozen player state outside Falling; Paused only holds the pose because there's no body.
- **Shared classifier:** `MARCH_STEP` lives in a game-agnostic `src/pose/march.ts` so the queued Skate Run step-propulsion amendment can use it. Session move-arcade-32 confirmed its draft already plans the same file. Not started.
- **Arm-pump tuning flag** (+0.5 → 12 pumps vs 3 hops) recorded in §6.2. It needs real recordings before shipping.
- **PLAN.md §6** jump-false-positives row reworded, approved by Jorge. Scoped per game and state; Boxing marching is input.

### Feature ID renumbering (one pass, on the integration branch)

Three branches collided on M7.11+. `feat/player-authority` is the integration point, and its merge `a038c2d` already renumbered the perf branch. Old IDs in earlier entries map as follows:

| Branch / entry | Old ID | New ID |
|---|---|---|
| `feat/visual-expressiveness` (Visual expressiveness entry) | M7.11 visual expressiveness | **M7.11** (unchanged) |
| `feat/perf-diagnosis-and-player-stats` (Perf diagnosis entry) | M7.11 perf diagnosis | **M7.12** |
| same (Perf diagnosis entry) | M7.12 movement-detection research | **M7.13** |
| same (Named players entry) | M7.13 named players | **M7.14** |
| `docs/plan-boxing` draft `5155047` (Boxing spec entry) | M7.14 inversion … M7.18 trainer | **M7.15 … M7.19** |

**No separate merge notes on the old branches:** `feat/visual-expressiveness` and `feat/perf-diagnosis-and-player-stats` are both ancestors of `feat/player-authority`, so neither needs its own merge. This table is the trace.

### Uncommitted inversion WIP secured (not built on)

- **What it was:** `feat/player-authority` had uncommitted `src/core/boxing` work (body, collide, positions, sim/types/config/bot, input, presentation). It was started before this spec existed.
- **Stopped:** at Jorge's instruction, the owning session (move-arcade-64) stopped: no more src edits, e2e or commits there.
- **Snapshot:** saved through a temporary index, so that worktree's files, index and branch were untouched. Branch `wip/player-authority-core-snapshot`:
  - `08a8b42`: first snapshot
  - `8516c3a`: the owner's last two edits
- **State reported by the owner:** vitest `src/core` + `src/render/boxing` 270 pass, 1 fail (a chin-zone presentation test), not `pnpm verify`-ed. **Not verified against PLAN-BOXING; don't merge as-is.**

### Incidents

- **Branch moved under another session:** at 22:45:48 session move-arcade-32 created `docs/skate-step-propulsion` in the shared main checkout. My `git rebase` started there 38 s later and landed on that branch.
  - The tree was clean, so nothing was lost.
  - I restored it with `git reset --keep 5155047`; the other session confirmed.
  - My work now lives only in `tmp/plan-boxing-worktree`.
  - **Lesson:** sessions sharing one checkout is unsafe. Each session gets its own worktree.
- **The guard hook doesn't protect worktrees:** `.claude/hooks/guard-paths.mjs` makes the target path relative to `CLAUDE_PROJECT_DIR` (the main root). A worktree file becomes `tmp/<wt>/docs/PLAN.md` and doesn't match `^docs/PLAN\.md$`.
  - So `fixtures/`, `public/models/` and `PLAN.md` are unguarded in every worktree.
  - This PLAN.md edit was approved, but the guard didn't enforce anything. Hooks unchanged: flagged for Jorge.

### Perf: reclassified, not closed

- **Both failures (2P pose-fps 19; 1080p fps 46) are explained by cross-session interference.**
  - The other session's verify/e2e ran 22:26–22:34, overlapping both my runs.
  - It also flagged its own 2P Skate pose-fps min 20 at `12c1ddf` as probably contaminated.
  - Not a regression.
- **GPU at the time:** delegate GPU (inference 13.1–13.3 ms). The GPU name wasn't logged by the failing runs.
- **After-the-fact probe:** RTX 4060 Laptop through Chrome's Direct3D 11 layer, hardware accelerated, in page and worker.
- **Still open:** the render budget, which Jorge asked for before the chaser and web-swinging get designed. The park biome is 586k triangles.
- **Next:** an e2e lock so two sessions can't run e2e at once, and the GPU name logged by every perf gate.

## 2026-09-16 — e2e lock + GPU name on every perf gate

Branch `docs/plan-boxing` (`tmp/plan-boxing-worktree`), fast-forwarded onto `feat/player-authority` `7f68b4b`. Harness only; no game code.

### Why

- **Cross-session interference:** two sessions ran e2e on one GPU (22:26–22:34) and poisoned each other's perf gates.
- **Undiagnosable failures:** the red runs only recorded the MediaPipe delegate, not the GPU, so a software or wrong adapter couldn't be ruled out at the time.

### What changed

- **`tests/e2e/e2e-lock.ts` + `global-setup.ts`:** global setup takes a lockfile in the git common dir (`.git/move-arcade-e2e.lock`), so every worktree and session shares it.
  - Written with an exclusive create (`wx`), holding `{pid, cwd, branch, startedAt}`.
  - A second run throws: "Another e2e run holds the lock: pid …, <cwd> (<branch>), since …".
  - A lock whose pid is dead is stale and taken over.
  - Released by the teardown function that global setup returns. It also releases when the models check fails.
  - `ponytail:` pid liveness only; a reused pid after a crash needs the manual delete the message names.
- **`tests/e2e/gates.ts`:** `recordGate(page, …)` is now async and records `gpu: {renderer, poseGpu, poseDelegate, software}`.
  - `renderer` is the page's unmasked WebGL renderer; the pose worker's renderer and delegate come from `getPoseStats()`.
  - It prints a `GATE <name> gpu:` line and flags a software rasterizer as "perf numbers are not comparable".
  - All 6 gate call sites updated.
- **AGENTS §4:** the lock, the GPU line, and `PLAYWRIGHT_PORT` in worktrees.
  - Why: a stale Vite from 19:09 was still serving the main checkout on 5173, and `reuseExistingServer` would silently test that code from a worktree.

### Verified

- **Lock logic** (`node --experimental-strip-types tmp/lock-check.mts`): acquire; a second acquire throws naming the pid; release removes; a dead-pid holder is taken over. Both worktrees resolve the same `.git/move-arcade-e2e.lock`.
- **Real Playwright, lock held by a live fake holder:** `boot.smoke -g vendored` exited 1 after 5 s with the holder message, and the holder's lock was left in place.
- **`pnpm verify` run 1** (`PLAYWRIGHT_PORT=5190`, 22:55–22:59, lock held): **exit 1.**
  - Passed: tsc, eslint, vitest 348 passed + 1 skipped (27 files), 30 of 31 e2e. The lock was released afterwards.
  - Gate values, all GPU = ANGLE RTX 4060 Laptop D3D11 (hardware); pose delegate GPU where the pipeline runs:
    - latency: pipeline P50 25.6 / P95 43.6 ms (1P), 35.7 / 49.8 ms (2P), rig response 216.7 ms
    - boxing-1p-1080p-face: fps 60, pose-fps min 24
    - pose-1p-5s: 26.7
    - skate-1p-1080p-bot: fps 60
    - skate-1p-1080p-pose: fps 60, pose-fps min 25
  - **Red: skate-2p-1080p pose-fps min 15, mean 19.9** (≥ 20). Samples 18, 15, 17, 18, 20, 18, 16, 20, 18, 18, 21, 26, 26, 25, 23 (the rest ≥ 20); render fps 60 throughout.
  - **Load during the run:** session move-arcade-64 was editing `src/` in its worktree (a tsc on every edit through the format hook, and a probe writing `tmp/probe-body.txt`). The lock covers e2e only, not CPU-heavy work.
- **`pnpm verify` run 2, retry 1** (23:0x, lock held, move-arcade-64 paused edits/tsc/probes on request): **exit 0.**
  - tsc, eslint, vitest 348 + 1 skipped, e2e 31/31 (2.7 min). All 6 gates logged GPU = RTX 4060 Laptop D3D11, no software renderer.
  - Gate values:
    - latency: pipeline P50 21.0 / P95 29.9 ms (1P), 32.4 / 41.2 ms (2P), rig response 200.1 ms
    - boxing-1p-1080p-face: fps 60, pose-fps min 29
    - pose-1p-5s: 29.5
    - skate-1p-1080p-bot: fps min 59
    - skate-1p-1080p-pose: fps 60, pose-fps min 27
    - **skate-2p-1080p: fps min 59, pose-fps min 28, mean 29.7** (samples 28–31)
- **Reading:** the same code on the same GPU gave 2P pose-fps min 15 under another session's edit load and min 28 without it. The e2e lock is necessary but not sufficient: **perf numbers are only trustworthy while no other session is running tsc, vitest or probes.** That's a machine/session-policy question for Jorge, not something the lock can enforce.

### Still open

- **Render budget:** the park biome is at 586k triangles, and the budget is needed before the chaser and web-swinging are designed.
- **The guard hook doesn't cover worktrees** (see the previous entry).
- **Next step:** stop. M7.15 is owned by session move-arcade-64, per Jorge's answer relayed by that session; to be confirmed by Jorge.

## 2026-09-16 — Perf rule enforced (lock waiters + machine state), guard hook fixed for worktrees, 2P pose-fps re-baselined

Branch `docs/plan-boxing` (`tmp/plan-boxing-worktree`), on `852efb0`. Harness and hooks only; no game code.

### Perf lock: extended from "second e2e fails" to "heavy work waits" (Jorge: enforce it, don't document it)

- **`scripts/e2e-lock.mjs`** is now the one lock module (it replaces `tests/e2e/e2e-lock.ts`), with types in `e2e-lock.d.mts`.
  - Same lockfile (`.git/move-arcade-e2e.lock`), same takeover when the holder's pid is dead.
  - Adds `waitForLock()` and the CLI `node scripts/e2e-lock.mjs wait <label>`.
- **Holders:**
  - the Playwright run (global setup; a second e2e run still fails fast)
  - `scripts/perf-probe.mjs`, which waits, then holds the lock
- **Waiters:**
  - `pnpm typecheck` / `pnpm lint` (script prefix)
  - every vitest run, including direct `vitest` calls (`globalSetup` in `vite.config.ts` and `vitest.tools.config.ts`)
  - tools-only Playwright probes (`--project=tools`, or `PERF_LOCK_WAIT=1`)
  - the `format-and-typecheck` hook: prettier runs, tsc waits ≤ 45 s (hook timeout is 60 s), then is skipped with a message
- **Fallback when a process can't check the lock:** `tests/e2e/machine-state.ts`. Every perf gate records, in its `GATE <name> machine:` line and in `gates.jsonl`:
  - CPU busy % over 1 s
  - `nvidia-smi` GPU utilization %
  - whether this run holds the lock
  - other tsc/eslint/vitest/playwright/vite-build/probe processes outside this run's own process tree, printed as `CONTENDED [...]`
  - Its first live run flagged 4 false positives: VS Code's eslint/sonarlint servers, and my own Git Bash wrappers (MSYS breaks the Windows parent chain). Shells and `.vscode/extensions` are now excluded, pinned by a unit table (`isHeavyCommand`, 8 cases).
- **Known gap:** one-off heavy work that's neither scripted nor a node tool (e.g. `npx tsc` typed by hand, a raw `vite build`) isn't forced to wait. The machine-state line catches it in the gate result. AGENTS §4 says to run `node scripts/e2e-lock.mjs wait` first.

### Guard hook fixed for worktrees

- **Before:** `guard-paths.mjs` resolved the target against `CLAUDE_PROJECT_DIR`, so a worktree file became `tmp/<wt>/docs/PLAN.md` and matched no rule.
- **Now:** it resolves against `git rev-parse --show-toplevel` of the nearest existing directory of the target.
- **`format-and-typecheck.mjs`** now also runs prettier and tsc in the edited file's own checkout. It used to typecheck the main root no matter which worktree was edited.
- **`tests/unit/guard-paths.spec.ts`** (7 cases on a temp repo with a nested checkout): main-root PLAN/fixtures blocked; worktree PLAN.md, models (new file) and settings.json blocked; worktree src and PLAN-BOXING allowed.
  - **Proven against the old hook:** the same spec pointed at the previous `guard-paths.mjs` fails exactly the 3 worktree cases.
- **Deployment caveat:** Claude Code runs hooks from the checkout at the session's project dir, which for current sessions is the main root, now on `docs/skate-step-propulsion`. **The fixed hooks and the tsc wait are live for a session only once this commit is in the branch checked out there.** Until then, other sessions run the old hooks. The package-script and vitest waits are live on any branch that has this commit.

### Verified

- **`tests/unit/perf-lock.spec.ts`:**
  - a second acquire fails naming the pid; release frees it
  - a dead-pid lock is taken over
  - `waitForLock` blocks while a separate live process holds the lock, then proceeds (waited ≥ 300 ms)
  - timeout names the holder
  - the heavy-process table
- **Live, with a separate process holding the lock:**
  - `pnpm typecheck` printed "tsc: waiting for the perf lock … pid …", ran after release (11 s)
  - the hook printed the same wait and exited 0 after 9 s
- **`pnpm verify` with the waiters, before the false-positive fix** (`tmp/verify-perflock.log`): exit 0. Every gate showed `CONTENDED`, only from the 4 false positives above.
- **`pnpm verify` final** (`tmp/verify-perflock-2.log`, `PLAYWRIGHT_PORT=5190`, move-arcade-64 and -32 paused on request): **exit 0.**
  - tsc, eslint, vitest 367 passed + 1 skipped (29 files), e2e 31/31.
  - **Every gate: `lock held · other heavy: none`**, GPU = RTX 4060 Laptop D3D11 hardware.
  - Gate values:
    - boxing-1p-1080p-face: fps 60, pose-fps min 30
    - pose-1p-5s: 29.5
    - skate-1p-1080p-bot: fps 60
    - skate-1p-1080p-pose: fps 60, pose-fps min 27
    - skate-2p-1080p: fps 60, **pose-fps min 24, mean 26.3**

### Re-baseline: 2P Skate pose-fps (gate ≥ 20 min) on a quiet machine

- **Run:** `playwright test --project=perf two-players -g "2 players at 1080p" --repeat-each=5` (`tmp/rebaseline-2p.log`, `tmp/verify/gates-rebaseline-2p.jsonl`). 5/5 pass, no retries.
- **Per run (min / mean):** 25/25.3, 25/25.5, 25/25.4, 25/26.3, 25/26.5. Every run: lock held, other heavy 0, CPU 23–31 %, GPU 33–39 %, render fps 60.
- **Pooled 75 samples:** min 25, p5 25, median 26, mean 25.8.

| Quiet-machine runs today (lock held, other heavy 0 or paused sessions) | 2P pose-fps min |
|---|---|
| verify retry, 852efb0 | 28 |
| verify with waiters | 28 |
| re-baseline ×5 | 25, 25, 25, 25, 25 |
| final verify | 24 |

| Contended runs today | 2P pose-fps min |
|---|---|
| my verify 1, overlapping another e2e suite | 19 |
| verify with move-arcade-64 editing (tsc per edit + probe) | 15 |

- **Conclusion: 2P isn't marginal on a quiet machine.** The quiet minimum is 24–28 against a gate of 20, a 20–40 % margin, and every sample in 75 was ≥ 25.
- **Every earlier "2P is marginal" reading** (19, and 20 at `12c1ddf`) **came from contended runs.** No threshold changed.
- **The quiet level itself varies between runs** (repeat block 25–26 vs verify 28–30). The spread isn't explained yet. It's worth watching now that each value carries its machine state.

### Still open

- **Render budget:** the park biome is at 586k triangles; needed before the chaser and web-swinging get designed. Not built here; flagged so it isn't lost across branches.
- **The 7f68b4b amendments** (glove collision, prediction, body scan, 120 Hz) are under Jorge's review. Any §4.1 / authority-table conflict is his to resolve.


## 2026-09-16 — Perf follow-ups: quiet-variance pass, lock bypass list, provisional gates, contended-era audit

Branch `docs/plan-boxing` (`tmp/plan-boxing-worktree`), on `0457ca6`. No verify or re-baseline run: other sessions are active, and option B (lock infrastructure onto `main`, file by file) is another session's job.

### 1. Quiet-machine variance (2P pose-fps 28–30 vs 25–26): one pass

**The variance is a step in time, not a verify-vs-standalone difference.** From `tmp/verify/*.jsonl` and the logs:

| Run (local time, end) | Path | 2P min / mean | 1P pose min | 1P inference | CPU % | nvidia-smi GPU % |
|---|---|---|---|---|---|---|
| 23:00 | verify (retry) | 28 / 29.7 | 27 | 12.9 ms | — | — |
| 23:17 | verify | 28 / 29.6 | 30 | 12.3 ms | 28 | 42 |
| 23:20–23:22 | standalone ×5 | 25 / 25.3–26.5 | — | — | 23–31 | 33–39 |
| 23:25 | verify | 24 / 26.3 | 27 | 12.7 ms | 24 | 38 |

**Ruled out:**
- **Verify path vs standalone gate:** the 23:25 verify ran the full verify path and measured 26.3, the same level as the standalone block.
- **Power plan:** Balanced before and after, on AC at 100 %. No UserModePowerService, Kernel-Power or display-driver events in the System log since 22:30.
- **The apps Jorge planned to close:** GoPro Webcam (running since 09-15), NVIDIA Overlay (since 19:32), Codex/ChatGPT (since 19:43) and the stale Vite on 5173 were all running across the step. None started or stopped at ~23:18.
- **Dev-tool contention:** machine state showed `other heavy: none` in every run on both sides of the step (after the false-positive fix), and CPU busy was the same (23–31 %).
- **Per-pose inference cost:** 1P inference was 12.3–12.9 ms on both sides, and 1P pose-fps stayed at the camera's 30 fps cap.
- **Progressive thermal throttling (not supported):** five back-to-back 2P runs got slightly *faster* (mean 25.3 → 26.5), not slower. No GPU throttle reason is active now. Temperature and clock state weren't recorded at the time, so thermal is not excluded, only not supported.

**Mechanism (supported by earlier data, and why only 2P moves):**
- **Inference sits right at the frame budget in 2P:** 2 poses × ~12 ms plus transfer ≈ 25–29 ms against a 33 ms camera interval (Perf diagnosis entry: "23–29 ms of inference", 5–10 ms headroom). A few ms more per frame costs whole pose frames: 30 → 25.
- **1P has ~20 ms of headroom,** so the same perturbation is invisible there.
- **The same bimodality appeared earlier on the same code:** 2P means of 23.9, 25.2, 27.6, 28.3 and 29.7 across runs (Perf diagnosis entry).

**Unmeasured consumers of that headroom, found in this pass:**
- **`dwm.exe` on the RTX 4060's 3D engine:** 42 % while idle (per-process `\GPU Engine(*)\Utilization Percentage`). The RTX 4060 drives the external 1920×1080 display, so the desktop compositor shares the GPU with the pose worker. Its load depends on what's on screen, which a headless test doesn't control. The earlier gate column "GPU 33–42 %" is mostly this baseline.
- **A second Chrome process (pid 54084)** at 25 % GPU during a later idle check, plus Jorge's Chrome video decode at 4 %.
- **VS Code's extension host (NodeService)** at a steady ~1.2 cores (41,804 CPU-seconds so far).
- A SudoMaker virtual display adapter is installed.
- **None of these match the dev-tool classifier,** so none showed as CONTENDED.

**Conclusion:** the most likely cause is a change in background GPU load (compositor or browser) eating the 2P frame budget, not our code, the run path, power settings or dev tools. It isn't proven, because per-process GPU use wasn't recorded at 23:17–23:20.

**Closed going forward:** every gate's machine line now records `gpu top` (top 5 processes by GPU engine %) and GPU temperature / P-state / throttle reasons. The next shift is attributable from the log.

**Implication for the gate:** 2P's quiet floor on this machine is ~24–25 with this background, not 28–30. That's still ≥ 20, but the 2P margin is ~4–5 pose-fps, not 8–10.

### 2. Commands that bypass the perf lock (don't run these by hand while an e2e/perf run holds `.git/move-arcade-e2e.lock`)

**Waits for the lock (safe):**
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm verify` (each step)
- any vitest run using `vite.config.ts` or `vitest.tools.config.ts`: `pnpm exec vitest`, `npx vitest`, `pnpm tune:boxing`, `pnpm latency:gestures`, `pnpm latency:judder`
- `pnpm latency:pipeline` (tools project)
- `node scripts/perf-probe.mjs`
- the format-and-typecheck hook (≤ 45 s, then skips tsc), **once B lands on the checkout that sessions run hooks from**

**Fails fast instead:** `pnpm test:smoke` and any `playwright test` on smoke/perf.

**Bypass the lock:**

| Command | Why it escapes |
|---|---|
| `npx tsc`, `pnpm exec tsc`, `tsc -p .`, `node node_modules/typescript/bin/tsc` | calls tsc directly, not the `typecheck` script |
| `npx eslint`, `pnpm exec eslint …` | calls eslint directly, not the `lint` script |
| `vite build`, `pnpm exec vite build` | no build script exists; nothing wraps it |
| `pnpm dev` + a browser tab on the game (including the Claude browser pane and a real Chrome) | renders WebGL and runs the pose worker on the same GPU |
| `vitest --config <any other config>` or `vitest --globalSetup …` overrides | skips the configs that carry the lock `globalSetup` |
| ad-hoc Playwright/Chromium scripts (`node tmp/*.mjs`, e.g. GPU probes) | not a Playwright project; no global setup |
| `node scripts/vendor-*.mjs`, `scripts/make-placeholder-clip.mjs` | heavy I/O and CPU, not wrapped |
| `pnpm install` | CPU and disk, not wrapped |
| `prettier --write` over many files | CPU burst, not wrapped (the per-file hook run is negligible) |
| the hooks, until B lands | sessions run hooks from their project-dir checkout, which doesn't have the waiting hook yet |

**Rule for anything in the table:** run `node scripts/e2e-lock.mjs wait` first. The machine line catches tsc, eslint, vitest, playwright, vite build and probes if they overlap anyway. It doesn't catch browsers, the compositor, installs or vendor scripts; `gpu top` and CPU % cover part of that.

### 3. CONTENDED gate results are provisional, not pass/fail

- **Rule:** `recordGate` computes `contention(machine, softwareGpu)`. Any of these makes the result provisional:
  - other heavy processes
  - the perf lock not held by this run
  - a software renderer
- **What a provisional result does:**
  - it's still written to `gates.jsonl` with `status: "provisional"` and the reasons (a quiet run writes `status: "measured"`)
  - it prints `GATE <name> PROVISIONAL (<reasons>): not a pass or fail. Re-measure on a quiet machine.`
  - it adds a `provisional` annotation
  - it calls `test.skip`, so the gate's asserts don't run and Playwright reports it as skipped, not passed or failed
- **A verify with skipped perf gates isn't perf-green.** Its perf numbers need a quiet re-run.
- **Tested:** unit cases for `contention()` (quiet = none; each of the 3 reasons). **Not exercised end-to-end in Playwright:** that needs an e2e run, and none was allowed this pass. The skip path is plain `test.skip(true, reason)` inside the test body.

### 4. Earlier PROGRESS perf conclusions and the machine state they rest on

Before `0457ca6` no measurement recorded machine state. "Unrecorded" therefore means *provisional*, not *wrong*. Counts and strings (triangles, draw calls, renderer names) don't depend on contention.

**Rests on known-contended measurements (re-measure before relying on them):**
- **Perf diagnosis entry, all timing numbers.** The entry itself notes Jorge's WARP Chrome at 4.4 cores, VS Code and Codex running.
  - "No recent feature regressed anything measurable"
  - **park biome: "fps unchanged on this GPU", "inference +1–3 ms from GPU sharing", "Skate frame p50 1.3 → 2.1 ms", and the decision "Park triangles: not changed: no fps effect on a GPU"**
  - "2P has 5–10 ms headroom"
  - the two-workers vs one-worker comparison
  - the CPU-delegate-on-WARP bench
  - The **586k / 1.17 M triangle counts** are solid; the **render-budget conclusion drawn from them isn't.**
- **1080p fps 46 against ≥ 55** (Boxing spec entry): overlapped another session's e2e suite (22:26–22:34). Not a regression signal.
- **2P pose-fps 19** (same entry) and **15** (e2e-lock entry run 1, move-arcade-64 editing and probing): contended.
- **2P pose-fps 20 at `12c1ddf`:** flagged by move-arcade-64 as overlapping.
- **Visual expressiveness entry:** the parallel runs (14 pose-fps, 44 fps; ambient CPU ~50 % from a 5-Vite bisect), the "2P single samples 18 / 19", and "53 fps / 17 pose-fps while the other session was active". The conclusion that justified serializing perf tests is right in direction. Its numbers are contended.
- **Pose mirroring entry:** `verify-pose-1` 18.5 pose-fps / 2P render 51, and the "inconclusive" world-landmark-copy A/B (0–11 pose-fps).
- **Named players entry:** the smoke-perf split's A/B ("20–27 vs 2–30") and "2P dipped to 19". This was the WARP-Chrome era on the same afternoon.

**Machine state unrecorded, no known contention (provisional):**
- **M1:** pose 29.8 fps.
- **M4:** 60 fps, pose 28–31.
- **Input-to-screen latency entry:** the filter retune was based on these latency numbers.
- **Art (Quaternius):** 60 fps at 1450 m.
- **Piece 3:** "2P costs about −4 pose-fps / +7 ms".
- **Piece 4 Boxing:** the perf table.
- **Features entry:** 2P pose 22–27.
- **Named players verify:** 2P 26–30.

**Recorded quiet (usable):** from the e2e-lock retry onward. 2P pose-fps min 28 at 23:00 and 23:17, then 25 ×5 and 24 after the step described in §1, each with its machine line.

**Render budget (still open, not built here):** the park biome's triangle counts stand. Its "no fps effect" conclusion is contended-era and needs a quiet re-measure with the `gpu top` line before the chaser and web-swinging budget is set.


## 2026-09-16 — Contention check widened to measured external load; render-budget measurement specified

Branch `docs/plan-boxing` (`tmp/plan-boxing-worktree`), on `1612791`. No verify, e2e or baseline run: Jorge changes the display routing first. Session move-arcade-32 ports these files onto `chore/perf-lock` (agreed: it dropped its own waiter registry and threshold version, and keeps a gate-coverage reporter).

### Contention check: "how much of the machine is not mine", not "is a dev tool running"

- **Supersedes** the name-based catch described at the end of "Perf follow-ups" §2.
- **Removed:** process-name matching (`HEAVY`, `WRAPPER`, `otherHeavy`, `isHeavyCommand`) and its unit table. It saw none of the real load (the compositor, a browser, the editor).
- **`tests/e2e/machine-state.ts` now samples Windows performance counters** for `contentionConfig.samples` = 3 s:
  - **External GPU %:** `\GPU Engine(*engtype_3D|Compute)\Utilization Percentage`, per process, summed over processes that aren't this run, on **the adapter this run renders on**. The adapter is where this run's own processes are busiest, else the busiest adapter.
  - **External CPU in logical cores:** `\Process(*)\% Processor Time` joined to `ID Process`, excluding Idle and this run.
  - **Total CPU %**, **own GPU %**, and the **top 5 external processes by GPU and by CPU**, with names for the report only, never for the decision.
  - **nvidia-smi:** utilization, temperature, P-state, throttle bitmask.
- **"This run"** = the worker's ancestors plus everything the Playwright runner spawned (workers, headless Chrome and its GPU process, Vite, the sampler). Without a recognisable runner, everything the worker spawned.
- **Provisional rule** (`contention()`), thresholds in the new `tests/e2e/contention.config.ts`:
  - external GPU > `maxExternalGpuPct` = **10 %**
  - external CPU > `maxExternalCpuCores` = **2 cores**
  - counters unavailable (never silently "measured")
  - lock not held
  - software renderer
  - **The thresholds are untuned start values,** to be set from Jorge's display-routing before/after. move-arcade-32 presents them to Jorge for sign-off; this file is the only set.
- **Side effect:** sessions blocked in `waitForLock` poll every 2 s and use about 0 CPU/GPU, so they no longer count as contention. move-arcade-32 found that the name rule counted them and skipped every gate; that's why a registry isn't needed.
- **Ceiling (`ponytail:`):** counters are read right *after* the gate's sampling window, not during it. A load that ends exactly with the window is missed. The upgrade is a streaming sampler started with the test.

**Bug found while checking the live path:** under vitest, `Get-Counter` exits with status 1 while still printing every valid sample; processes exit mid-sample during test runs. The first version threw that output away and reported "not measurable". It now keeps stdout whenever it parses.

**Live read on this machine (not a gate run; lock not held; 23:5x):**
- external GPU **29.8 %** (dwm.exe 28.7 %, claude.exe 0.8 %)
- external CPU **4.76 cores** (Code.exe 1.04, MsMpEng.exe/Defender 0.70, dwm.exe 0.60, two node.exe 0.43 + 0.31)
- nvidia 38 %, 47 °C, P5, throttle bitmask 0x1 (GPU idle)
- **Under this rule the machine is contended right now,** as Jorge suspected: the old "quiet" baselines weren't quiet.

**Verified (unit only):**
- `tests/unit/perf-lock.spec.ts`, 21 passed together with `guard-paths.spec.ts`:
  - the threshold table: dwm at 42 % → provisional; extension host + browser at 2.4 cores → provisional; lock not held; software; counters unavailable → provisional; quiet → measured
  - `summarizeLoad` on synthetic counter rows: dwm on our adapter → external 42; our Chrome 20 + 5 → own 25; Code at 1.2 cores; Idle excluded; another adapter's load ignored
  - `ourPids`: the runner's descendants including Chrome's GPU process, and the no-runner fallback
- tsc and eslint clean.

### UNTESTED IN ANGER: the provisional rule has never run end-to-end in Playwright

The provisional path (`recordGate` → `contention()` → annotation → `test.skip`) and the load sampler inside a real perf gate have **not** run in a Playwright e2e run. Unit tests and one live vitest read only; no e2e was allowed this pass.

**Don't treat the first provisional (or measured) gate result as verified behaviour.** The first real run must check, from its `GATE <name> machine:` lines:
1. Own GPU % is non-zero while the game renders, so the adapter pick and the "ours" tree work with real Chrome processes.
2. Headless Chrome and its GPU process are *not* in the external top lists.
3. A deliberately contended run (e.g. a video playing on the dGPU display) comes out PROVISIONAL, and a quiet one comes out measured.
4. move-arcade-32's coverage reporter fails the run when every @perf gate is provisional.

### Render-budget measurement: specified, not run

`docs/RENDER-BUDGET-MEASUREMENT.md`: what the session Jorge assigns measures, after the display change, so the chaser + skyhook get a number instead of the void "no fps effect" conclusion.
- **Preconditions:** routing recorded, lock held, contention not provisional at the start and end of every scene.
- **Scenes:** Skate 1P/2P street and park with pose, 2P park without pose, a Boxing 2P control scene for machine drift, and 2P park headed on the real display (the cross-adapter present after routing).
- **Procedure:** 5 round-robin repetitions, uncapped render, p95s. The set is valid only if the control drifts ≤ 10 %.
- **Budget arithmetic:**
  - render headroom = 16.7 − frame p95 − 2.5 ms reserve
  - pose headroom = 33.3 − 2P inference p95 − 5.0 ms reserve
  - marginal ms per triangle from street → park
  - allowance per view = min over the two budgets, halved for 2P
  - draw calls: ≤ 150 − R4 calls − 10, halved per view
  - negative headroom means cut park geometry first
- **Handover sentence:** "≤ T triangles, ≤ D draw calls per view; 2P added frame p95 ≤ Hr; added inference p95 ≤ Hp".


## 2026-09-17 — CPU contention threshold: question framed, sweep prepared (not run); `pnpm machine:state`

Branch `docs/plan-boxing` (`tmp/plan-boxing-worktree`), on `6a28bf5`.
- **Signed off by Jorge:** `maxExternalGpuPct` 10 %.
- **Not signed off:** `maxExternalCpuCores` 2. Jorge's objection: this machine's steady external CPU is ~3–5 cores (VS Code ~1.0, Defender ~0.7, dwm ~0.6), so 2 cores would make every gate provisional forever, and with the zero-gates reporter no run could ever pass.
- **Nothing was run on the GPU:** Jorge is changing the display routing and measuring before/after.

### Q1: does CPU load move pose-fps on this machine? Existing evidence doesn't answer it

- **Points at GPU:** 1P inference held at 12.3–12.9 ms across the 2026-09-16 variance step, and 2P moves because inference takes 25–29 ms of a 33 ms frame.
- **The only controlled CPU test is partial:** main thread throttled 4× (probe `boxing-*-pose-cpu4x`) left inference unchanged (12.3 / 23.1 ms). It dropped render min to 47 / 42 and 2P pose mean to 26.1 (min 22). It throttles only the page's main thread, not the pose worker, the GPU process or the machine.
- **The uncontrolled probe history is inconclusive:** `tmp/perf/probe-*.json` shows 2P pose 15–30 with inference 23–42 ms, but no machine state was recorded, so CPU and GPU load can't be separated.
- **Candidate CPU-bound steps exist:** frame capture/transfer, WASM pre/post-processing around the GPU delegate, and 2-pose postprocessing. So CPU can't be ruled out on reasoning alone.

### Q2: set the threshold from measurement: `scripts/cpu-contention-sweep.mjs` (prepared, not run)

- **Load:** N worker threads spinning at normal priority, N ∈ {0, 2, 4, 6, 8, 10, 12, 14} of 16 logical cores (Ryzen 7 7735H, 8 cores / 16 threads). This is external load, like the editor or Defender.
- **Workload:** `perf-probe` `skate-2p-pose` (binding) and `skate-1p-pose` (control), 20 s each. The probe waits for and holds the perf lock.
- **Design:**
  - 3 repetitions, order alternating ascending/descending so heat and drift spread across levels
  - 10 s cooldown between points
  - per point: pose mean/min, inference ms, render min, whole-machine CPU busy %, nvidia temperature and throttle bitmask
  - `pnpm machine:state` taken first as the idle external-CPU offset
- **Decision (pure `summarize`, unit-tested in `tests/unit/cpu-sweep.spec.ts`):**
  - **onset** = the lowest added load where 2P pose mean < baseline − max(1 fps, 2 × sd of the baseline repetitions)
  - **no onset** up to 14 added cores → **CPU becomes reported-only, not gated**
  - **onset found** → threshold = idle external cores + the last level that didn't degrade, in the same "external cores" unit the gate measures
- **Run it only on the quiet GPU after the display change:**

  ```bash
  node scripts/cpu-contention-sweep.mjs
  ```

  About 25–30 min. Output in `tmp/perf/cpu-sweep.json` plus a printed table and proposal.
- **Not verified end to end:** the script hasn't run. Only the summary logic has unit tests; the orchestration (burners, probe, Vite) is unexercised.

### `pnpm machine:state` (new; the "live-read path")

- **What it is:** `tests/tools/machine-state.tool.ts` runs the same `machineState()` read every perf gate records. It writes `tmp/machine-state/<MACHINE_LABEL>.json` and prints external GPU/CPU with the top processes.
- **Before/after of the display change:** `MACHINE_LABEL=display-before pnpm machine:state`, then `display-after`.
- **Why:** my earlier live reads came from a throwaway spec, so Jorge had no command to reproduce them.

### Two more live-path bugs fixed

- **Process list salvage:** `Get-CimInstance Win32_Process` also exits 1 mid-enumeration while printing valid rows. The process list came back empty, so names were "?", and worse, **nothing could be attributed to this run**: its own browser would have counted as external. The PowerShell helper now keeps stdout for every call.
- **Empty process list → not measurable:** if it's still empty, the load is "not measurable" (provisional), never a reading.
- **Three consecutive reads (idle, lock not held):**
  - external GPU 30 / 30 / 27.1 % (dwm.exe 28.9 / 28.9 / 25.9)
  - external CPU 2.91 / 3.55 / 3.04 cores (Code.exe 0.99–1.01, dwm.exe 0.57–0.63)

### First-real-run confirmation list: one item added (Jorge)

5. **A run where every @perf gate is provisional fails end to end** with move-arcade-32's `GATES: no gates measured`: a real Playwright run on a contended machine, not only the reporter's unit tests. This is the guard against the false-green hole.
## 2026-09-16 — Perf lock and gate logging onto main (harness only)

Branch `chore/perf-lock`, from `main` (`6708eb4`), built in `tmp/perf-lock-worktree`. Jorge's option B: the lock goes to main so every branch picks it up by merging main, without the feature work around it on `docs/plan-boxing`.

### Why

- The lock and the worktree-aware guard existed only on `docs/plan-boxing` (`0457ca6`). Claude Code runs hooks from the main checkout, so they applied only while that checkout sat on a branch that had them.
- Merging `0457ca6` into another branch would also have brought 7 unrelated commits: named players and stats, the Boxing glove-latency e2e and `boxer.ts` changes, and PLAN-BOXING D1–D5.

### What changed

- **Cherry-picked `448e4cf`** (perf diagnosis): `src/platform/gpu.ts` (GPU name, software-GL detection), CPU delegate on software GL, `scripts/perf-probe.mjs`, pose-panel redraw only on new frames, research doc. It was based on `main`, so it applied cleanly.
- **From `852efb0` + `0457ca6`, harness files only:**
  - `scripts/e2e-lock.mjs` (+ `.d.mts`), `scripts/vitest-perf-lock.mjs`; the probe holds the lock
  - `tests/e2e/global-setup.ts` (takes the lock for the run; models check), `gates.ts`, `machine-state.ts`
  - `.claude/hooks/guard-paths.mjs` (paths resolved against the containing checkout), `format-and-typecheck.mjs` (waits ≤ 45 s for the lock, then skips tsc)
  - `package.json` (`typecheck`/`lint` wait for the lock; `test:smoke` = smoke + perf), `vite.config.ts` / `vitest.tools.config.ts` (lock globalSetup), `eslint.config.js` (`setTimeout` global), `playwright.config.ts` (global setup, `PLAYWRIGHT_PORT`, serial `perf` project)
  - `tests/unit/perf-lock.spec.ts`, `guard-paths.spec.ts`
  - Specs: `@perf` / `@realtime` tags and `recordGate` calls in `pose`, `gestures`, `render`, `two-players`; `@realtime` on the two Boxing pose replays (hand-applied: `0457ca6`'s `boxing.smoke` also carries player-stats menu clicks that don't exist on main).
- **Left out on purpose:** `?names=` in AGENTS §5 (player stats isn't on main), `boxing-visual` / `boxing-latency` specs (not on main).
- AGENTS §4 perf-lock rules; ARCHITECTURE Harness.

### Verified

- **`pnpm verify` → exit 0** (`tmp/verify/verify-perf-lock-1.log`, `PLAYWRIGHT_PORT=5191`): tsc, eslint, vitest 342 passed + 1 skipped (24 files), playwright 22/22. Retries: 0 on every gate.
- **Gates are PROVISIONAL, not pass/fail.** Each gate's machine line reads `CONTENDED` with the same 2 other heavy `node` processes (pid 32144 from `AppData\Roaming\…`, pid 51144 from `…\web-games\…`; both had exited by the time I looked, so only the truncated command lines are known). GPU on every gate: `ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU … D3D11)`, pose delegate GPU.

  | Gate | Measured | Limit | Machine |
  |---|---|---|---|
  | pose-1p-5s | pose-fps 29.5, with-pose 1.0 | ≥ 20, > 0.9 | cpu 21 %, gpu 68 %, lock held, CONTENDED (2) |
  | skate-1p-1080p-bot | fps min 59, calls 57 | ≥ 55, < 150 | cpu 16 %, gpu 38 %, CONTENDED (2) |
  | skate-1p-1080p-pose | fps min 60, pose-fps min 29, calls 57 | ≥ 55, ≥ 20 | cpu 24 %, gpu 39 %, CONTENDED (2) |
  | skate-2p-1080p | fps min 60, pose-fps min 26 (mean 28.3), calls 110–114, tris 1.13–1.26 M | ≥ 55, ≥ 20, < 150 | cpu 46 %, gpu 40 %, CONTENDED (2) |

- **Rule recorded (Jorge, 2026-09-16):** a gate whose machine state shows contention is reported as provisional, whether it passed or failed. A green gate on a busy machine is as misleading as a red one.

### Known gaps

- **Scope is still branch-dependent until every active branch merges main.** Hook commands come from the main checkout's `.claude/settings.json` and resolve scripts relative to it; a branch without this commit runs the old hooks, and a worktree on such a branch runs vitest/Playwright without the lock. Proposal for Jorge in the session report (settings are human-owned).
- **Quiet-window agreements between sessions** should now be enforced by the lock, not by message (Jorge's note).
- **No `.gitattributes`:** Git warns LF→CRLF on files written by sessions. Task raised after this lands.

---

## 2026-09-17 — Hook launcher, zero-gates guard, .gitattributes (committed WITHOUT e2e, by exception)

Branch `chore/perf-lock` (`tmp/perf-lock-worktree`). Three items, committed on Jorge's explicit authorization as an exception to AGENTS §3 (verify green before commit).

### Why an exception

- **Deadlock:** e2e can't validate the lock because e2e can't produce a trustworthy result until the lock and the load rule exist. External load on this machine right now is ~30 % GPU (dwm on the external display) and ~4.8 CPU cores, so every gate would be contended.
- **Scope:** only the three items below. The `1612791` / `6a28bf5` gate and machine-state port is **held**; it isn't covered by the exception.

### What changed

1. **`.claude/hooks/run-main.mjs`** (+ `tests/unit/run-main.spec.ts`): runs a hook from `main`'s committed tree, exported once per main commit into `<git-common-dir>/claude-hooks/<sha>/`, whatever branch the checkout has out.
   - Fail **closed** for `guard-paths` (anything but its own 0/2 blocks), **open** for `format-and-typecheck` and `remind-progress-log`.
   - Exports with `git ls-tree` + `git show`, not `git archive | tar`: Git Bash's GNU tar reads `C:\…` as a remote host.
   - Takes effect only when Jorge points `.claude/settings.json` at it. Commands (human-owned file): `node .claude/hooks/run-main.mjs guard-paths || exit 2`, `node .claude/hooks/run-main.mjs format-and-typecheck`, `node .claude/hooks/run-main.mjs remind-progress-log`. The `|| exit 2` blocks even if the launcher file itself is missing.
   - The e2e lock can't be made branch-independent this way: vitest/Playwright use their own branch's config, so each active branch still has to merge main (accepted).
2. **`tests/e2e/gate-coverage-reporter.ts`** (+ `tests/unit/gate-coverage.spec.ts`, `playwright.config.ts` reporter): a run whose selected `@perf` gates were all provisional (or skipped) prints `GATES: no gates measured` and ends with status failed, so zero-coverage green can't happen. Every run with gates prints `GATES: X measured, Y provisional`.
   - Why now: with provisional gates skipped, a lock-waiting `format-and-typecheck` counted as contention made every gate provisional and verify exited 0 having measured nothing (`tmp/verify/verify-perf-lock-3.log`).
3. **`.gitattributes`:** `* text=auto eol=lf`, binaries marked. The index was already all LF (149 text, 31 binary, 1 empty); `git add --renormalize .` changed no file.

### Verified (without e2e)

- `pnpm typecheck`, `pnpm lint` → exit 0. `pnpm test` → 26 files, 350 passed + 1 skipped (held port set aside, so this is exactly the committed tree).
- **Launcher (unit, temp repos):** main's guard blocks `docs/PLAN.md` while the checked-out branch's guard allows everything; main's Stop hook runs, not the branch's; a crashing advisory hook exits 0; an unknown hook exits 2; with no `main`, the guard exits 2 ("could not run from main") and advisory hooks exit 0.
- **Reporter, end to end in real Playwright** (throwaway config in `tmp/gate-cov-check/`, no browser): every `@perf` gate provisional → exit 1 with `GATES: no gates measured (1 provisional)`; one gate measured → exit 0.

### Must be re-validated on the first trustworthy gate run (after Jorge's display change)

- **Reporter:** the real verify prints `GATES: N measured, M provisional`; a run with every gate provisional exits non-zero; a run with measured gates exits by their pass/fail.
- **Launcher:** after the `settings.json` edit, an Edit on `docs/PLAN.md` from a session in the main checkout and from a worktree session is blocked; a `.ts` edit still gets prettier + tsc (or the lock-skip message); `.git/claude-hooks/<main sha>/` exists.
- **`.gitattributes`:** after merging main, `git status` in each checkout shows no line-ending-only modifications and the LF→CRLF warnings are gone.

### Decisions recorded (Jorge, 2026-09-17)

- **External GPU ≤ 10 % → measured; above → provisional: approved.** The 2P pose-fps min 19 read as "quiet" had dwm at 20.6 %, so it was taken under load and isn't a real red.
- **External CPU threshold: not approved.** VS Code, Defender and dwm (~4.8 cores idle) are the machine's steady state, not contention, and gates must measure the machine as developed on. Derive it from measurement: if external CPU doesn't move pose-fps, report it in the machine line without making results provisional; if it does, set the threshold where pose-fps degrades. One session measures it (coordinated with `move-arcade-bd`).


## 2026-09-17: CPU sweep pass 1 (stopped early); the 2P scatter is now the first question; display-unplugged reference

Branch `docs/plan-boxing` (`tmp/plan-boxing-worktree`).

### Pass 1 of the CPU sweep ran; passes 2–3 were stopped

- **Window:** 00:16–00:29, agreed with move-arcade-32. Display plugged in (dwm on the 4060).
- **Stopped at 00:29:** Jorge's camera playtest started (new Chrome processes from 00:28:31) while 14 burner threads were running. It would have ruined his fixture recordings and contaminated the sweep. The processes were killed and the stale lock this run left was removed.
- **No `tmp/perf/cpu-sweep.json`:** the summary is written only at the end. The numbers below come from `tmp/perf/cpu-sweep.log` (idle offset in `tmp/machine-state/cpu-sweep-idle.json`: external CPU 4.02 cores, external GPU 29.4 %, dwm 28.3 %).

| Added threads | CPU busy | 2P pose mean / min | 2P inference | 1P pose mean / min | Render min 2P / 1P |
|---|---|---|---|---|---|
| 0 | 49 % | 24.1 / 18 | 26.6 ms | 28.3 / 25 | 60 / 60 |
| 2 | 54 % | 24.7 / 21 | 27.9 | 28.8 / 26 | 60 / 60 |
| 4 | 62 % | 24.8 / 20 | 26.2 | 29.6 / 29 | 60 / 60 |
| 6 | 70 % | 25.1 / 24 | 26.7 | 29.2 / 27 | 60 / 60 |
| 8 | 80 % | 26.2 / 23 | 27.5 | 29.4 / 27 | 60 / 60 |
| 10 | 92 % | 28.2 / 23 | 27.4 | 27.9 / 23 | 59 / 60 |
| 12 | 95 % | 23.1 / 16 | 28.2 | 29.1 / 26 | 55 / 60 |
| 14 | 100 % | 16.6 / 13 | 35.1 | 25.4 / 21 | 57 / 58 |
| 14 (pass 2) | 100 % | 17.6 / 15 | 35.6 | 24.3 / 16 | 56 / 43 |

- **Q1 (does CPU load move pose-fps?):** yes, but only near saturation. No 2P drop up to 10 added threads (92 % busy). It starts at 12, and at 14 2P loses about 7 fps with inference at 35 ms. The old 2-core proposal was an order of magnitude low.
- **Planned shape (Jorge, not final until passes 2–3):** CPU is report-only in the machine line, with a provisional trigger near saturation (about 14 external cores = 4 idle + 10 added threads with no effect).
- **One pass only:** the 100 % rows partly overlap the start of the playtest, although the two agree within 1 fps.

### The 2P scatter is the real problem (first-class question)

- **At level 0–10, 2P mean ran 24.1–28.2 fps** with no load-dependent trend. That is larger than any effect below 12 added threads.
- **The same size as before:** the unexplained 25–26 (repeat block) vs 28–30 (verify runs) from earlier reports.
- **Already ruled out:** other sessions' work, dwm alone and CPU load.
- **Next pass instruments it:** `scripts/sweep-telemetry.mjs` samples at 1 Hz during the whole sweep:
  - `nvidia-smi -l 1`: util %, temperature, graphics clock MHz, power W, P-state, throttle reasons
  - `typeperf`: dwm's 3D engine % per adapter
  - `perf-probe` now emits a per-second `series` (wall clock, render fps, pose-fps, inference ms)
- **`correlate()`:** Pearson r of 2P pose-fps against each reading, per second and per run (the run-to-run scatter), levels ≤ 10 only. It goes into `tmp/perf/<label>.json` as `scatter` and is printed.
- **If nothing correlates, that is reported as a finding:** the 2P gate can't be made reliable on this machine at its current threshold.

### Display: unplugged is the gate reference config (Jorge, 2026-09-17)

- **Why:** the external port appears hardwired to the RTX 4060, so dwm can't be moved.
- **Decision:** gate runs and perf re-measures are done with the external display unplugged. The normal setup (external display) stays for development.
- **Recording it:** the sweep records `displays()` (WmiMonitorConnectionParams: internal vs external).
- **Built-in experiment:** passes 2–3 run unplugged. If the 24–28 scatter persists without dwm on the dGPU, dwm is ruled out as its cause.
- **Not yet applied to gates:** the gate machine line doesn't record the display config yet. That belongs with the machine-state port (move-arcade-32), so I left it out here.

### Checks

- **Tests and lint:** `tests/unit/sweep-telemetry.spec.ts` (parsers, and correlation that picks the reading tracking the scatter and ignores saturated runs) and `cpu-sweep.spec.ts` pass. `pnpm typecheck` clean; eslint and prettier clean on the changed files.
- **Sampler smoke run (5 s):** 10 rows, and both files flush on kill. Displays read `{internal: 1, external: 1}`.
- **Not run:** e2e, and no full `pnpm verify` (Jorge was recording on the machine). The instrumented sweep itself is not yet run end to end.

### Next

Once Jorge is off the machine and has unplugged the display, in a quiet window agreed with move-arcade-32 (and move-arcade-64 holding its verify):

```bash
node scripts/cpu-contention-sweep.mjs --label cpu-sweep-unplugged
```

About 32 min for 3 passes. Then report Q2 (the CPU trigger) and the scatter correlation.
