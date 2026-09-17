// PLAN-BOXING §11.1 capture wizard: BX-CAP-1…4 on a synthetic live session (no DOM, no camera).
import { describe, expect, it } from 'vitest';
import {
  captureBundle,
  LEAD_MS,
  replaceTake,
  sliceTake,
  takeEnd,
  TRAIL_MS,
  type CapturedEvent,
  type CaptureStep,
  type CaptureTake,
} from './capture';
import { CAPTURE_SCRIPTS } from './capture-scripts';
import type { PoseFrame } from './types';

const META = { model: 'full', video: { width: 1280, height: 720 } } as const;
const AT = new Date('2026-09-17T00:00:00Z');
const STEPS = CAPTURE_SCRIPTS['b1']!;
const COUNTDOWN_MS = 3000;
const REVIEW_MS = 2000; // Jorge deciding Keep/Redo

/** A live session on the performance.now clock: countdown → take → review, per step. */
function session(steps: readonly CaptureStep[], t0 = 5000) {
  const starts: number[] = [];
  let t = t0;
  for (const step of steps) {
    starts.push(t + COUNTDOWN_MS);
    t = takeEnd(step, t + COUNTDOWN_MS) + REVIEW_MS;
  }
  const frames: PoseFrame[] = [];
  for (let ft = t0; ft < t; ft += 33.3)
    frames.push({ t: ft, poses: [[{ x: 0.5, y: 0.5, z: 0, visibility: 1 }]] });
  const events: (CapturedEvent & { player?: number })[] = [];
  steps.forEach((step, i) => {
    const s = starts[i]!;
    events.push(
      { t: s - 1500, type: 'DODGE_LEFT' }, // countdown
      { t: s + LEAD_MS + 100, type: 'PUNCH_RIGHT', player: 1 }, // inside the window
      { t: s + LEAD_MS + 50, type: 'BODY' },
      { t: takeEnd(step, s) + 700, type: 'DODGE_LEFT' }, // Keep/Redo pause
    );
  });
  const live = { frames, events };
  const takes = steps.map((step, i) => sliceTake(step, starts[i]!, live, META, AT));
  return { starts, live, takes };
}

describe('capture wizard (PLAN-BOXING §11.1)', () => {
  it('BX-CAP-1: one take per step, frames and events inside the margins, rebased, windowMs = [lead, lead + duration]', () => {
    const { starts, live, takes } = session(STEPS);
    expect(takes.map((k) => k.step)).toEqual(STEPS.map((s) => s.id));
    takes.forEach((take, i) => {
      const step = STEPS[i]!;
      const span = LEAD_MS + step.durationS * 1000 + TRAIL_MS;
      expect(take.windowMs).toEqual([LEAD_MS, LEAD_MS + step.durationS * 1000]);
      expect(take.prompt).toBe(step.prompt);
      // Every live frame inside [start − lead, end + trail] is in the take, rebased to its t = 0.
      const expected = live.frames
        .filter((f) => f.t >= starts[i]! && f.t <= starts[i]! + span)
        .map((f) => Math.round((f.t - starts[i]!) * 10) / 10);
      expect(take.frames.map((f) => f.t)).toEqual(expected);
      expect(take.frames[0]!.t).toBeLessThan(40); // the lead-in is recorded
      expect(take.frames.at(-1)!.t).toBeGreaterThan(span - 40); // and the trailing margin
      expect(take.events).toEqual([{ t: LEAD_MS + 100, type: 'PUNCH_RIGHT', player: 1 }]);
    });
  });

  it('BX-CAP-2: Redo on step k replaces only take k; every other take is byte-identical', () => {
    const { live, takes } = session(STEPS);
    const before = takes.map((k) => JSON.stringify(k));
    const k = 4;
    const retake = sliceTake(STEPS[k]!, live.frames.at(-1)!.t - 12_000, live, META, AT);
    const after = replaceTake(takes, k, retake);
    expect(after).toHaveLength(takes.length);
    expect(after[k]).toBe(retake);
    after.forEach((take, i) => i !== k && expect(JSON.stringify(take)).toBe(before[i]));
    expect(takes.map((t) => JSON.stringify(t))).toEqual(before); // the input list is not mutated
  });

  it('BX-CAP-3: an event between two takes (countdown or Keep/Redo prompt) belongs to no take', () => {
    const { live, takes } = session(STEPS);
    const between = live.events.filter((e) => e.type === 'DODGE_LEFT');
    expect(between).toHaveLength(STEPS.length * 2);
    expect(takes.flatMap((k) => k.events).filter((e) => e.type === 'DODGE_LEFT')).toEqual([]);
  });

  it('BX-CAP-4: each take stripped of the capture fields is a valid v1 PoseFixture', () => {
    const { takes } = session(STEPS);
    const bundle = captureBundle('b1', takes, AT);
    expect(bundle).toMatchObject({ kind: 'capture', script: 'b1', recordedAt: AT.toISOString() });
    for (const take of JSON.parse(JSON.stringify(bundle)).takes as CaptureTake[]) {
      const { step, prompt, windowMs, events, ...fixture } = take;
      expect([step, prompt, windowMs, events].every((f) => f !== undefined)).toBe(true);
      expect(Object.keys(fixture).sort()).toEqual([
        'frames',
        'model',
        'recordedAt',
        'version',
        'video',
      ]);
      expect(fixture).toMatchObject({ version: 1, ...META, recordedAt: AT.toISOString() });
      expect(fixture.frames.length).toBeGreaterThan(0);
      expect(fixture.frames.every((f, i, a) => f.t >= 0 && (i === 0 || f.t > a[i - 1]!.t))).toBe(
        true,
      );
      expect(
        fixture.frames.every((f) =>
          Object.keys(f).every((key) => ['t', 'poses', 'world'].includes(key)),
        ),
      ).toBe(true);
    }
  });
});
