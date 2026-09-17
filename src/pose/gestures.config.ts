// Gesture tuning constants (PLAN §2.2). Playtest and tune HERE, nowhere else.
// Units: "torso" = calibrated torso length, "shoulder" = calibrated shoulder width, ms = milliseconds.

export type LaneMode = 'lean' | 'zones';
export type FistReference = 'nose' | 'shoulder';

export const gestureConfig = {
  /**
   * One Euro filter on landmarks in normalized image-height units (Hz / s per unit / Hz).
   * Tuned with `pnpm latency:gestures GRID=1` on Jorge's recorded still-standing noise: its jitter is
   * mostly slow sway no cutoff removes, so a high beta cuts filter lag (≈40 → ≈12 ms) at no cost in
   * false events (0 at 1×/2×/4× that noise over 60 s). Pixel-space beta 0.007 ≈ 5 here.
   */
  filter: { minCutoff: 1.0, beta: 30, dCutoff: 1.0 },
  /** Landmarks below this MediaPipe visibility are ignored. */
  visibilityMin: 0.5,
  /** An ignored landmark keeps its last value this long (ms), then counts as lost. */
  holdLandmarkMs: 300,
  /** No shoulders+hips for this long (ms) → TRACKING_LOST (game pauses). */
  trackingLostMs: 700,
  /** Stand still this long (ms); moving more than maxDrift torsos restarts the countdown. */
  calibration: { holdMs: 2000, maxDrift: 0.08 },
  /** 'lean' = relative lean with hysteresis; 'zones' = absolute screen thirds. */
  laneMode: 'lean' as LaneMode,
  /** leanX (shoulders) past ±enter fires a lane event; must come back inside ±rearm to fire that side again. */
  lean: { enter: 0.35, rearm: 0.2 },
  /** zones mode: boundaries at 1/3 and 2/3 of the mirrored frame width, ± this much (normalized x). */
  zones: { hysteresis: 0.03 },
  /**
   * JUMP when hipRise > rise (torso) AND its velocity > velocity (torso/s, measured over velocityWindowMs).
   * Airborne (for GRAB) until hipRise < landRise or maxAirMs passed.
   */
  jump: {
    rise: 0.15,
    velocity: 1.2,
    velocityWindowMs: 100,
    cooldownMs: 500,
    landRise: 0.05,
    maxAirMs: 1000,
  },
  /** SLIDE_START when headDrop > enter (torso) for holdMs; SLIDE_END when headDrop < exit; cooldownMs after an end. */
  slide: { enter: 0.25, holdMs: 100, exit: 0.12, cooldownMs: 400 },
  /** Both wrists above the nose, held this long (ms) → REVIVE_ACCEPT. */
  reviveHoldMs: 1000,
  /**
   * Boxing fists (pose/fists.ts). Distances in torso lengths from the nose, speeds in torso/s of the
   * wrist relative to the nose (measured over velocityWindowMs).
   * PUNCH when an armed wrist has reached beyond `rearm` (2D from the nose, plus depth from where it
   * rested) and moves faster than `speed`, and not mostly downward (aim.y > −maxDown). A wrist arms
   * after staying within `rearm` (2D) and slower than `rearmSpeed` for `rearmMs`.
   * zWeight scales MediaPipe's noisy depth (0 = ignore it; straight punches then rely on 2D drift).
   * GUARD_START when both wrists are within guard.enter (2D); GUARD_END when either passes guard.exit.
   * UNTUNED: set from synthetic poses only; needs a real-camera playtest.
   */
  fists: {
    speed: 2.5,
    velocityWindowMs: 70,
    rearm: 0.6,
    rearmSpeed: 1,
    rearmMs: 100,
    maxDown: 0.7,
    zWeight: 1,
    /** Speed is measured against this point: 'nose' (original) or the arm's own 'shoulder', which
     *  ignores head bobs, ducks and sways that move both wrists relative to the face at once. */
    reference: 'nose' as FistReference,
    guard: { enter: 0.35, exit: 0.45 },
  },
  /**
   * Pose mirroring (pose/pose-state.ts). Bone lengths in calibrated torso lengths (shoulder center to
   * hip center), used to recover depth from 2D. From Jorge's Skate Run recording: median 2D upper arm
   * 0.49, forearm 0.47 (arms hanging, mostly in the image plane). Too short = arms read as pointing at
   * the camera; too long = never. Calibrate in the upright stance you play in: torso angles and
   * body offsets are deltas from it. Re-check with `pnpm tune:boxing` on the boxing fixture.
   */
  pose: {
    upperArm: 0.5,
    forearm: 0.48,
    /** Torso yaw counts fully once the nose is this many shoulder widths off the shoulder center. */
    yawNose: 0.25,
  },
  /**
   * Menu hand cursors (pose/hand-cursor.ts), Kinect-style. Units: shoulder widths, measured on screen
   * (mirrored) from the shoulder center; +x = screen right, +y = down. The raised hand is mapped from a
   * box centered `offset` toward its own side and `drop` below the shoulders, 2·halfW × 2·halfH big,
   * onto the whole screen. A hand lower than `lowered` below the shoulders (≈ mid-chest; a hanging arm
   * is ≈ 1.1+) is resting: no cursor. The box bottom (drop + halfH) matches `lowered`.
   * `filter`: One Euro on the 0..1 screen point (Hz / s per unit / Hz). `dwellMs`: hover to select.
   */
  cursor: {
    offset: 0.6,
    drop: 0.1,
    halfW: 1.3,
    halfH: 0.7,
    lowered: 0.8,
    filter: { minCutoff: 1.5, beta: 5, dCutoff: 1.0 },
    dwellMs: 1000,
  },
  /** T-pose: wrists within wristYTol torsos of shoulder height and wristOut shoulders beyond the shoulders, held holdMs. */
  tPose: { holdMs: 1000, wristYTol: 0.25, wristOut: 0.5 },
};

export type GestureConfig = typeof gestureConfig;
