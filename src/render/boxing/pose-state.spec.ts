import { expect, it } from 'vitest';
import { adaptBoxerPose, type TrackedBoxerPose } from './pose-state';

it('consumes the producer shape without importing pose, converts torso units and preserves missing arms', () => {
  const pose: TrackedBoxerPose = {
    body: { sway: 0.4, duck: 0.2, rise: 0, forward: 0.1 },
    torso: { rot: [0, 0, 0, 1] },
    hips: { rot: [0, 0, 0, 1] },
    head: { rot: [0, 0.258819, 0, 0.965926] },
    arms: [{ upperRot: [0, 0, 0, 1], foreRot: [0, 0, 0, 1], wrist: { x: 0, y: 0.2, z: 1 } }, null],
  };
  expect(adaptBoxerPose(pose)).toMatchObject({
    position: [0.2, -0.1, 0.05],
    wrists: [[0.2, 1.4500000000000002, 0.5], null],
    rotations: { head: pose.head.rot },
  });
  expect(adaptBoxerPose(null)).toBeNull();
});
