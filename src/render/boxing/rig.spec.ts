// PLAN-BOXING §2.2 / §4.1: rig = live + bounded, time-limited offsets (BX-A-4, BX-A-5, BX-A-6).
import { describe, expect, it } from 'vitest';
import { rollQ, yawQ } from './rig';
import {
  addOffsets,
  boxingRig,
  BOUNDS,
  createStunOffset,
  hitOffset,
  NO_OFFSETS,
  qangle,
  qmul,
  type P3,
  type Quat,
  type RigPose,
} from './rig';

const DT = 1 / 60;
const inv = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
/** Angle between two rotations, rad. */
const apart = (a: Quat, b: Quat) => qangle(qmul(a, inv(b)));
const dist = (a: P3, b: P3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const still = (): RigPose => ({
  root: [0, 0, 0],
  hips: [0, 0, 0, 1],
  torso: [0, 0, 0, 1],
  head: [0, 0, 0, 1],
  gloves: [
    [0.2, 1.3, 0.5],
    [-0.2, 1.3, 0.5],
  ],
});

describe('boxing rig offsets (PLAN-BOXING §4.1)', () => {
  it('BX-A-6: the rig is live plus the offsets, for any live pose (no branch ignores live)', () => {
    const offsets = addOffsets(hitOffset(0.1, 1), NO_OFFSETS());
    for (const yaw of [-1, 0, 0.3, 1.2]) {
      const live = still();
      live.head = yawQ(yaw);
      live.gloves[0] = [0.1 * yaw, 1.2, 0.4 + yaw];
      const rig = boxingRig(live, offsets);
      expect(apart(rig.head, live.head)).toBeCloseTo(qangle(offsets.head), 6);
      expect(dist(rig.gloves[0], live.gloves[0])).toBeCloseTo(0, 9);
      expect(rig.root).toEqual(offsets.root);
    }
    expect(boxingRig(still(), NO_OFFSETS())).toEqual(still());
  });

  it('BX-A-4: dizzy and just hit (O1 + O2 at full weight), the player still moves head, torso and wrist', () => {
    const stun = createStunOffset();
    const bound = {
      head: BOUNDS.hit.headRad + BOUNDS.stun.rotRad,
      torso: BOUNDS.stun.rotRad,
      wrist: BOUNDS.stun.wristM,
      root: BOUNDS.hit.rootM + BOUNDS.stun.rootM,
    };
    let rig = still();
    let live = still();
    for (let i = 0; i < Math.round(0.8 / DT); i++) {
      const t = i * DT;
      if (i === 3) {
        // During the O1 window: head yaw +0.6 rad, torso roll +0.4 rad, left wrist 0.3 m forward.
        live = still();
        live.head = yawQ(0.6);
        live.torso = rollQ(0.4);
        live.gloves[0] = [0.2, 1.3, 0.8];
      }
      const offsets = addOffsets(hitOffset(t, 1), stun(live, DT, 1, t));
      rig = boxingRig(live, offsets);
      expect(apart(rig.head, live.head), `head @${i}`).toBeLessThanOrEqual(bound.head + 1e-9);
      expect(apart(rig.torso, live.torso), `torso @${i}`).toBeLessThanOrEqual(bound.torso + 1e-9);
      expect(dist(rig.gloves[0], live.gloves[0]), `wrist @${i}`).toBeLessThanOrEqual(
        bound.wrist + 1e-9,
      );
      expect(Math.hypot(...rig.root), `root @${i}`).toBeLessThanOrEqual(bound.root + 1e-9);
    }
    // Settled (O1 over, O2 still on): each part moved by at least the step minus its bound.
    expect(apart(rig.head, [0, 0, 0, 1])).toBeGreaterThan(0.6 - BOUNDS.stun.rotRad - 1e-9);
    expect(qangle(rig.torso)).toBeGreaterThan(0.4 - BOUNDS.stun.rotRad - 1e-9);
    expect(rig.gloves[0][2] - 0.5).toBeGreaterThan(0.3 - BOUNDS.stun.wristM - 1e-9);
  });

  it('BX-A-5: O1 is zero from 0.35 s after the hit; O2 is < 1 % of its bound 1 s after dizzy clears', () => {
    expect(hitOffset(BOUNDS.hit.s - 1e-6, 1).head).not.toEqual([0, 0, 0, 1]);
    expect(hitOffset(BOUNDS.hit.s, 1)).toEqual(NO_OFFSETS());
    expect(hitOffset(2, -1)).toEqual(NO_OFFSETS());
    const stun = createStunOffset();
    const live = still();
    let weight = 1;
    let offsets = NO_OFFSETS();
    for (let i = 0; i < Math.round(1 / DT); i++) {
      live.gloves[0] = [0.2, 1.3, 0.5 + 0.3 * Math.sin(i / 3)]; // keeps moving: the follower trails
      weight += (0 - weight) * (1 - Math.exp(-DT / 0.15)); // dizzy cleared at i = 0 (presentation ease)
      offsets = stun(live, DT, weight, i * DT);
    }
    expect(qangle(offsets.torso)).toBeLessThan(0.01 * BOUNDS.stun.rotRad);
    expect(Math.hypot(...offsets.gloves[0])).toBeLessThan(0.01 * BOUNDS.stun.wristM);
  });
});
