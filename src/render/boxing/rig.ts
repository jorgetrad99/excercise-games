// The only write path for player-owned rig channels (PLAN-BOXING §2.2, §4.1, BX-A-6):
// rig = live(player) + Σ offsets. Offsets are additive, bounded in magnitude and bounded in time; nothing
// here replaces, scales, freezes or lags the live value. No three.js: plain arrays, character axes
// (+x = the boxer's left, +y up, +z toward the opponent), quaternions [x, y, z, w].
// No pose/ import either: render reads this module, and render never depends on the pose layer.

export type P3 = [number, number, number];
/** Unit quaternion [x, y, z, w] in character axes (the same layout as pose/ PoseState rotations). */
export type Quat = [number, number, number, number];

/** Rotation about +y (yaw) / +z (roll), rad. */
export const yawQ = (a: number): Quat => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
export const rollQ = (a: number): Quat => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];

/** Player-owned channels a frame draws. `root`: body offset from the neutral spot, m. */
export interface RigPose {
  root: P3;
  hips: Quat;
  torso: Quat;
  head: Quat;
  gloves: [P3, P3];
}
export type RigOffsets = RigPose;

/** §2.2 bounds. O1 hit reaction; O2 stunned. */
export const BOUNDS = {
  hit: { headRad: 0.5, rootM: 0.08, s: 0.35 },
  stun: { rotRad: 0.15, wristM: 0.1, rootM: 0.1, tauS: 0.35, wobbleRad: 0.08 },
} as const;

const ID: Quat = [0, 0, 0, 1];
export const NO_OFFSETS = (): RigOffsets => ({
  root: [0, 0, 0],
  hips: [...ID],
  torso: [...ID],
  head: [...ID],
  gloves: [
    [0, 0, 0],
    [0, 0, 0],
  ],
});

export function qmul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
const qinv = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
/** Rotation angle of a unit quaternion, rad (0 … π). */
export const qangle = (q: Quat): number => 2 * Math.acos(Math.min(1, Math.abs(q[3])));
/** `q` shortened to at most `max` rad (same axis). */
export function qclamp(q: Quat, max: number): Quat {
  const angle = qangle(q);
  if (angle <= max || angle === 0) return q;
  const s = Math.sin(max / 2) / Math.sin(angle / 2);
  const sign = q[3] < 0 ? -1 : 1;
  return [q[0] * s * sign, q[1] * s * sign, q[2] * s * sign, Math.cos(max / 2)];
}
const vadd = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vclamp = (v: P3, max: number): P3 => {
  const l = Math.hypot(...v);
  return l <= max || l === 0 ? v : [(v[0] * max) / l, (v[1] * max) / l, (v[2] * max) / l];
};

/** BX-A-6: the rig. Positions add; rotations compose the offset onto the live rotation. */
export function boxingRig(live: RigPose, o: RigOffsets): RigPose {
  return {
    root: vadd(live.root, o.root),
    hips: qmul(o.hips, live.hips),
    torso: qmul(o.torso, live.torso),
    head: qmul(o.head, live.head),
    gloves: [vadd(live.gloves[0], o.gloves[0]), vadd(live.gloves[1], o.gloves[1])],
  };
}

/** Sum of two offset sets (O1 + O2), each already bounded. */
export function addOffsets(a: RigOffsets, b: RigOffsets): RigOffsets {
  return boxingRig(a, b);
}

/**
 * O1: head snap away from the blow + root stagger, `age` s after a hit on `side` (+1 = the boxer's left
 * cheek, −1 right, 0 chin). `clip`: the authored head track at that age (UAL Hit_Head), if any.
 * Zero from `BOUNDS.hit.s` on.
 */
export function hitOffset(age: number, side: number, clip: Quat | null = null): RigOffsets {
  const out = NO_OFFSETS();
  const b = BOUNDS.hit;
  if (!(age >= 0 && age < b.s)) return out;
  const k = age / b.s;
  const kick = Math.sin(k * Math.PI) * Math.exp(-age * 3);
  const yaw = yawQ(-side * kick * 0.4);
  out.head = qclamp(clip ? qmul(yaw, clip) : yaw, b.headRad);
  const recoil = 1 - k;
  out.root = vclamp([-side * 0.12 * recoil, 0, -0.12 * recoil], b.rootM);
  return out;
}

/**
 * O2: stunned. A follower eases toward the live pose with τ = stun.tauS; the offset is how far it trails
 * (clamped), plus a small wobble, times `weight` (0…1, eased by the caller). The player always moves the
 * part: the rig is never further than the bound from live.
 */
export function createStunOffset() {
  let slow: RigPose | null = null;
  return (live: RigPose, dtS: number, weight: number, t: number): RigOffsets => {
    const b = BOUNDS.stun;
    const k = 1 - Math.exp(-Math.max(0, dtS) / b.tauS);
    const ease = (from: P3, to: P3): P3 => vadd(from, vsub(to, from).map((d) => d * k) as P3);
    const easeQ = (from: Quat, to: Quat): Quat => {
      const d = qmul(to, qinv(from));
      const angle = qangle(d);
      return angle === 0 ? to : qmul(qclamp(d, angle * k), from);
    };
    slow = slow
      ? {
          root: ease(slow.root, live.root),
          hips: easeQ(slow.hips, live.hips),
          torso: easeQ(slow.torso, live.torso),
          head: easeQ(slow.head, live.head),
          gloves: [ease(slow.gloves[0], live.gloves[0]), ease(slow.gloves[1], live.gloves[1])],
        }
      : structuredClone(live);
    const w = Math.max(0, Math.min(1, weight));
    const rot = (s: Quat, l: Quat, wobble = 0): Quat =>
      qclamp(
        qmul(rollQ(wobble), qclamp(qmul(s, qinv(l)), b.rotRad * w)),
        b.rotRad * w,
      );
    const pos = (s: P3, l: P3, max: number): P3 => vclamp(vsub(s, l), max * w);
    const wobble = Math.sin(t * 5) * b.wobbleRad * w;
    return {
      root: pos(slow.root, live.root, b.rootM),
      hips: rot(slow.hips, live.hips),
      torso: rot(slow.torso, live.torso, wobble),
      head: rot(slow.head, live.head),
      gloves: [
        pos(slow.gloves[0], live.gloves[0], b.wristM),
        pos(slow.gloves[1], live.gloves[1], b.wristM),
      ],
    };
  };
}
