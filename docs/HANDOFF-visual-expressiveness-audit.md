# Handoff: audit of Codex's `feat/visual-expressiveness` (2026-09-16)

Audit only. I didn't change, fix or commit anything on either branch. Every claim below comes from reading the code or running commands, not from Codex's docs or notes.

## TL;DR

- **Nothing was committed.** `feat/visual-expressiveness` points at `f4a903c`, which is **one commit behind `main`** (it's missing the PoseState commit `6708eb4`). All of Codex's work is **uncommitted** in a git worktree at `tmp/visual-expressiveness-worktree/`. That folder is git-ignored, so cleaning `tmp/` or running `git worktree remove` would delete the work with no trace. **Commit it (even as WIP) before anything else.**
- **Scope boundary held.** Codex didn't touch `src/pose/`, `src/core/` or `src/input/`.
- **`pnpm verify` is green on the worktree**: typecheck, lint, 320 unit tests (1 skipped, which predates Codex), 25 smoke tests.
- **Code merges into `main` without conflicts.** In a trial merge, typecheck, lint and all 328 unit tests pass. Only `docs/ARCHITECTURE.md` and `docs/features.json` conflict, and both branches claim the ID **`M7.10`**.
- **Main has its own bug, and it's not from Codex.** On pure `main`, the live fake-camera test never produces a face crop in Boxing (FACEDBG count stays 0 for 30 s). The same test passes on `f4a903c`. Repro is below.
- **Status per item:** 1 = partly done, with one design bug. 2 = mostly done. 3 = partly done (no real swelling).
- **Recommendation: salvage, don't restart.** The work is tested, small (about 1.4k lines including tests) and follows the codebase's patterns. About **4–5 agent-days** remain, most of it targeted rework rather than new code.

## State at audit time (before I did anything)

| Item | State |
| --- | --- |
| Main checkout | branch `main` @ `6708eb4`; untracked `scripts/perf-probe.mjs` (not mine; `tests/tools/punch-sampling.tool.ts` and `tmp/perf-wt/*` worktrees appeared during the audit, so another session was active) |
| `feat/pose-mirroring` | `6708eb4` = `main` = `origin/feat/pose-mirroring`. **Nothing uncommitted.** I didn't need to switch branches or stash. |
| `feat/visual-expressiveness` | `f4a903c`, **0 commits** of its own; reflog shows only "Created from HEAD" |
| Codex work | worktree `tmp/visual-expressiveness-worktree/`: 10 modified files and 11 untracked paths; file mtimes run 19:53–20:23 |

For the trial merge and the main-only check I used two temporary detached worktrees. I removed both afterwards. Nothing else changed.

## a. Inventory

**Modified:** `CREDITS.md`, `docs/ARCHITECTURE.md`, `docs/features.json`, `playwright.config.ts`, `src/render/big-head.ts`, `src/render/boxing/boxer.ts`, `src/render/boxing/view.ts`, and the 3 Boxing screenshot baselines.

**New:**

- `src/render/boxing/`: `animation.ts` (152 lines), `presentation.ts` (132), `face-damage.ts` (60), `pose-state.ts` (67), `visual.config.ts`, `presentation.spec.ts`, `pose-state.spec.ts`
- `public/assets/quaternius/boxing/`: `hit-head.json` (baked clip) and `License.txt`
- `scripts/vendor-boxing-reaction.mjs`
- `tests/e2e/boxing-visual.smoke.spec.ts` and `tests/e2e/boxing-visual-harness.ts`

Screenshots Codex took are in `tmp/visual-expressiveness/`. The UAL source archive is there as well (14 MB, git-ignored).

### Item 1: knockout/get-up animations and hit reactions. **Partial**

What exists:

- **Hit reaction (head snap):** UAL `Hit_Head` is baked offline into 27 world-space head quaternion deltas (`scripts/vendor-boxing-reaction.mjs` → `hit-head.json`). At runtime they're applied to the `Head` bone (`animation.ts` `rotate`/`reactionAt`). A procedural yaw kick is added on top, toward the side that was hit.
- **Stagger:** procedural translate and roll of the whole boxer from the hit side (`boxer.ts`). No clip is used.
- **KO fall:** plays the **existing Casual_Hoodie `Death` clip** over `fallS` = 0.7 s. It isn't a UAL clip.
- **Get-up:** hand-authored. It blends from the Death end pose, through a crouch, to idle during the last part of a recoverable count (`animation.ts` `recovery`). Codex says UAL Standard has no get-up clip. **I haven't verified that.**
- **Tests:**
  - `presentation.spec.ts` covers fall, rise and "KO stays down".
  - The e2e harness checks that the head drops at a knockdown and comes back up after the count.

Problems:

1. **Design bug: boxers fall when dizzy, not on a knockdown.** `presentation.ts:121` computes `floor` from `dizzy || counted || terminal`. In core, a dizzy boxer is still **standing**:
   - they can dodge (`sim.spec.ts:78`), and the bot dodges 70 % of the time while dizzy
   - the next clean hit is what starts the knockdown
   - so the render shows a body lying on the floor that is still dodging and taking punches
   - if a clinch break clears `dizzy` (`sim.ts:168`), `floor` jumps from 1 to 0 in a single frame, with no rise animation

   Codex documented this as intended ("zero stamina starts the visual fall"). It contradicts the sim, though. My suggestion: show dizzy as a wobble, and start the fall on the `down` phase.
2. **The retarget direction was never checked.** The bake works in the UAL rig's world frame, and runtime applies that as a character-frame delta. If the two rigs face different axes, the snap goes the wrong way (e.g. forward instead of back). The only test is `hit.rotation != neutral.rotation`, so any rotation at all passes it. Someone needs to look at `tmp/visual-expressiveness/head-hit.png`, or add a sign assertion.
3. Only 1 UAL clip was used. The brief said "retargeting UAL clips" (plural), and body hits have no reaction.
4. Minor: several `new Quaternion/Vector3` allocations per boxer per frame, plus a `getObjectByName` lookup every frame.

### Item 2: complete big-head replacement with the live face. **Mostly done**

- The whole `Casual_Head` group is hidden, not scaled. That meets "hiding the original head geometry".
- The new head is a sphere shell at 2.6× the proportional radius plus a front sphere cap textured with a **private copy** of the existing `FaceFeed` crop. It reuses `pose/face-crop.ts` as-is, with no second model.
- It follows the Head bone's position **and** rotation (the old cap only followed position).
- The e2e harness checks that the original head is hidden, the new head is > 0.55 × 0.65 m, it moves > 0.2 m in x on sway and > 0.3 m down on duck, and redraws within one tick are stable.

Gaps:

- The face uses `MeshBasicMaterial` (unlit) on a lit `MeshStandardMaterial` shell. The face reads like a sticker, with a visible dark seam around the oval (see the baseline `boxing-seed42-t8`).
- **Product change hidden in the baselines:** with no camera (keyboard mode), boxers now show a procedural smiley face instead of the original head. That needs your sign-off.
- Never checked with a real camera. The fake-camera run only screenshots the placeholder clip.

### Item 3: accumulating face damage. **Partial**

- **Done:**
  - Damage builds up per boxer in 3 zones (anatomical left cheek, right cheek, chin), picked from the punch aim and hand.
  - Blocked hits don't add damage, simultaneous two-hand hits damage both sides, and damage resets on a new sim.
  - It's painted as radial redness and bruise gradients on the face copy; the source crop is never modified, and the e2e compares pixels to confirm.
  - Unit tests cover the zones, accumulation, blocks, isolation between boxers and reset.
- **Missing:**
  - **There's no real swelling.** The "swelling highlight" is a thin pale arc drawn on the texture, with no geometry or normal change.
  - "At the location hit" is limited to 3 fixed zones: no forehead, eyes or nose.
  - Bruises don't fade or heal during a match. That may be intentional.
  - `paintFace` has no unit test; only e2e pixel diffs cover it.

## b. Quality and correctness

| Check | Result |
| --- | --- |
| `pnpm verify` on the worktree | **Green** (I ran it with `PLAYWRIGHT_PORT=5199`, log in my scratchpad). Codex's own last log (`tmp/visual-expressiveness-worktree/tmp/visual-verify.log`) had 5 red smoke tests. 4 were perf/fps checks and 1 was a replay. They pass now, so they were most likely GPU contention. |
| Skipped or disabled tests | None added. The only skip is `describe.skipIf` in `src/pose/gestures.spec.ts:204` (a missing fixture), which predates Codex. No `.only`, `@ts-ignore` or `eslint-disable` in the new code. |
| Baselines | Regenerated at 20:13. `boxer.ts`, `presentation.ts` and `animation.ts` were edited later (up to 20:23), but they still pass at `maxDiffPixelRatio 0.01`, so they match the final code. The changes are the intended ones (new head, bruise, and the floored body shown from behind). **Legitimate, but nobody reviewed them by eye**, and they include the smiley-face product change above. |
| AGENTS.md | ✅ no new dependency; CC0 source credited in CREDITS; tuning values in `visual.config.ts`; files ≤ 400 lines and functions ≤ 60 (lint green); render→pose import boundary respected. ❌ **no commits** (breaks "commit after each green verify"); ❌ **no `docs/PROGRESS.md` entry**; ❌ edited the `M7.9` note on a milestone that was already done. |
| Out-of-brief edits | `playwright.config.ts`: `workers: 1` for the whole suite (reasonable for fps tests, but slows `verify`; not mentioned anywhere) and a `PLAYWRIGHT_PORT` env var (useful). |
| Fragile test | The live-face e2e counts `FACEDBG` console logs. That's a **debug `console.log` left in `src/pose/face-crop.ts:82`** (from `f4a903c`, not Codex). Remove the log and the test fails. |

**Half-wired code (exists but never runs in the app):**

- `createBoxingView(canvas, faces, poses?)`: `src/games/boxing/index.ts:30` never passes `poses`. The whole live-pose path (`adaptBoxerPose`, `applyLive`, glove positions from the wrists, body offset from live data) only runs in the e2e harness.
- Arm rotations (`shoulderL/R`, `elbowL/R`) are applied, but the arm bones are scaled to 0.001 right afterwards, so they do nothing visible.
- `visual.config.ts` `hitS` is unused (`boxer.ts` hard-codes `0.44`). `Presentation.stage` values `'fall'` and `'down'` are only read by tests.

## c. Scope boundary

**Respected.** No file under `src/pose/`, `src/core/` or `src/input/` was changed (checked with `git status` in the worktree). The render code imports only core types and config (`boxing.config`, `types`), which PLAN §3 allows. The e2e harness imports `core/boxing/sim` to step the sim, which is fine for a test.

The one thing that looks like pose code without being in `src/pose/`: **`src/render/boxing/pose-state.ts`** has the same basename as your `src/pose/pose-state.ts` and holds a structural copy of your types (`TrackedBoxerPose`). It's not a boundary violation, but it's confusing and will drift. See d.

## d. Merge risk against `feat/pose-mirroring` (= `main` @ `6708eb4`)

**Textual:** low.

- A trial merge (Codex patch applied onto `main`, plus the untracked files) had conflicts **only in `docs/ARCHITECTURE.md`** (both branches add a section right after the Boxing section) **and `docs/features.json`** (both edit around M7.9, and **both add `M7.10`** with different meanings).
- In the merged tree:
  - `tsc`, `eslint` and `vitest` (328 tests) pass.
  - Boxing smoke: 8 of 9 pass. The one failure is the live-face test, and it also fails on pure `main` (next bullet).
- **The failure is a regression on `main`, not a merge issue.** `tests/e2e/boxing-visual.smoke.spec.ts` › "live fake-camera face…" fails in `/?game=boxing&input=pose&seed=42&clock=manual`: no face crop is ever produced. The results:
  - Worktree on `f4a903c`: passed 2 of 2 runs.
  - Trial merge: failed 2 of 2.
  - Pure `main` with only that spec copied in: failed 1 of 1.
  - Something in `6708eb4` stops live face crops with the fake camera. The worker now also posts `world`, and body tracking now includes ears and elbows. I didn't find the cause from reading the code and stopped there. Your real Boxing faces may be broken on `main`. **Check this first.**

**Interface compatibility:** Codex clearly read your in-progress PoseState, since the field names match. It built against a **different delivery model and a few different meanings**:

| Your contract (`main`) | Codex's assumption | Impact |
| --- | --- | --- |
| Push: `GameView.render(sims, interpolate, poses[])`, per player, null when stale | Pull: `BoxingPoseFeed.pose(player)` passed once at `createBoxingView` | Rewire `view.ts` `render` to take a 3rd argument `poses` and use `adaptBoxerPose(poses[who])`. Small change (~10 lines). Then delete `BoxingPoseFeed`. |
| `body.forward` = **fraction of camera distance** (not torso lengths) | multiplies it by 0.5 m like the torso-length fields | Wrong scale for forward/back motion; one-line fix. |
| `upperRot`/`foreRot` = swing **from an arm hanging straight down** `(0,-1,0)` | treated as a character-frame **delta applied to the animated idle pose** | Wrong if arms ever become visible (hidden today, so no visible effect). Needs the `setFromUnitVectors` binding recipe from ARCHITECTURE. |
| `head.rot` relative to the camera; `torso.rot`, `hips.rot` = deltas from calibration | applied as absolute character-frame rotations; bases are captured before any change, so head ignores torso | **Matches.** |
| Axes +x left / +y up / +z forward, `[x,y,z,w]` | same | Matches. |
| "Renderer should smooth or interpolate on `t`" | no smoothing | Visible jitter at 20–30 Hz; small addition needed. |
| n/a | when a live pose is present, `boxer.ts` **ignores the sim's dodge offset** and moves the body from raw `body.sway/duck` | **Decision for you:** what you see and what the sim scores can disagree (the player looks dodged, the sim didn't register a dodge). Codex made this choice silently. |
| `src/pose/pose-state.ts` exports `PoseState`, re-exported from `games/types.ts` | `src/render/boxing/pose-state.ts` redeclares `TrackedBoxerPose` | Same filename, duplicate types. Lint only forbids render→pose, so `import type { PoseState } from '../../games/types'` would pass. But `games/types.ts` already imports from `render/`, so that creates a type-level cycle. Simpler: keep a structural type, rename the file (e.g. `live-pose.ts`), and add a comment that it must track `pose/pose-state.ts`. |

