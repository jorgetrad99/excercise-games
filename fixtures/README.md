# fixtures/

Human-owned. Agents don't write here (guard hook). The two files below were placed by Jorge's
explicit instruction during the 2026-09-17 consolidation; anything else needs the same.

## What exists (2026-09-17)

| File | What it is | Clean? | Used by |
| --- | --- | --- | --- |
| `pose/combined-raw.json` | 26 s mixed Skate Run session (Jorge, 2026-09-16). One person, 569 frames, knees tracked in 420 of them but partly out of frame (knee y > 1). Not per-gesture, no counts said aloud. | Unverified: nobody has labelled what happens when | `src/pose/gestures.spec.ts` sanity block (finite signals, CALIBRATED, plausible event count) |
| `pose/boxing/b1-capture-2026-09-17.json` | The raw B1 capture, 6 takes (`?record=1&capture=b1`): left arm up, still, guard, 6 right no-twist, 6 right twist, 6 left. No body scan, no T-pose, one person, default arm lengths. | Yes, analysed | Nothing directly. The compacted excerpt `src/pose/testdata/real-b1-capture.json` (loader `real-b1.ts`) is what the tests import |

## What does NOT exist

- **Per-gesture Skate drills** (`jump.json`, `crouch.json`, `lean-left-right.json`, `idle.json`,
  `two-players.json`) — M1.5 and M2.D1 wait on these.
- **The M8 stepping set** (`pose/skate/skate-still`, `-march`, `-jog`, `-jog-jumps`, `-jog-lanes`,
  `-jog-slides`) — step propulsion cannot be tuned without them, and must not be tuned on synthetic
  poses: step-vs-jump is the exact confusion they exist to settle.
- **The boxing drill set** (PLAN-BOXING §11: `boxing-still`, `-march`, `-hop`, `-arm-pump`,
  `-side-step`) — BX-CAL-6 (body scan applied to reach) stays blocked; recovery gestures stay
  synthetic.
- **A video clip** (`.mjpeg`/`.y4m`) for the fake camera. The e2e clips under
  `tests/e2e/assets/placeholder-*.mjpeg` are placeholders, not recordings of a real body.

Everything not listed as existing above is synthetic (`src/pose/testdata/synthetic.ts`) and must say
so wherever it is reported.

## Adding a recording

Record with `?record=1` (raw unmirrored landmarks, `t` from 0; format: `src/pose/recorder.ts`) or the
capture wizard `?record=1&capture=<script>` (`src/pose/capture.ts`). Then add a row above with the
file's name, what it contains, its counts, and whether it is clean.

The vitest warning `NO REAL POSE RECORDINGS` fires while `fixtures/pose/` holds no `.json`; it is
quiet now.
