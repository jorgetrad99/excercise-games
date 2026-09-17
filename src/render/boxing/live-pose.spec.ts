import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createLiveSmoother, liveTarget, wristOf, type LivePose } from './live-pose';
import { boxingVisual as V } from './visual.config';

const L = V.live;
const I = [0, 0, 0, 1] as const;
const swing = (to: Vector3) =>
  new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), to.normalize()).toArray() as [
    number,
    number,
    number,
    number,
  ];
const still = (over: Partial<LivePose> = {}): LivePose => ({
  body: { sway: 0, duck: 0, rise: 0, forward: 0 },
  torso: { rot: I },
  hips: { rot: I },
  head: { rot: I },
  arms: [null, null],
  ...over,
});

describe('live pose → boxer expression', () => {
  it('no pose, or a calibrated still pose, has no influence', () => {
    for (const pose of [null, still()]) {
      const e = liveTarget(pose);
      expect(e.lean.length()).toBe(0);
      expect(e.head.angleTo(new Quaternion())).toBe(0);
      expect(e.gloves.map((g) => g.length())).toEqual([0, 0]);
    }
    expect(liveTarget(null).weight).toBe(0);
  });

  it('forward is a fraction of the camera distance, not torso lengths', () => {
    const e = liveTarget(still({ body: { sway: 0, duck: 0, rise: 0, forward: 0.01 } }));
    expect(e.lean.z).toBeCloseTo(0.01 * L.cameraDistanceM, 9);
    expect(e.lean.z).not.toBeCloseTo(0.01 * L.torsoM, 9);
  });

  it('sways, ducks and turns are clamped well below a sim dodge', () => {
    const e = liveTarget(
      still({
        body: { sway: 2, duck: 2, rise: 0, forward: -1 },
        head: {
          rot: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.4).toArray() as never,
        },
      }),
    );
    expect(e.lean.toArray()).toEqual([L.leanMaxM, -L.leanMaxM, -L.leanMaxM]);
    expect(e.head.angleTo(new Quaternion())).toBeCloseTo(L.headMaxRad, 6);
  });

  it('reads arm swings from a hanging arm: down = hanging, forward = reaching', () => {
    const hanging = wristOf({ upperRot: I, foreRot: I }, new Vector3());
    expect(hanging.toArray().map((n) => +n.toFixed(9))).toEqual([
      0,
      -(L.upperArmM + L.forearmM),
      0,
    ]);
    const fwd = swing(new Vector3(0, 0, 1));
    const reach = wristOf({ upperRot: fwd, foreRot: fwd }, new Vector3());
    expect(reach.z).toBeCloseTo(L.upperArmM + L.forearmM, 6);
    // Anatomical left arm raised out to its side (+x) moves the left glove toward +x only.
    const out = swing(new Vector3(1, 0, 0));
    const e = liveTarget(still({ arms: [{ upperRot: out, foreRot: out }, null] }));
    expect(e.gloves[0].x).toBeCloseTo(L.gloveMaxM, 6);
    expect(e.gloves[1].length()).toBe(0);
    // A full reach at the camera nudges both gloves forward by at most the clamp.
    const both = liveTarget(
      still({
        arms: [
          { upperRot: fwd, foreRot: fwd },
          { upperRot: fwd, foreRot: fwd },
        ],
      }),
    );
    expect(both.gloves.map((g) => +g.z.toFixed(9))).toEqual([L.gloveMaxM, L.gloveMaxM]);
  });

  it('eases toward a new pose over time and fades back out when tracking drops', () => {
    const smooth = createLiveSmoother();
    const pose = still({ body: { sway: 1, duck: 0, rise: 0, forward: 0 } });
    expect(smooth(pose, L.smoothS).lean.x).toBeCloseTo(L.leanMaxM * (1 - Math.exp(-1)), 9);
    expect(smooth(pose, 10).lean.x).toBeCloseTo(L.leanMaxM, 9);
    const faded = smooth(null, 10);
    expect(faded.lean.x).toBeCloseTo(0, 9);
    expect(faded.weight).toBeLessThan(1e-3);
    expect(smooth(pose, 0).lean.x).toBeCloseTo(0, 9); // no time passed: no jump
  });
});