Bottom line for d: your PoseState **can be consumed** by this code once the view entry point changes from pull to push and `forward` is fixed. The bigger risk is `boxer.ts`: it is now the shared hotspot for both efforts (live pose, hit reactions, fall and dodge all converge there). Whoever lands second should rebase and re-check the precedence order: fall > live pose > reactions.

## e. Remaining work and recommendation

| Work | What remains | Agent-days |
| --- | --- | --- |
| Housekeeping (do first) | Commit the worktree as WIP on `feat/visual-expressiveness`; rebase onto `main`; resolve the doc conflicts; renumber Codex's item (e.g. `M7.11`); undo the `M7.9` note edit; add a PROGRESS entry; justify or scope `workers: 1`; rename `render/boxing/pose-state.ts`; remove the unused `hitS` | 0.5 |
| Item 1 | Fall on `down` only, with dizzy as a wobble (update `presentation.ts` and its spec); smooth recovery when a clinch break clears dizzy; check the head-snap sign with an assertion and a screenshot; optionally add a UAL body-hit clip; hoist per-frame allocations | 1.5–2 |
| Item 2 | Match lighting between face and shell (lit face material, or bake a shading gradient), remove the seam; your call on the no-camera smiley; real-camera playtest note | 0.5 |
| Item 3 | Real swelling (vertex displacement or scale on the shell at the hit zone, or a normal/bump map); optionally more zones; a unit or pixel test for `paintFace` | 1 |
| PoseState integration (overlaps your branch) | Push-model rewire, `forward` units, smoothing on `t`, decide live sway vs. sim dodge, arm binding if arms become visible | 1 |
| **Total** | | **≈ 4.5–5** |

