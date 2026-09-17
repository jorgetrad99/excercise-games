// TEMPORARY(synthetic-fixtures): synthetic poses until Jorge's B1 handedness clip exists.
import { describe, expect, it } from 'vitest';
import { handedness, mirrorFrame } from './handedness';
import { syntheticPose } from './testdata/synthetic';
import type { PoseFrame } from './types';

/** 3 s at 30 fps with the player's LEFT wrist (15) raised over the head, unmirrored camera. */
const leftHandUp = (): PoseFrame[] =>
  Array.from({ length: 90 }, (_, i) => {
    const pose = syntheticPose({}, i)!;
    pose[15] = { ...pose[15]!, y: 0.1 };
    return { t: (i * 1000) / 30, poses: [pose] };
  });

describe('handedness check (mirrored camera stream)', () => {
  it('reads the raised left hand as ok, and the same take through a mirrored stream as SWAPPED', () => {
    expect(handedness(leftHandUp())).toBe('ok');
    expect(handedness(leftHandUp().map(mirrorFrame))).toBe('SWAPPED');
    expect(handedness(leftHandUp().slice(0, 5))).toBe('unclear');
  });

  it('shoulder order alone cannot see a mirror: landmark 11 stays at larger x', () => {
    const [plain, mirrored] = [leftHandUp()[0]!, mirrorFrame(leftHandUp()[0]!)];
    for (const f of [plain, mirrored])
      expect(f.poses[0]![11]!.x).toBeGreaterThan(f.poses[0]![12]!.x);
    expect(handedness(leftHandUp().map(mirrorFrame).map(mirrorFrame))).toBe('ok'); // undoes itself
  });
});
