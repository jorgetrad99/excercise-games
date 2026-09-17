import { describe, expect, it } from 'vitest';
import { gestureConfig as cfg } from './gestures.config';
import { createDwell, createHandCursors, handPoint } from './hand-cursor';
import { syntheticPose } from './testdata/synthetic';
import type { Landmark } from './types';

const ASPECT = 16 / 9;

/** Neutral synthetic body (shoulders at raw x 0.44/0.56, y 0.35) with one wrist moved. */
function withWrist(index: 15 | 16, x: number, y: number, shift = 0): Landmark[] {
  const pose = syntheticPose({}, 0, 0)!.map((l) => ({ ...l, x: l.x + shift }));
  pose[index] = { x: x + shift, y, z: 0, visibility: 0.95 };
  return pose;
}

describe('hand cursors', () => {
  it('hands down: no cursor', () => {
    expect(handPoint(syntheticPose({}, 0, 0)!, ASPECT, cfg)).toBeNull();
  });

  it("the right hand raised to the person's right shows on screen-right; up = top", () => {
    // Person's right wrist is at smaller raw x; further right of the body = smaller raw x still.
    const right = handPoint(withWrist(16, 0.3, 0.2), ASPECT, cfg)!;
    expect(right.x).toBeGreaterThan(0.6);
    expect(right.y).toBeLessThan(0.4);
    const left = handPoint(withWrist(15, 0.7, 0.2), ASPECT, cfg)!;
    expect(left.x).toBeLessThan(0.4);
  });

  it('a hand at its own zone center points at the middle of the screen', () => {
    // Shoulder width = 0.12 * aspect (image heights). Zone center: offset toward the hand, drop below.
    const w = 0.12 * ASPECT;
    const x = 0.5 - (cfg.cursor.offset * w) / ASPECT; // right hand: toward smaller raw x
    const y = 0.35 + cfg.cursor.drop * w;
    const p = handPoint(withWrist(16, x, y), ASPECT, cfg)!;
    expect(p.x).toBeCloseTo(0.5, 5);
    expect(p.y).toBeCloseTo(0.5, 5);
  });

  it('two bodies: the screen-left body is P1, each with its own cursor', () => {
    const cursors = createHandCursors(cfg);
    // Raw x +0.25 = screen-left body; −0.25 = screen-right. Order in the frame is no identity.
    const p1 = withWrist(16, 0.3, 0.2, 0.25);
    const p2 = syntheticPose({}, 0, 0)!.map((l) => ({ ...l, x: l.x - 0.25 }));
    const [a, b] = cursors({ t: 0, poses: [p2, p1] }, ASPECT);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it('dwell fires once after the hold, restarts on a new target, re-arms after leaving', () => {
    const dwell = createDwell(1000);
    expect(dwell(0, 'a').fire).toBe(false);
    expect(dwell(600, 'a').progress).toBeCloseTo(0.6);
    expect(dwell(700, 'b').progress).toBe(0); // moved: start over
    expect(dwell(1699, 'b').fire).toBe(false);
    expect(dwell(1700, 'b').fire).toBe(true);
    expect(dwell(2500, 'b').fire).toBe(false); // still hovering: no repeat
    dwell(2600, null);
    dwell(2700, 'b');
    expect(dwell(3700, 'b').fire).toBe(true);
  });
});