**Recommendation: continue the branch (salvage).** Why:

- Most of the work is **not** the "half-finished render code with no tests" case. There are 5 unit tests and a real e2e harness that loads the shipping GLB, steps the real sim and checks transforms and texture pixels. That harness is the most valuable piece and would be expensive to rebuild.
- Verify is green, the code merges without conflicts, and it respects the boundaries.
- The defects are local and well understood: one semantic bug in `presentation.ts`, one unverified retarget sign, and an adapter shape. A rewrite would cost ~6–8 agent-days to get back to this point.

Discard specific pieces rather than the branch. `render/boxing/pose-state.ts` plus `applyLive` should be rewritten against your contract, not patched.

**Before anything else:**

1. **Commit the worktree.** It's the only copy.
2. **Look into the live face-crop regression on `main`.** Repro: from a tree containing `tests/e2e/boxing-visual.smoke.spec.ts`, run `PLAYWRIGHT_PORT=5197 pnpm exec playwright test --project=smoke boxing-visual -g "live fake-camera"`, or open `/?game=boxing&input=pose&seed=42` with the fake camera and watch for `FACEDBG`.

**Can't be automated (playtest for Jorge):** head-snap direction and feel, whether the fall/get-up reads well, whether the face-to-shell seam and lighting look acceptable, and bruise visibility at play distance. After the fixes, use `/?game=boxing&input=pose&seed=42&debug=1` with a real camera.
