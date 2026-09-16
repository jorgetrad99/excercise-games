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
