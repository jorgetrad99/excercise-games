# fixtures/

Human-owned. Agents don't write here (guard hook).

## Current state (2026-09-17): no real pose recordings exist

`fixtures/pose/` has no recordings. None of the drills listed in older docs were recorded:
- M7.10's `straight-*`, `hook-*`, `uppercut-*` and `sway`
- PLAN-BOXING §11's `boxing-still`, `-march`, `-hop`, `-arm-pump` and `-side-step`

Every pose test runs on synthetic poses (`src/pose/testdata/`). Values marked "provisional until drills" stay untuned. BX-CAL-6 (body scan reach) is blocked.

When a recording lands, update this file with its name, what it contains, its counts, and whether it's clean. The vitest warning `NO REAL POSE RECORDINGS` goes away by itself once a `.json` exists in `fixtures/pose/`.

Format: `src/pose/recorder.ts` (`?record=1`, raw unmirrored landmarks, `t` from 0).
