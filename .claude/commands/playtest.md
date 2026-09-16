---
description: Headed Playwright playtest on a seed with keyboard/replay input; saves artifacts to tmp/playtest/
argument-hint: <seed> <input>
---
Playtest with seed `$1` and input `$2` (default `keyboard`).

1. Ensure `pnpm dev` is running (or let Playwright's webServer start it).
2. Write a throwaway script in `tmp/playtest/` that launches headed Chromium on `http://localhost:5173/?game=skate-run&debug=1&seed=$1&input=$2`, waits for `window.__game`, then every 5 s for 30 s saves a screenshot `tmp/playtest/<t>s.png` and appends `window.__game.getState()` + `getFps()` to `tmp/playtest/state.jsonl`. Capture console warnings/errors to `tmp/playtest/console.log`.
3. Report: final state, min/avg fps, console errors, artifact paths. Features not built yet (e.g. replay input before M2) → say so and stop.
