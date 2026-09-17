// Live body → boxer expression. The shell hands `GameView.render` one PoseState per player each frame
// (pose/pose-state.ts; docs/ARCHITECTURE.md "Pose mirroring"). The sim stays authoritative for anything
// scored: this only adds clamped lean, idle glove motion and torso/hips/head turns on top of what the sim
// shows, so a dodge or punch the sim didn't register never appears on screen.
import { MathUtils, Quaternion, Vector3 } from 'three';
import { boxingVisual as V } from './visual.config';

/** `[x, y, z, w]` in character axes: +x anatomical left, +y up, +z forward. */
type Quat = readonly [number, number, number, number];
/** Structural subset of pose/PoseState (render may not import pose/). Keep in step with it. */
export interface LivePose {
  /** Lengths in torso units, except `forward`: a fraction of the calibrated camera distance. */
  body: { sway: number; duck: number; rise: number; forward: number };
  /** Deltas from the calibrated stance; head is relative to the camera, not the chest. */
  torso: { rot: Quat };
  hips: { rot: Quat };
  head: { rot: Quat };
  /** [left, right]. Rotations swing an arm hanging straight down (0, −1, 0); null = not tracked. */
  arms: readonly [LiveArm | null, LiveArm | null];
}
interface LiveArm {
  upperRot: Quat;
  foreRot: Quat;
}

/** Smoothed, clamped, boxer-local. Identity/zero = no live influence. */
export interface LiveExpression {
  hips: Quaternion;
  torso: Quaternion;
  head: Quaternion;
  /** Body offset, m. */
  lean: Vector3;
  /** Glove offsets from the sim's rest spot, m: [left, right]. Applied only to a fist at rest. */
  gloves: [Vector3, Vector3];
  /** 0 = no pose for a while (animation only) … 1 = fully live. */
  weight: number;
}

const L = V.live;
const DOWN = new Vector3(0, -1, 0);
const IDENTITY = new Quaternion();
const q = new Quaternion();
const full = new Quaternion();
const v = new Vector3();

/** `q` limited to `max` radians away from identity. */
function limit(out: Quaternion, rot: Quat, max: number): Quaternion {
  full.fromArray(rot).normalize();
  const angle = 2 * Math.acos(Math.min(1, Math.abs(full.w)));
  // slerpQuaternions copies its first argument into `out` first: never pass `out` as the target.
  return out.slerpQuaternions(IDENTITY, full, angle > max ? max / angle : 1);
}

/** Shoulder → wrist on the rig, m, from the two arm swings. */
export function wristOf(arm: LiveArm, out: Vector3): Vector3 {
  out.copy(DOWN).applyQuaternion(q.fromArray(arm.upperRot)).multiplyScalar(L.upperArmM);
  return out.add(v.copy(DOWN).applyQuaternion(q.fromArray(arm.foreRot)).multiplyScalar(L.forearmM));
}

function gloveTarget(arm: LiveArm | null, hand: 0 | 1, out: Vector3): Vector3 {
  if (!arm) return out.set(0, 0, 0);
  const side = hand === 0 ? 1 : -1;
  wristOf(arm, out).sub(v.set(side * L.restWrist[0], L.restWrist[1], L.restWrist[2]));
  const m = L.gloveMaxM;
  return out.set(
    MathUtils.clamp(out.x, -m, m),
    MathUtils.clamp(out.y, -m, m),
    MathUtils.clamp(out.z, -m, m),
  );
}

function neutral(): LiveExpression {
  return {
    hips: new Quaternion(),
    torso: new Quaternion(),
    head: new Quaternion(),
    lean: new Vector3(),
    gloves: [new Vector3(), new Vector3()],
    weight: 0,
  };
}

/** Where a pose (or its absence) wants the expression to be. */
export function liveTarget(pose: LivePose | null, out = neutral()): LiveExpression {
  if (!pose) {
    [out.hips, out.torso, out.head].forEach((x) => x.identity());
    out.lean.set(0, 0, 0);
    out.gloves.forEach((g) => g.set(0, 0, 0));
    out.weight = 0;
    return out;
  }
  const { body } = pose;
  const m = L.leanMaxM;
  limit(out.hips, pose.hips.rot, L.hipsMaxRad);
  limit(out.torso, pose.torso.rot, L.torsoMaxRad);
  limit(out.head, pose.head.rot, L.headMaxRad);
  out.lean.set(
    MathUtils.clamp(body.sway * L.torsoM, -m, m),
    MathUtils.clamp((body.rise - body.duck) * L.torsoM, -m, m),
    MathUtils.clamp(body.forward * L.cameraDistanceM, -m, m),
  );
  gloveTarget(pose.arms[0], 0, out.gloves[0]);
  gloveTarget(pose.arms[1], 1, out.gloves[1]);
  out.weight = 1;
  return out;
}

/** One boxer's live expression, eased toward each new pose (input arrives at ~20–30 Hz, render at 60). */
export function createLiveSmoother() {
  const current = neutral();
  const target = neutral();
  return (pose: LivePose | null, dtS: number): LiveExpression => {
    liveTarget(pose, target);
    const k = 1 - Math.exp(-Math.max(0, dtS) / L.smoothS);
    current.hips.slerp(target.hips, k);
    current.torso.slerp(target.torso, k);
    current.head.slerp(target.head, k);
    current.lean.lerp(target.lean, k);
    current.gloves[0].lerp(target.gloves[0], k);
    current.gloves[1].lerp(target.gloves[1], k);
    current.weight += (target.weight - current.weight) * k;
    return current;
  };
}

/** Both boxers' expressions for one rendered frame, eased on the wall clock between frames. */
export function createLiveFeed() {
  const smoothers = [createLiveSmoother(), createLiveSmoother()];
  let last = performance.now();
  return (poses: readonly (LivePose | null)[]): LiveExpression[] => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    return smoothers.map((smooth, who) => smooth(poses[who] ?? null, dt));
  };
}
