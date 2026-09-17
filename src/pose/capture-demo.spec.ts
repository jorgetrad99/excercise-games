// The demos teach the B1 moves: the right hand must be the right hand, and "square" vs "natural" must differ.
import { describe, expect, it } from 'vitest';
import { DEMOS, joints, ORBIT, postureAt, project, VIEWS, type V } from './capture-demo';
import { CAPTURE_SCRIPTS } from './capture-scripts';

/** Joints every 20 ms over one loop of step `id`'s demo. */
function sample(id: string): ReturnType<typeof joints>[] {
  const keys = DEMOS[id]!;
  const loop = keys[keys.length - 1]![0];
  return Array.from({ length: loop / 20 }, (_, i) => joints(postureAt(keys, i * 20)));
}
/** Shoulder line's turn from square, degrees (+ = right shoulder forward). */
const turn = (l: V, r: V): number => (Math.atan2(r[2] - l[2], r[0] - l[0]) * 180) / Math.PI;
const max = (xs: number[]): number => Math.max(...xs);

describe('capture demos', () => {
  it('every b1 step has a demo and a plain-language description', () => {
    for (const s of CAPTURE_SCRIPTS['b1']!) {
      expect(DEMOS[s.id], s.id).toBeDefined();
      expect(s.howTo, s.id).toBeTruthy();
    }
  });

  it('loops without a jump', () => {
    for (const [id, keys] of Object.entries(DEMOS)) {
      const loop = keys[keys.length - 1]![0];
      const [end, start] = [loop - 0.001, 0].map((t) =>
        Object.values(joints(postureAt(keys, t))).flat(),
      );
      end!.forEach((c, i) => expect(c, id).toBeCloseTo(start![i]!, 3));
    }
  });

  it('left hand overhead raises the LEFT fist (x < 0) above the head; the right stays down', () => {
    const top = sample('left-hand-overhead').reduce((a, b) => (b.lFist[1] > a.lFist[1] ? b : a));
    expect(top.lFist[1]).toBeGreaterThan(top.head[1] + 0.3);
    expect(top.lFist[0]).toBeLessThan(0);
    expect(top.rFist[1]).toBeLessThan(top.rSh[1]);
  });

  it('square right: no turn; natural right: turns ≥ 35°; both extend the RIGHT fist, left stays at the chin', () => {
    const square = sample('square-right-x3');
    const natural = sample('natural-right-x3');
    expect(max(square.map((j) => Math.abs(turn(j.lSh, j.rSh))))).toBeLessThan(1);
    expect(max(natural.map((j) => turn(j.lSh, j.rSh)))).toBeGreaterThanOrEqual(35);
    for (const run of [square, natural]) {
      expect(max(run.map((j) => j.rFist[2]))).toBeGreaterThan(0.55);
      expect(max(run.map((j) => j.lFist[2]))).toBeLessThan(0.3);
    }
  });

  it('left straight extends the LEFT fist only', () => {
    const run = sample('left-x1');
    expect(max(run.map((j) => j.lFist[2]))).toBeGreaterThan(0.55);
    expect(max(run.map((j) => j.rFist[2]))).toBeLessThan(0.3);
  });

  it('on screen, in both views, the punching fist reaches out on its own side (right = screen-right)', () => {
    for (const [id, fist, sign] of [
      ['square-right-x3', 'rFist', 1],
      ['natural-right-x3', 'rFist', 1],
      ['left-x1', 'lFist', -1],
    ] as const) {
      const peak = sample(id).reduce((a, b) => (b[fist][2] > a[fist][2] ? b : a));
      for (const view of [{ ...VIEWS[0]!, yaw: ORBIT[id] ?? 0 }, VIEWS[1]!]) {
        const x = (p: V): number => project(p, view)[0];
        expect(sign * (x(peak[fist]) - x(peak.neck)), `${id} ${view.title}`).toBeGreaterThan(0.02); // from above a straight aims near the middle
      }
    }
  });
});
