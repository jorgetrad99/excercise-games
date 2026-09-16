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
