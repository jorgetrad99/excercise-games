import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InputEvent } from '../core/input';
import { CALIBRATE, JUMP, fixture, script } from '../pose/testdata/synthetic';
import { createKeyboardSource } from './keyboard';
import { createReplaySource } from './replay';

const key = (type: string, k: string, repeat = false) =>
  Object.assign(new Event(type, { cancelable: true }), { key: k, repeat });

describe('keyboard source', () => {
  it('stop() while ArrowDown is held ends the slide', () => {
    const target = new EventTarget();
    const kb = createKeyboardSource(target, () => 0);
    const got: string[] = [];
    kb.onEvent((e) => got.push(e.type));
    kb.start();
    target.dispatchEvent(key('keydown', 'ArrowDown'));
    kb.stop();
    expect(got).toEqual(['SLIDE_START', 'SLIDE_END']);
  });

  it('maps keys 1:1, ignores auto-repeat and unknown keys, and stops cleanly', () => {
    const target = new EventTarget();
    let t = 0;
    const kb = createKeyboardSource(target, () => ++t);
    const got: InputEvent[] = [];
    kb.onEvent((e) => got.push(e));
    kb.start();
    for (const [type, k, rep] of [
      ['keydown', 'ArrowLeft'],
      ['keydown', 'ArrowLeft', true],
      ['keydown', 'ArrowRight'],
      ['keydown', ' '],
      ['keydown', 'ArrowDown'],
      ['keyup', 'ArrowDown'],
      ['keydown', 'ArrowUp'],
      ['keydown', 'c'],
      ['keydown', 'Enter'],
      ['keydown', 'x'],
    ] as const) {
      target.dispatchEvent(key(type, k, rep === true));
    }
    kb.stop();
    target.dispatchEvent(key('keydown', ' '));
    expect(got).toEqual([
      { t: 1, type: 'LANE_LEFT' },
      { t: 2, type: 'LANE_RIGHT' },
      { t: 3, type: 'JUMP' },
      { t: 4, type: 'SLIDE_START' },
      { t: 5, type: 'SLIDE_END' },
      { t: 6, type: 'GRAB' },
      { t: 7, type: 'RECALIBRATE' },
      { t: 8, type: 'REVIVE' },
    ]);
  });
});

// TEMPORARY(synthetic-fixtures): swap for a recorded fixtures/pose/*.json once Jorge records them.
describe('replay source — TEMPORARY synthetic fixture', () => {
  const fx = fixture(
    script([CALIBRATE, { ms: 300, to: { lean: -0.06 } }, { ms: 600, to: {} }, ...JUMP]),
  );

  afterEach(() => vi.useRealTimers());

  it('instant: plays the whole fixture on start() through the gesture engine', async () => {
    const replay = createReplaySource(fx, { mode: 'instant' });
    const got: InputEvent[] = [];
    replay.onEvent((e) => got.push(e));
    replay.start();
    await replay.done;
    expect(got.map((e) => e.type)).toEqual(['LANE_LEFT', 'JUMP']);
    expect(got[0]!.t).toBeGreaterThan(2500); // fixture time
  });

  it('realtime: emits the same events on the live clock, in order', async () => {
    vi.useFakeTimers();
    const replay = createReplaySource(fx, { now: () => Date.now() });
    const got: InputEvent[] = [];
    replay.onEvent((e) => got.push(e));
    const start = Date.now();
    replay.start();
    await vi.advanceTimersByTimeAsync(fx.frames.at(-1)!.t + 50);
    await replay.done;
    expect(got.map((e) => e.type)).toEqual(['LANE_LEFT', 'JUMP']);
    expect(got[0]!.t - start).toBeGreaterThan(2500);
  });
});
