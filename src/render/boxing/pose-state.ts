/** Optional render adapter for the parallel pose-mirroring work. No pose-layer imports.
 * Quaternions are deltas from neutral, in character axes (+x left, +y up, +z forward).
 * A missing joint means use the animation. Targets are boxer-local metres. */
export type JointRotation = readonly [number, number, number, number];
export type PoseJoint =
  'torso' | 'head' | 'hips' | 'shoulderL' | 'shoulderR' | 'elbowL' | 'elbowR' | 'wristL' | 'wristR';
export interface BoxerPoseState {
  rotations: Partial<Record<PoseJoint, JointRotation>>;
  wrists?: readonly [
    readonly [number, number, number] | null,
    readonly [number, number, number] | null,
  ];
  position?: readonly [number, number, number];
}
/** Structural subset of the parallel pose/PoseState output. Keep the render→pose boundary intact.
 * Head/torso/hips rotations are absolute character-frame deltas, not chained joint deltas. */
export interface TrackedBoxerPose {
  body: { sway: number; duck: number; rise: number; forward: number };
  torso: { rot: JointRotation };
  hips: { rot: JointRotation };
  head: { rot: JointRotation };
  arms: readonly [TrackedArm | null, TrackedArm | null];
}
interface TrackedArm {
  upperRot: JointRotation;
  foreRot: JointRotation;
  wrist: { x: number; y: number; z: number };
}
export interface BoxingPoseFeed {
  /** Return null on lost/stale tracking; gameplay animations are the fallback. */
  pose(player: number): TrackedBoxerPose | null;
}

/** Shoulder-relative torso units → boxer-local metres. Floating gloves consume the wrist targets;
 * joint rotations remain available when visible arms replace the existing collapsed-arm style. */
export function adaptBoxerPose(pose: TrackedBoxerPose | null | undefined): BoxerPoseState | null {
  if (!pose) return null;
  const torsoMetres = 0.5;
  const rotations: BoxerPoseState['rotations'] = {
    hips: pose.hips.rot,
    torso: pose.torso.rot,
    head: pose.head.rot,
  };
  const wrists: [
    readonly [number, number, number] | null,
    readonly [number, number, number] | null,
  ] = [null, null];
  pose.arms.forEach((arm, i) => {
    if (!arm) return;
    rotations[i === 0 ? 'shoulderL' : 'shoulderR'] = arm.upperRot;
    rotations[i === 0 ? 'elbowL' : 'elbowR'] = arm.foreRot;
    wrists[i as 0 | 1] = [
      (i === 0 ? 0.2 : -0.2) + arm.wrist.x * torsoMetres,
      1.35 + arm.wrist.y * torsoMetres,
      arm.wrist.z * torsoMetres,
    ];
  });
  return {
    rotations,
    wrists,
    position: [
      pose.body.sway * torsoMetres,
      (pose.body.rise - pose.body.duck) * torsoMetres,
      pose.body.forward * torsoMetres,
    ],
  };
}
