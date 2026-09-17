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
