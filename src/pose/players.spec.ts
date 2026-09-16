import { describe, expect, it } from 'vitest';
import { createPauseBoth, createPlayerSplitter, screenX } from './players';
import { syntheticPose } from './testdata/synthetic';
import type { Landmark, PoseFrame } from './types';

// TEMPORARY(synthetic-fixtures): synthetic bodies until Jorge records two-players.json.
/** A body whose torso center is at screen (mirrored) x. (synthetic scale also scales the walk offset) */
const body = (x: number): Landmark[] => syntheticPose({ walk: (x - 0.5) / 0.7, scale: 0.7 }, 1, 0)!;
const frame = (t: number, ...xs: number[]): PoseFrame => ({ t, poses: xs.map(body) });
const sides = (f: [PoseFrame, PoseFrame]) =>
  f.map((p) => (p.poses[0] ? Number(screenX(p.poses[0], 0.5)!.toFixed(2)) : null));

describe('screenX', () => {
  it('is the mirrored torso center', () => {
    expect(screenX(body(0.25), 0.5)).toBeCloseTo(0.25, 5);
    expect(screenX(body(0.8), 0.5)).toBeCloseTo(0.8, 5);
  });

  it('is null when any torso landmark is not visible (half out of frame = no body)', () => {
    const b = body(0.3);
    b[24] = { ...b[24]!, visibility: 0.2 };
    expect(screenX(b, 0.5)).toBeNull();
  });
});

describe('player splitter', () => {
  const opts = { visibilityMin: 0.5, hysteresis: 0.08, forgetMs: 700 };

  it('two bodies: screen-left is P1 whatever the pose array order', () => {
    const split = createPlayerSplitter(opts);
    expect(sides(split(frame(0, 0.75, 0.25)))).toEqual([0.25, 0.75]);
    expect(sides(split(frame(33, 0.25, 0.75)))).toEqual([0.25, 0.75]);
  });

  it('no bodies: both players get empty frames that keep t and timing', () => {
    const split = createPlayerSplitter(opts);
    const timing = { callbackT: 5, bitmapT: 6, resultT: 7, inferMs: 1 };
    const [a, b] = split({ t: 5, poses: [], timing });
    expect([a.poses, b.poses]).toEqual([[], []]);
    expect(b).toMatchObject({ t: 5, timing });
  });

  it('a lone body with no history goes by half', () => {
    expect(sides(createPlayerSplitter(opts)(frame(0, 0.4)))).toEqual([0.4, null]);
    expect(sides(createPlayerSplitter(opts)(frame(0, 0.6)))).toEqual([null, 0.6]);
  });

  it('hysteresis: P1 drifting just past center stays P1; only a clear crossing reassigns', () => {
    const split = createPlayerSplitter(opts);
    const walk = [0.3, 0.45, 0.52, 0.57, 0.52, 0.6];
    const got = walk.map((x, i) => sides(split(frame(i * 33, x))));
    expect(got).toEqual([
      [0.3, null],
      [0.45, null],
      [0.52, null],
      [0.57, null],
      [0.52, null],
      [null, 0.6], // > 0.5 + 0.08
    ]);
    // …and P2 coming back needs to pass 0.5 - 0.08
    expect(sides(split(frame(300, 0.45)))).toEqual([null, 0.45]);
    expect(sides(split(frame(333, 0.41)))).toEqual([0.41, null]);
  });

  it('a missed detection does not reset hysteresis; a long absence does', () => {
    const split = createPlayerSplitter(opts);
    expect(sides(split(frame(0, 0.3)))).toEqual([0.3, null]);
    expect(sides(split(frame(33, 0.53)))).toEqual([0.53, null]);
    expect(sides(split(frame(66)))).toEqual([null, null]); // detector miss
    expect(sides(split(frame(100, 0.53)))).toEqual([0.53, null]); // still P1
    expect(sides(split(frame(1000, 0.53)))).toEqual([null, 0.53]); // P1 forgotten: by half again
  });

  it('P2 drops out for a frame (detector miss) near the center: the survivor keeps its player', () => {
    const split = createPlayerSplitter(opts);
    expect(sides(split(frame(0, 0.44, 0.56)))).toEqual([0.44, 0.56]);
    expect(sides(split(frame(33, 0.55)))).toEqual([null, 0.55]); // nearest last-seen = P2
    expect(sides(split(frame(66, 0.46, 0.55)))).toEqual([0.46, 0.55]);
  });
});

describe('pause both', () => {
  it('pauses once after > holdMs with fewer than two players, resumes once both are back', () => {
    const step = createPauseBoth(2000);
    const log: [number, string][] = [];
    const feed = (t: number, n: number): void => {
      const r = step(t, n);
      if (r) log.push([t, r]);
    };
    for (let t = 0; t <= 1000; t += 100) feed(t, 2);
    for (let t = 1100; t <= 3000; t += 100) feed(t, 1); // 1900 ms missing: nothing yet
    feed(3100, 1); // 2000 ms: still not "> 2 s"
    feed(3200, 1); // 2100 ms → PAUSE
    feed(3300, 0);
    feed(3400, 1);
    feed(3500, 2); // → RESUME
    feed(3600, 2);
    expect(log).toEqual([
      [3200, 'PAUSE'],
      [3500, 'RESUME'],
    ]);
  });

  it('a brief dropout (< holdMs) never pauses and never resumes', () => {
    const step = createPauseBoth(2000);
    const out = [
      step(0, 2),
      step(100, 1),
      step(1900, 1),
      step(2000, 2),
      step(4500, 1),
      step(4600, 2),
    ];
    expect(out.filter(Boolean)).toEqual([]);
  });
});
