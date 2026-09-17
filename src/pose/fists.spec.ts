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

describe('boxing fists — TEMPORARY synthetic event-sequence tests', () => {
  it('idle in the ready stance with jitter: nothing', () => {
    expect(types([hold(5000)])).toEqual([]);
  });

  it('one straight = one PUNCH from that fist, aimed roughly straight', () => {
    const events = after(punch({ punchR: 1 }));
    expect(events.map((e) => e.type)).toEqual(['PUNCH_RIGHT']);
    expect(Math.abs(events[0]!.aim!.x)).toBeLessThan(0.5);
    expect(Math.abs(events[0]!.aim!.y)).toBeLessThan(0.5);
    expect(types(punch({ punchL: 1 }))).toEqual(['PUNCH_LEFT']);
  });

  it('recovery: a second punch before the fist came back to the face does not fire', () => {
    // Out, half back (still beyond `rearm`), out again, then home.
    const flurry: Key[] = [
      { ms: 120, to: { punchR: 1 } },
      { ms: 150, to: { punchR: 0.5 } },
      { ms: 120, to: { punchR: 1 } },
      { ms: 250, to: {} },
      hold(400),
    ];
    expect(types(flurry)).toEqual(['PUNCH_RIGHT']);
    // The same two punches with a full return in between: two events.
    expect(types([...punch({ punchR: 1 }), ...punch({ punchR: 1 })])).toEqual([
      'PUNCH_RIGHT',
      'PUNCH_RIGHT',
    ]);
    // Alternating fists are independent.
    expect(
      types([
        { ms: 120, to: { punchR: 1 } },
        { ms: 120, to: { punchL: 1 } },
        { ms: 300, to: {} },
        hold(400),
      ]),
    ).toEqual(['PUNCH_RIGHT', 'PUNCH_LEFT']);
  });

  it('slow reaches and dropping the hands do not punch', () => {
    expect(
      types([
        { ms: 1200, to: { punchR: 1 } },
        { ms: 1200, to: {} },
      ]),
    ).toEqual([]);
  });

  it('direction falls out of the vector: a right hook sweeps left, a left uppercut goes up', () => {
    const hook = after(punch({ hookR: 1 }));
    expect(hook.map((e) => e.type)).toEqual(['PUNCH_RIGHT']);
    expect(hook[0]!.aim!.x).toBeLessThan(-0.5); // toward the puncher's left
    const upper = after(punch({ upperL: 1 }));
    expect(upper.map((e) => e.type)).toEqual(['PUNCH_LEFT']);
    expect(upper[0]!.aim!.y).toBeGreaterThan(0.5);
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
