import { describe, expect, it } from 'vitest';
import { faceBox } from './face-crop';
import type { Landmark } from './types';

const lm = (x: number, y: number, visibility = 0.9): Landmark => ({ x, y, z: 0, visibility });

/** Nose at (0.5, 0.3); eyes ±0.01, ears ±0.02 of x (1280×720 px: eyes 25.6 px apart, ears 51.2). */
function face(earVis = 0.9, noseVis = 0.9): Landmark[] {
  const pose = Array.from({ length: 33 }, () => lm(0, 0, 0));
  pose[0] = lm(0.5, 0.3, noseVis);
  pose[2] = lm(0.51, 0.29);
  pose[5] = lm(0.49, 0.29);
  pose[7] = lm(0.52, 0.3, earVis);
  pose[8] = lm(0.48, 0.3, earVis);
  return pose;
}

describe('faceBox', () => {
  it('square around the nose, sized by the ears, lifted toward the forehead', () => {
    const b = faceBox(face(), 1280, 720)!;
    expect(b.side).toBeCloseTo(51.2 * 2, 3);
    expect(b.x).toBeCloseTo(640, 3);
    expect(b.y).toBeLessThan(216); // above the nose (y down)
  });

  it('head turned (an ear hidden): sized by the eyes instead', () => {
    expect(faceBox(face(0.1), 1280, 720)!.side).toBeCloseTo(25.6 * 3.4, 3);
  });

  it('no visible nose: no face', () => {
    expect(faceBox(face(0.9, 0.1), 1280, 720)).toBeNull();
  });
});
