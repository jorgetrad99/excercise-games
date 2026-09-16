// TEMPORARY(synthetic-fixtures): two-person synthetic frames until Jorge records two-players.json;
// then replay that fixture here and keep the per-player exact-sequence assertions.
import { describe, expect, it, vi } from 'vitest';
import { SKATE_GESTURES } from '../games/skate-run/gestures';
import { gestureConfig } from '../pose/gestures.config';
import { CALIBRATE, JUMP, fixture, scriptTwo, type Key } from '../pose/testdata/synthetic';
import { createReplaySource } from './replay';

const LEAN_LEFT: Key[] = [
  { ms: 300, to: { lean: -0.06 } },
  { ms: 600, to: {} },
];
const LEAN_RIGHT: Key[] = [
  { ms: 300, to: { lean: 0.06 } },
  { ms: 600, to: {} },
];
const SLIDE: Key[] = [
  { ms: 200, to: { crouch: 0.11 } },
  { ms: 600, to: { crouch: 0.11 } },
  { ms: 200, to: {} },
  { ms: 400, to: {} },
];
const STAND = (ms: number): Key => ({ ms, to: {} });

async function perPlayer(left: Key[], right: Key[]): Promise<[string[], string[]]> {
  const replay = createReplaySource(fixture(scriptTwo(left, right)), {
    mode: 'instant',
    toInput: SKATE_GESTURES,
    players: 2,
  });
  const got: [string[], string[]] = [[], []];
  replay.onEvent((e) => got[e.player as 0 | 1].push(e.type));
  replay.start();
  await replay.done;
  return got;
}

describe('two pose players on one camera', () => {
  it('each body drives only its own player, with exact event sequences', async () => {
    const [p1, p2] = await perPlayer(
      [CALIBRATE, ...LEAN_LEFT, ...JUMP, STAND(1500)],
      [CALIBRATE, STAND(400), ...LEAN_RIGHT, ...SLIDE],
    );
    expect(p1).toEqual(['LANE_LEFT', 'JUMP']);
    expect(p2).toEqual(['LANE_RIGHT', 'SLIDE_START', 'SLIDE_END']);
  });

  it('one body gone < 2 s pauses only that player; > 2 s pauses both; both resume on return', async () => {
    // Right scripts are padded to the left's length: a script that ends early is a body that left.
    const short: Key[] = [{ ms: 1500, to: { visible: false } }, STAND(4500)];
    const long: Key[] = [{ ms: 2500, to: { visible: false } }, STAND(3500)];
    const idle = STAND(2000 + 2500 + 500 + 1000);

    // Short dropout: P2's own tracking-loss rule only.
    let [p1, p2] = await perPlayer([CALIBRATE, idle], [CALIBRATE, ...short]);
    expect(p1).toEqual([]);
    expect(p2).toEqual(['PAUSE', 'RESUME']);

    // Long dropout: P2 pauses at 0.7 s (own rule), then both pause at > 2 s, then both resume.
    // P2's second PAUSE is a no-op in the sim; its own RESUME is held back while both are paused.
    [p1, p2] = await perPlayer([CALIBRATE, idle], [CALIBRATE, ...long]);
    expect(p1).toEqual(['PAUSE', 'RESUME']);
    expect(p2).toEqual(['PAUSE', 'PAUSE', 'RESUME']);
  });

  it('while both are paused, a player returning from their own dropout does not resume early', async () => {
    // P2 gone 0–3 s after calibration (both pause at > 2 s); P1 gone 2.5–3.5 s. P2 is back at 3 s,
    // but P1 is still out, so nobody resumes until P1 is back at 3.5 s.
    const [p1, p2] = await perPlayer(
      [CALIBRATE, STAND(2500), { ms: 1000, to: { visible: false } }, STAND(2000)],
      [CALIBRATE, { ms: 3000, to: { visible: false } }, STAND(2500)],
    );
    expect(p1).toEqual(['PAUSE', 'PAUSE', 'RESUME']);
    expect(p2).toEqual(['PAUSE', 'PAUSE', 'RESUME']);
  });

  it('2 players force lean lanes: zones are thirds of the whole frame', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const zones = { ...gestureConfig, laneMode: 'zones' as const };
    createReplaySource(fixture([]), {
      mode: 'instant',
      toInput: SKATE_GESTURES,
      config: zones,
      players: 2,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('using "lean"'));
    warn.mockRestore();
  });

  it('players: 1 skips the zone split and routes everything to player 0 (unchanged path)', async () => {
    const replay = createReplaySource(fixture(scriptTwo([CALIBRATE, ...LEAN_LEFT], [])), {
      mode: 'instant',
      toInput: SKATE_GESTURES,
    });
    const got: { type: string; player: number }[] = [];
    replay.onEvent((e) => got.push({ type: e.type, player: e.player }));
    replay.start();
    await replay.done;
    expect(got).toEqual([{ type: 'LANE_LEFT', player: 0 }]);
  });
});
