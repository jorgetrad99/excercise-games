// Per-frame pose mirroring output (PoseState): what a renderer binds a rig to, continuously, next to
// the discrete PUNCH_*/GUARD_*/DODGE events the sim scores. Rotation retargeting, the approach of
// Kalidokit / three-mediapipe-rig: each bone's direction comes from two landmarks and turns into a
// rotation from the rig's rest pose (three.js Quaternion.setFromUnitVectors). docs/ARCHITECTURE.md
// "Pose mirroring" documents the contract for render/.
//
// Depth: MediaPipe's per-landmark z is unusable for bone geometry. On Jorge's real recording a 3D
// upper arm measured 1.59 torso lengths at p90 (0.56 in 2D) and hanging, straight arms read as
// 70-87 % straight. So depth comes from known bone lengths instead (scaled-orthographic
// reconstruction): a bone whose 2D projection is shorter than its length points toward or away from
// the camera by the missing part. Arms take the forward sign (boxing arms work in front of the body).
import type { Body, Measures, Point } from './body';
import type { Calib } from './calibration';
import type { GestureConfig } from './gestures.config';

/** Character axes: +x = the player's left, +y = up, +z = forward (toward the camera / opponent).
 *  The same frame as the boxer rig (faces +z, its left is +x). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
/** Unit quaternion [x, y, z, w] in character axes (three.js Quaternion.fromArray order). */
export type Quat = [number, number, number, number];

export interface ArmState {
  /** Unit direction shoulder -> elbow. */
  upper: Vec3;
  /** Unit direction elbow -> wrist. */
  fore: Vec3;
  /** Swing from the rest arm (hanging straight down, (0, -1, 0)) to `upper` / `fore`. No twist. */
  upperRot: Quat;
  foreRot: Quat;
  /** Wrist relative to its shoulder, torso lengths: the IK target (x the rig's torso length in m). */
  wrist: Vec3;
  /** Elbow straightness, 0 = folded (wrist on the shoulder) ... 1 = straight. Hanging arms read 1 too. */
  extension: number;
  /** Wrist forward of the shoulder / arm length, clamped 0..1: live punch progress (a full straight
   *  reads ~1, hanging arms 0). */
  reach: number;
  /** Wrist speed, torso lengths/s: the same value as SignalFrame.fistL / fistR. */
  speed: number;
}

