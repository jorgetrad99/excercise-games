// TEMPORARY(synthetic-fixtures): boxing arm motion from synthetic poses (pose/testdata/synthetic.ts)
// until a recorded boxing fixture exists. Same shape as gestures.spec: exact event sequences.
import { describe, expect, it } from 'vitest';
import { createGestureEngine, type GestureEvent } from './gestures';
import { CALIBRATE, script, type Key } from './testdata/synthetic';

const READY = { fists: 'ready' } as const;
const video = () => ({ width: 1280, height: 720 });

/** Events after calibrating in the boxing ready stance (CALIBRATED dropped). */
function after(keys: Key[]): GestureEvent[] {
  const engine = createGestureEngine({ video });
  const frames = script([CALIBRATE, { ms: 300, to: {} }, ...keys], { base: READY });
  const events = frames.flatMap((f) => engine.push(f).events);
  expect(events[0]?.type).toBe('CALIBRATED');
  return events.slice(1);
}
const types = (keys: Key[]) => after(keys).map((e) => e.type);

const hold = (ms: number, to: Key['to'] = {}): Key => ({ ms, to });
/** A snappy punch: out in 120 ms, hold, back in 250 ms, settle. */
const punch = (to: Key['to']): Key[] => [
  { ms: 120, to },
  hold(80, to),
  { ms: 250, to: {} },
  hold(400),
];

describe('boxing fists (guard posture + speed signal) — TEMPORARY synthetic event-sequence tests', () => {
  it('idle in the ready stance with jitter: nothing', () => {
    expect(types([hold(5000)])).toEqual([]);
  });

  // PLAN-BOXING §2.5: punches are glove collisions in the sim; the pose layer emits no punch events.
  it('no punch events from any arm motion: straights, hooks, uppercuts, flurries', () => {
    const flurry: Key[] = [
      ...punch({ punchR: 1 }),
      ...punch({ punchL: 1 }),
      ...punch({ hookR: 1 }),
      ...punch({ upperL: 1 }),
      { ms: 60, to: { punchR: 1 } },
      { ms: 60, to: {} },
    ];
    expect(types(flurry).filter((e) => e !== 'GUARD_START' && e !== 'GUARD_END')).toEqual([]);
  });

  it('wrist speed is still reported as a signal (PoseState arms[].speed)', () => {
    const engine = createGestureEngine({ video });
    const frames = script([CALIBRATE, { ms: 300, to: {} }, { ms: 120, to: { punchR: 1 } }], {
      base: READY,
    });
    const speeds = frames.map((f) => engine.push(f).signals.fistR);
    expect(Math.max(...speeds)).toBeGreaterThan(1);
  });

  it('losing tracking while guarding ends the guard (never leaves the sim stuck guarding)', () => {
    expect(
      types([
        { ms: 300, to: { fists: 'guard' } },
        hold(500, { fists: 'guard' }),
        hold(1000, { fists: 'guard', visible: false }),
      ]),
    ).toEqual(['GUARD_START', 'GUARD_END', 'TRACKING_LOST']);
  });

  it('guard: both fists to the chin → GUARD_START once; lowering them → GUARD_END', () => {
    expect(
      types([
        { ms: 300, to: { fists: 'guard' } },
        hold(1500, { fists: 'guard' }),
        { ms: 300, to: { fists: 'ready' } },
        hold(500, { fists: 'ready' }),
      ]),
    ).toEqual(['GUARD_START', 'GUARD_END']);
  });
});
