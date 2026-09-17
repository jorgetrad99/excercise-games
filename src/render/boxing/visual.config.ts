/** Render-only tuning: metres, radians and seconds. Gameplay rules remain in core/boxing. */
export const boxingVisual = {
  headScale: 2.6,
  /** Proportional radius before headScale, metres. */
  headRadius: 0.12,
  headLift: 0.23,
  fallS: 0.7,
  riseS: 0.9,
  hitS: 0.44,
  bruisePerHit: 0.24,
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
