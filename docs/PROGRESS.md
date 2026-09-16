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
