// Boxing fists on Jorge's B1 capture (src/pose/testdata/real-b1-capture.json): exact guard event
// sequences per take, calibrated on the "still" take. Same shape as gestures.spec.
import { describe, expect, it } from 'vitest';
import { gestureConfig } from './gestures.config';
import { b1Take, extensions, replayB1, type B1Step } from './testdata/real-b1';

const events = (step: B1Step, config = gestureConfig) =>
  replayB1(b1Take(step), config).flatMap((r) =>
    r.events.map((e) => ({ t: Math.round(e.t), type: e.type })),
  );
const types = (step: B1Step) => events(step).map((e) => e.type);

describe('boxing fists (guard posture + speed signal), real recording', () => {
  it('standing still with arms down: nothing, not even a guard', () => {
    expect(types('still')).toEqual([]);
    expect(types('left-hand-overhead')).toEqual([]);
  });

  it('fists up: one GUARD_START once the fists arrive, held to the end of the take', () => {
    expect(events('guard')).toEqual([{ t: 2602, type: 'GUARD_START' }]);
  });

  // PLAN-BOXING §2.5: punches are glove collisions in the sim; the pose layer emits no punch events.
  it('no punch events from real punches: only guard (and lean) events', () => {
    for (const step of ['square-right-x3', 'natural-right-x3', 'left-x1'] as const)
      expect(
        types(step).filter((t) => !/^(GUARD|LANE)_/.test(t)),
        step,
      ).toEqual([]);
  });

  // B1 capture: a fist thrown at the face is as near the nose in 2D as a guard (0.25–0.37 vs 0.24–0.26
  // torso) but above it. Before guard.maxAboveNose, every square punch fired GUARD_START.
  it('a punch ends the guard instead of starting one', () => {
    for (const [step, wrist] of [
      ['natural-right-x3', 16],
      ['left-x1', 15],
    ] as const) {
      const ends = events(step).filter((e) => e.type === 'GUARD_END');
      const punches = extensions(b1Take(step).frames, wrist);
      expect(punches.length, step).toBe(6);
      // Each punch's start ends the guard (within 70 ms: 2 frames). Natural take: one more END, the hands
      // dropping below guard height at 8.3 s between punches 5 and 6.
      for (const [start] of punches)
        expect(
          Math.min(...ends.map((e) => Math.abs(e.t - start))),
          `${step} ${start}`,
        ).toBeLessThanOrEqual(70);
      expect(ends.length, step).toBe(step === 'left-x1' ? 6 : 7);
    }
    // Square take: the hands rest below guard height between punches, so it's never guard mid-take.
    expect(types('square-right-x3').filter((t) => t.startsWith('GUARD'))).toEqual([
      'GUARD_START',
      'GUARD_END',
      'GUARD_START',
      'GUARD_END',
    ]);
    const old = {
      ...gestureConfig,
      fists: {
        ...gestureConfig.fists,
        guard: { ...gestureConfig.fists.guard, maxAboveNose: Infinity },
      },
    };
    expect(events('square-right-x3', old).filter((e) => e.type === 'GUARD_START')).toHaveLength(6);
  });

  it('wrist speed is reported per hand: the punching hand is the fast one', () => {
    const peak = (step: B1Step) => {
      const take = b1Take(step);
      // Inside the prompted window: the first frames after the still take measure the jump between takes.
      const r = replayB1(take).filter((x) => x.t >= take.windowMs[0] && x.t <= take.windowMs[1]);
      return [
        Math.max(...r.map((x) => x.signals.fistL)),
        Math.max(...r.map((x) => x.signals.fistR)),
      ];
    };
    const [sqL, sqR] = peak('square-right-x3');
    expect(sqR).toBeGreaterThan(2 * sqL!);
    const [lL, lR] = peak('left-x1');
    expect(lL).toBeGreaterThan(1.5 * lR!);
  });

  it('losing tracking while guarding ends the guard (never leaves the sim stuck guarding)', () => {
    const guard = b1Take('guard');
    const last = guard.frames.at(-1)!.t;
    const lost = Array.from({ length: 30 }, (_, i) => ({ t: last + 33 * (i + 1), poses: [] }));
    const r = replayB1({ ...guard, frames: [...guard.frames, ...lost] });
    expect(r.flatMap((x) => x.events.map((e) => e.type))).toEqual([
      'GUARD_START',
      'GUARD_END',
      'TRACKING_LOST',
    ]);
  });
});
