// Player body → Boxing BODY input (PLAN-BOXING §2.5): one event per pose frame placing the boxer's head
// and gloves in its own frame (m). Pure; the sim scores these positions, the renderer draws them.
// Gains are fixed per axis and normalised by the player's arm length (calibrated by the body scan,
// BX-CAL-6), so they scale the body but never clamp or gate it.
import { boxingConfig as C } from '../../core/boxing/boxing.config';
import type { InputEvent } from '../../core/input';
import { gestureConfig } from '../../pose/gestures.config';
import type { PoseState, Vec3 } from '../../pose/pose-state';
import type { ArmLengths } from '../types';

const B = C.body;
type P3 = [number, number, number];

export const DEFAULT_ARMS: ArmLengths = {
  upperArm: gestureConfig.pose.upperArm,
  forearm: gestureConfig.pose.forearm,
};

/** Ready-stance glove relative to its shoulder, m, for an arm that isn't tracked this frame. */
const REST: P3 = [-0.02, -0.22, 0.2];

/** Rotation about +y by `yaw` (+ = turned to the player's left). */
const yawed = (p: readonly number[], yaw: number): P3 => [
  p[0]! * Math.cos(yaw) + p[2]! * Math.sin(yaw),
  p[1]!,
  -p[0]! * Math.sin(yaw) + p[2]! * Math.cos(yaw),
];

function glove(wrist: Vec3 | null, side: 1 | -1, shoulder: P3, arm: number): P3 {
  const g = B.armGainM;
  const w: P3 = wrist
    ? [(wrist.x / arm) * g.side, (wrist.y / arm) * g.up, (wrist.z / arm) * g.forward]
    : [side * REST[0], REST[1], REST[2]];
  return [shoulder[0] + w[0], shoulder[1] + w[1], shoulder[2] + w[2]];
}

export function bodyFromPose(
  pose: PoseState,
  arms: ArmLengths = DEFAULT_ARMS,
): NonNullable<InputEvent['body']> {
  const k = B.leanGainM;
  const { sway, duck, rise, forward } = pose.body;
  const shift: P3 = [sway * k, (rise - duck) * k, forward * B.cameraDistanceM * k];
  const at = (p: readonly number[]): P3 => [p[0]! + shift[0], p[1]! + shift[1], p[2]! + shift[2]];
  const centre = [0, B.shoulder[1], B.shoulder[2]];
  // Shoulders turn with the torso about the shoulder centre (a hook's shoulder comes forward).
  const shoulder = (side: 1 | -1): P3 => {
    const r = yawed([side * B.shoulder[0], 0, 0], pose.torso.yaw);
    return at([centre[0]! + r[0], centre[1]! + r[1], centre[2]! + r[2]]);
  };
  const arm = arms.upperArm + arms.forearm;
  return {
    head: at(B.head),
    gloves: [
      glove(pose.arms[0]?.wrist ?? null, 1, shoulder(1), arm),
      glove(pose.arms[1]?.wrist ?? null, -1, shoulder(-1), arm),
    ],
  };
}

/** The BODY event for one pose frame of `player`. */
export const bodyEvent = (pose: PoseState, player: number, arms: ArmLengths | null): InputEvent => ({
  t: pose.t,
  type: 'BODY',
  player,
  body: bodyFromPose(pose, arms ?? DEFAULT_ARMS),
});
