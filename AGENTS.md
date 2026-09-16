# AGENTS.md — Operating rules for AI agents in `move-arcade`

You are working in a browser game controlled by body pose from a webcam. You cannot stand in front of the camera and you cannot see the 3D scene. The project is built so you don't have to: a deterministic core, recorded fixtures, a fake camera for the browser, and a debug bridge. **Use them. Never claim something works because it compiles.**

This file is a map, not an encyclopedia. Details live in `docs/`. Read `docs/PLAN.md` once per session and `docs/PROGRESS.md` + `docs/features.json` at the start of every session.

---

## 1. Navigation: LSP first, grep second

Claude Code exposes an **LSP tool** (via the `typescript-lsp` plugin). Prefer it for anything symbol-shaped:

- Where is X defined? → `goToDefinition` / `goToImplementation`
- Who uses X? → `findReferences` (returns the _exact_ set; grep returns a superset full of comments, strings and same-named methods)
- What's in this file? → `documentSymbol`
- Find a type/function by name across the repo → `workspaceSymbol`
- Is this file broken? → `getDiagnostics` (do this after every edit of a `.ts` file, before running the full typecheck)
- What calls this? → `incomingCalls` / `prepareCallHierarchy`

Use `grep`/`rg` **only** for literal text: strings, config keys, TODO markers, CSS class names, JSON fields, Markdown. Trust the language server's results; do not re-read files to "confirm" them.

If the LSP tool returns nothing for a symbol that should exist, the server may not be running: say so explicitly, run `/lsp` status if available, and fall back to grep for that one query. Do not silently degrade to grep for the whole session.

Docs for third-party APIs: use the Context7 MCP (`three`, `@mediapipe/tasks-vision`, `colyseus`) before writing an API call you are not certain about. three.js has changed significantly across releases; your memory of it is probably stale.

## 2. Session protocol

1. **Orient** (≤ 5 min): read `docs/PROGRESS.md` (last 2 entries) and `docs/features.json`. Run `git status` and `pnpm verify`. If verify is red at session start, fixing it is the first task.
2. **Plan**: state which milestone/feature you are taking, the files you expect to touch, and the DoD line(s) you will satisfy. Keep it to one feature at a time.
3. **Build** in small steps: interface first, then tests, then implementation. Commit after each green `pnpm verify` with a conventional message (`feat(core): …`, `test(pose): …`).
4. **Verify** (§4). No exceptions.
5. **Log**: append to `docs/PROGRESS.md`: date, feature, what changed, what was verified _and how_ (command + result), known gaps, next step. Update `docs/features.json` statuses.
6. **Stop when the milestone DoD is green**; don't drift into the next milestone. Leave the tree clean.

If you are stuck on the same problem for two attempts, stop, write what you tried in PROGRESS.md, and ask a precise question. Don't work around by disabling a test, loosening a type, or adding `// @ts-ignore`.

## 3. Hard boundaries (hooks enforce some of these; the rest is on you)

- **`src/core/` is pure TypeScript.** No `window`, `document`, `three`, `requestAnimationFrame`, timers, `Math.random`. Randomness comes only from the seeded PRNG passed in. ESLint boundaries rule fails the build otherwise.
- **Determinism is a feature.** `GameSim.step(dt, events)` with the same seed and event log must produce identical state. There is a test; keep it green.
- **Do not edit** `fixtures/**`, `public/models/**`, `docs/PLAN.md`. They are human-owned. If a fixture seems wrong, say so in PROGRESS.md.
- **No new runtime dependency without an ADR** in `docs/DECISIONS/`. Dev dependencies need a one-line justification in the commit message.
- **Pinned versions.** No `latest`, no `^` for `three` or `@mediapipe/tasks-vision`.
- **No network at runtime for models/wasm.** They are vendored under `public/models/`.
- **Assets:** CC0 by default. Any CC-BY file must be listed in `CREDITS.md`; a test checks this.
- **Files ≤ 400 lines, functions ≤ 60.** Split rather than scroll.
- Never remove or skip a failing test to make verify green. Never widen a type to `any` to silence the compiler.
- Never run `git push --force`, `rm -rf` outside `tmp/`, or modify `.claude/settings.json` hooks.

## 4. Verification — what "done" means here

`pnpm verify` = `tsc --noEmit` + `eslint` + `vitest run` + `playwright test --project=smoke`. It must be green before any commit and before you say a task is done.

Beyond that, verify at the level of the thing you changed:

| You changed…                  | Verify with…                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gesture logic / signals       | fixture-driven unit tests (`fixtures/pose/*.json` → exact event sequences). Add a fixture-based test for every new event.                                              |
| core sim / worldgen / scoring | determinism test, solvability test, headless bot run (`tests/unit/core/bot.spec.ts`)                                                                                   |
| rendering                     | Playwright with `?game=skate-run&input=keyboard&seed=42&debug=1`: screenshot at fixed times, compare to baseline; read `window.__game.getFps()`; check console for three.js warnings  |
| camera / pose pipeline        | Playwright with fake camera (`--use-fake-device-for-media-stream --use-file-for-fake-video-capture=fixtures/video/<clip>`): assert pose-fps ≥ 20 and ≥ 1 pose detected |
| multiplayer                   | in-process Colyseus server + 2 headless clients; assert both finish with the same chunk sequence for the shared seed                                                   |
| docs only                     | `pnpm lint:md` if present; otherwise nothing, but still log                                                                                                            |

When a check can't be automated (e.g., "does the lean feel responsive?"), say so explicitly and leave a **playtest note** for Jorge in PROGRESS.md with the exact URL/params to reproduce.

Screenshots and state dumps go to `tmp/` (git-ignored). Reference them by path in PROGRESS.md.

## 5. How to use the runtime as an agent

- `pnpm dev` then open `http://localhost:5173/?game=skate-run&debug=1&input=keyboard&seed=42` (without `?game=<id>` the game-select menu shows)
- `window.__game.getActiveGame()` — launched MiniGame id (null on the menu); `getState()` — full sim snapshot; `getSignals()` — live pose signals; `inject({type:'JUMP'})` — fire an input event; `setSeed(n)` — restart deterministic run.
- `?input=replay:jump.json` — drives the game from a recorded fixture; `?record=1` — records a fixture (human only).
- `?players=2` — split screen; `?model=lite|full|heavy`; `?camera=<deviceId>`.
- The `/playtest <seed> <input>` command wraps the above in headed Playwright and saves artifacts.

## 6. Code style (short)

TypeScript strict, ESM, named exports, no default exports except `MiniGame` registrations. Prefer plain functions + small interfaces over class hierarchies. Constants that a human will tune live in `*.config.ts` files with a comment explaining the unit. Comments explain _why_, not _what_. Tests are colocated (`foo.spec.ts`) except e2e. Commit messages: Conventional Commits, imperative, scoped by folder.

## 7. Working with Jorge

Jorge is a senior engineer who runs this project and playtests it. Assume competence; be concrete. When you need a decision, offer the options with your recommendation and the trade-off in two lines. When you finish a milestone, write the PROGRESS entry as if he'll read only that.

Language: code, comments, docs and commit messages in **English**. Chat replies in the language Jorge uses.
