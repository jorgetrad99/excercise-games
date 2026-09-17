/** Render-only tuning: metres, radians and seconds. Gameplay rules remain in core/boxing. */
export const boxingVisual = {
  headScale: 2.6,
  /** Proportional radius before headScale, metres. */
  headRadius: 0.12,
  headLift: 0.23,
  /** Hit reaction (overlay O1) length, s: PLAN-BOXING §2.2 bounds it to ≤ 0.35 s. */
  hitS: 0.35,
  /** Dizzy wobble fade in/out time constant, s. */
  dizzyEaseS: 0.15,
  bruisePerHit: 0.24,
  /** Outward bulge at full damage (1), m, on a head ~0.31 m in radius. */
  swellM: 0.045,
  /** Bulge width: angular standard deviation around the bruise, rad. */
  swellRad: 0.3,
  /** Live pose expressiveness. Clamps keep it well below a sim dodge (0.35 m) or punch (0.73 m). */
  live: {
    /** Exponential easing time constant, s. */
    smoothS: 0.08,
    /** Typical player-to-camera distance, m: PoseState `body.forward` is a fraction of it. */
    cameraDistanceM: 2.5,
    /** Rig torso length, m: PoseState lengths are in torso units. */
    torsoM: 0.5,
    upperArmM: 0.28,
    forearmM: 0.27,
    /** The sim's READY glove relative to the left shoulder, m (right mirrors x). */
    restWrist: [0.04, -0.22, 0.32] as const,
    leanMaxM: 0.06,
    gloveMaxM: 0.12,
    hipsMaxRad: 0.2,
    torsoMaxRad: 0.35,
    headMaxRad: 0.5,
  },
};