export interface PoseState {
  t: number;
  /** Whole-body motion from the calibrated stance. Torso lengths, except `forward`. */
  body: {
    /** Shoulder-center shift, + = toward the player's left (screen-left in the mirrored view). */
    sway: number;
    /** Nose drop, + = down (a duck). */
    duck: number;
    /** Hip rise, + = up. */
    rise: number;
    /** Change of distance to the camera as a fraction of the calibrated one, + = stepped closer. */
    forward: number;
  };
  /** Chest, relative to the calibrated stance. Radians, three.js Euler order 'YXZ' in character axes:
   *  yaw + = turned to the player's left, pitch + = bent forward (never negative), roll + = left
   *  shoulder up. `rot` is the same rotation as a quaternion. */
  torso: { yaw: number; pitch: number; roll: number; rot: Quat };
  /** Pelvis: roll only (hips barely turn or bend in a boxing stance). */
  hips: { roll: number; rot: Quat };
  /** Head relative to the camera (not to the chest): yaw from the nose between the ears, roll from the
   *  ear line. No pitch (no calibrated reference yet). Zero when an ear is not tracked. */
  head: { yaw: number; roll: number; rot: Quat };
  /** [left, right] = the player's anatomical arms; null when the elbow or wrist is not tracked. */
  arms: [ArmState | null, ArmState | null];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

/** Shortest rotation taking unit vector a onto unit vector b (three.js setFromUnitVectors). */
export function quatFromUnitVectors(a: Vec3, b: Vec3): Quat {
  const r = a.x * b.x + a.y * b.y + a.z * b.z + 1;
  const q: Quat =
    r < 1e-6 // opposite vectors: any perpendicular axis works
      ? Math.abs(a.x) > Math.abs(a.z)
        ? [-a.y, a.x, 0, 0]
        : [0, -a.z, a.y, 0]
      : [a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x, r];
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** three.js Quaternion.setFromEuler(new Euler(pitch, yaw, roll, 'YXZ')). */
export function quatFromEuler(pitch: number, yaw: number, roll: number): Quat {
  const [c1, c2, c3] = [Math.cos(pitch / 2), Math.cos(yaw / 2), Math.cos(roll / 2)];
  const [s1, s2, s3] = [Math.sin(pitch / 2), Math.sin(yaw / 2), Math.sin(roll / 2)];
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  ];
}

const DOWN: Vec3 = { x: 0, y: -1, z: 0 };

/** Image aspect and the live torso length in image-height units: the unit of every length here. */
interface Frame {
  aspect: number;
  scale: number;
}

/** Image vector a -> b in character axes, torso lengths, no depth. Raw image x grows toward the
 *  player's left (unmirrored camera, player facing it): same sign as +x. Image y grows down. */
const flat = (f: Frame, a: Point, b: Point): Vec3 => ({
  x: ((b.x - a.x) * f.aspect) / f.scale,
  y: -(b.y - a.y) / f.scale,
  z: 0,
});

/** A bone of known length seen in 2D: fills in the missing depth, `sign` = +1 forward. */
function bone(v: Vec3, length: number, sign: number): Vec3 {
  const inPlane = Math.hypot(v.x, v.y);
  return { x: v.x, y: v.y, z: sign * Math.sqrt(Math.max(0, length * length - inPlane * inPlane)) };
}

function arm(
  f: Frame,
  joints: [Point | null, Point | null, Point | null],
  speed: number,
  cfg: GestureConfig['pose'],
): ArmState | null {
  const [shoulder, elbow, wrist] = joints;
  if (!shoulder || !elbow || !wrist) return null;
  // ponytail: always forward; a fist behind the shoulder (hook wind-up) mirrors in front. Take the
  // sign from world-landmark z if the boxing fixture shows it is reliable (pnpm tune:boxing).
  const upperV = bone(flat(f, shoulder, elbow), cfg.upperArm, 1);
  const foreV = bone(flat(f, elbow, wrist), cfg.forearm, 1);
  const w = { x: upperV.x + foreV.x, y: upperV.y + foreV.y, z: upperV.z + foreV.z };
  const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
  const [upper, fore] = [norm(upperV), norm(foreV)];
  return {
    upper,
    fore,
    upperRot: quatFromUnitVectors(DOWN, upper),
    foreRot: quatFromUnitVectors(DOWN, fore),
    wrist: w,
    extension: clamp(len(w) / (len(upperV) + len(foreV) || 1), 0, 1),
    reach: clamp(w.z / (cfg.upperArm + cfg.forearm), 0, 1),
    speed,
  };
}

/** Angle of the line right -> left point against the horizontal, + = left side up. |x| keeps it within
 *  +-90 deg when a turn flips the line (atan2 alone read +-pi on Jorge's recording). */
const lineRoll = (f: Frame, right: Point, left: Point): number => {
  const v = flat(f, right, left);
  return Math.atan2(v.y, Math.abs(v.x));
};

function head(f: Frame, b: Body): PoseState['head'] {
  const { nose, lEar, rEar } = b;
  if (!nose || !lEar || !rEar) return { yaw: 0, roll: 0, rot: [0, 0, 0, 1] };
  const ears = flat(f, rEar, lEar);
  const half = Math.hypot(ears.x, ears.y) / 2;
  const offset = flat(f, { x: (lEar.x + rEar.x) / 2, y: (lEar.y + rEar.y) / 2 }, nose).x;
  const yaw = half > 0 ? Math.asin(clamp(offset / half, -1, 1)) : 0;
  const roll = lineRoll(f, rEar, lEar);
  return { yaw, roll, rot: quatFromEuler(0, yaw, roll) };
}

export interface PoseStateInput {
  t: number;
  body: Body;
  m: Measures;
  calib: Calib;
  /** The same values the SignalFrame carries. */
  signals: { leanX: number; headDrop: number; hipRise: number; fistL: number; fistR: number };
  cfg: GestureConfig;
}

function torso(f: Frame, m: Measures, calib: Calib, cfg: GestureConfig['pose']) {
  const spine = bone(flat(f, m.hipCenter, m.shoulderCenter), 1, 1);
  const pitch = Math.atan2(spine.z, Math.hypot(spine.x, spine.y));
  const shoulderLen = calib.shoulderWidth / calib.torsoLen;
  const across = flat(f, m.rShoulder, m.lShoulder);
  // Narrow shoulders alone can't tell a turn from a calibration taken bent over (Jorge's recording
  // read +-1 rad while he faced the camera, the sign flipping with nose noise), so the turn only counts
  // as far as the nose also left the shoulder center: 0 centered, full at yawNose shoulder lengths.
  const turn = Math.acos(clamp(Math.hypot(across.x, across.y) / shoulderLen, 0, 1));
  const noseSide = m.nose ? flat(f, m.shoulderCenter, m.nose).x : 0;
  const yaw = turn * clamp(noseSide / (cfg.yawNose * shoulderLen), -1, 1);
  // Vertical drop over the known width: stays sane when a turn collapses the line.
  const roll = Math.asin(clamp(across.y / shoulderLen, -1, 1));
  return { yaw, pitch, roll, rot: quatFromEuler(pitch, yaw, roll) };
}

/** One PoseState from the already-smoothed body (calibrated players only). */
export function derivePoseState({
  t,
  body: b,
  m,
  calib,
  signals: s,
  cfg,
}: PoseStateInput): PoseState {
  // Distance scale: stepping closer grows both torso and shoulders. Bending forward shrinks only the
  // torso and turning only the shoulders, so the larger ratio is the one left untouched.
  // ponytail: a simultaneous bend + turn under-reads both; hip width would disambiguate.
  const k = Math.max(m.torsoLen / calib.torsoLen, m.shoulderWidth / calib.shoulderWidth);
  const f: Frame = { aspect: m.aspect, scale: calib.torsoLen * k };
  const hipsRoll = lineRoll(f, b.rHip!, b.lHip!); // measure() returned: both hips are tracked
  return {
    t,
    body: {
      sway: (-s.leanX * calib.shoulderWidth) / calib.torsoLen,
      duck: s.headDrop,
      rise: s.hipRise,
      forward: 1 - 1 / k,
    },
    torso: torso(f, m, calib, cfg.pose),
    hips: { roll: hipsRoll, rot: quatFromEuler(0, 0, hipsRoll) },
    head: head(f, b),
    arms: [
      arm(f, [b.lShoulder, b.lElbow, b.lWrist], s.fistL, cfg.pose),
      arm(f, [b.rShoulder, b.rElbow, b.rWrist], s.fistR, cfg.pose),
    ],
  };
}
