// Gesture engine (PLAN §2.2): PoseFrame → SignalFrame + edge-triggered GestureEvents.
// Context-free on purpose: it doesn't know if a run is active. The sim ignores events that don't apply
// (e.g. REVIVE_ACCEPT mid-run), which keeps this module testable from pose data alone.
import { createBodyTracker, measure, type Measures, type VideoSize } from './body';
import { createCalibrator, type Calib, type CalibStatus } from './calibration';
import { detectGuard, newFists, trackFists } from './fists';
import { gestureConfig, type GestureConfig } from './gestures.config';
import { derivePoseState, type PoseState } from './pose-state';
import type { PoseFrame } from './types';

export type GestureEventType =
  | 'LANE_LEFT'
  | 'LANE_RIGHT'
  | 'JUMP'
  | 'SLIDE_START'
  | 'SLIDE_END'
  | 'GRAB'
  | 'REVIVE_ACCEPT'
  | 'RECALIBRATE'
  | 'CALIBRATED'
  | 'TRACKING_LOST'
  | 'TRACKING_RESTORED'
  | 'GUARD_START'
  | 'GUARD_END';

export interface GestureEvent {
  t: number;
  type: GestureEventType;
}

export interface SignalFrame {
  t: number;
  /** Shoulder-center offset from calibration in shoulder widths; negative = screen-left (mirrored). */
  leanX: number;
  /** Hip-center rise above calibration in torso lengths; positive = up. */
  hipRise: number;
  /** d(hipRise)/dt in torso lengths per second. */
  hipRiseVel: number;
  /** Nose drop below calibration in torso lengths; positive = down. */
  headDrop: number;
  armsUp: boolean;
  tPose: boolean;
  /** zones mode: 0 left, 1 center, 2 right (mirrored). */
  zone: number;
  /** Left / right wrist speed relative to the face, torso lengths/s (a signal; nothing gates on it). */
  fistL: number;
  fistR: number;
  /** Both wrists near the face (boxing guard, without the detector's hysteresis). */
  guard: boolean;
  /** Both knees tracked this frame (PLAN-BOXING BX-CAL-2: "step back so your knees are visible"). */
  knees: boolean;
  tracking: 'ok' | 'lost';
  calibration: CalibStatus;
  /** Continuous pose for mirroring onto a rig (pose/pose-state.ts); null until calibrated or while
   *  shoulders/hips are missing. */
  pose: PoseState | null;
}

type Emit = (type: GestureEventType) => void;

function initialDetectors() {
  return {
    leftArmed: true,
    rightArmed: true,
    zone: 1,
    lastJumpT: -Infinity,
    airborne: false,
    grabbed: false,
    sliding: false,
    slideSince: null as number | null,
    slideEndT: -Infinity,
    revive: { since: null, fired: false } as Hold,
    fists: newFists(),
    hist: [] as { t: number; v: number }[],
  };
}
type Detectors = ReturnType<typeof initialDetectors>;

function zoneOf(prev: number, mirroredX: number, h: number): number {
  const lo = 1 / 3 + (prev >= 1 ? -h : h);
  const hi = 2 / 3 + (prev >= 2 ? -h : h);
  return mirroredX < lo ? 0 : mirroredX < hi ? 1 : 2;
}

function velocity(d: Detectors, t: number, v: number, windowMs: number): number {
  let ref = d.hist[0];
  for (const s of d.hist) if (s.t <= t - windowMs) ref = s;
  d.hist.push({ t, v });
  while (d.hist.length > 0 && d.hist[0]!.t < t - windowMs * 4) d.hist.shift();
  return ref && t > ref.t ? ((v - ref.v) * 1000) / (t - ref.t) : 0;
}

function deriveSignals(
  t: number,
  m: Measures | null,
  calib: Calib | null,
  d: Detectors,
  cfg: GestureConfig,
) {
  if (!m || !calib)
    return { leanX: 0, hipRise: 0, hipRiseVel: 0, headDrop: 0, fistL: 0, fistR: 0, guard: false };
  const hipRise = (calib.hipY - m.hipCenter.y) / calib.torsoLen;
  return {
    // Calibrated (not live) scale: live shoulder width collapses when the player turns sideways.
    leanX: ((calib.shoulderX - m.shoulderCenter.x) * m.aspect) / calib.shoulderWidth,
    hipRise,
    hipRiseVel: velocity(d, t, hipRise, cfg.jump.velocityWindowMs),
    headDrop: m.nose ? (m.nose.y - calib.noseY) / calib.torsoLen : 0,
    ...trackFists(d.fists, t, m, calib.torsoLen, cfg),
  };
}

function detectLanes(
  d: Detectors,
  s: SignalFrame,
  m: Measures,
  cfg: GestureConfig,
  emit: Emit,
): void {
  if (cfg.laneMode === 'zones') {
    const zone = zoneOf(d.zone, 1 - m.shoulderCenter.x, cfg.zones.hysteresis);
    for (; d.zone > zone; d.zone--) emit('LANE_LEFT');
    for (; d.zone < zone; d.zone++) emit('LANE_RIGHT');
    return;
  }
  if (s.leanX < -cfg.lean.enter && d.leftArmed) {
    d.leftArmed = false;
    emit('LANE_LEFT');
  }
  if (s.leanX > cfg.lean.enter && d.rightArmed) {
    d.rightArmed = false;
    emit('LANE_RIGHT');
  }
  if (Math.abs(s.leanX) < cfg.lean.rearm) d.leftArmed = d.rightArmed = true;
}

function detectJumpAndGrab(d: Detectors, s: SignalFrame, cfg: GestureConfig, emit: Emit): void {
  const { jump } = cfg;
  if (d.airborne && (s.hipRise < jump.landRise || s.t - d.lastJumpT > jump.maxAirMs))
    d.airborne = false;
  if (
    !d.airborne &&
    s.t - d.lastJumpT >= jump.cooldownMs &&
    s.hipRise > jump.rise &&
    s.hipRiseVel > jump.velocity
  ) {
    d.lastJumpT = s.t;
    d.airborne = true;
    d.grabbed = false;
    emit('JUMP');
  }
  if (d.airborne && s.armsUp && !d.grabbed) {
    d.grabbed = true;
    emit('GRAB');
  }
}

function detectSlide(d: Detectors, s: SignalFrame, cfg: GestureConfig, emit: Emit): void {
  const { slide } = cfg;
  if (d.sliding) {
    if (s.headDrop < slide.exit) {
      d.sliding = false;
      d.slideEndT = s.t;
      emit('SLIDE_END');
    }
    return;
  }
  if (s.headDrop <= slide.enter) {
    d.slideSince = null;
    return;
  }
  d.slideSince ??= s.t;
  if (s.t - d.slideSince >= slide.holdMs && s.t - d.slideEndT >= slide.cooldownMs) {
    d.sliding = true;
    d.slideSince = null;
    emit('SLIDE_START');
  }
}

export interface GestureEngineOptions {
  video: () => VideoSize;
  config?: GestureConfig;
  /** False = recalibration (T-pose hold or keyboard C) is ignored right now (PLAN-BOXING BX-CAL-4). */
  canRecalibrate?: () => boolean;
}

/** A player's body scan (torso lengths): replaces the default bone lengths of the depth model. */
export interface ArmLengths {
  upperArm: number;
  forearm: number;
}

function detectAll(
  d: Detectors,
  s: SignalFrame,
  m: Measures,
  config: GestureConfig,
  emit: Emit,
): void {
  detectLanes(d, s, m, config, emit);
  detectJumpAndGrab(d, s, config, emit);
  detectSlide(d, s, config, emit);
  detectGuard(d.fists, config, emit);
  if (heldFor(d.revive, s.armsUp, s.t, config.reviveHoldMs)) emit('REVIVE_ACCEPT');
}

/** Runs `fn` with an emitter stamped at `t` and returns what it emitted. */
function collect(t: number, fn: (emit: Emit) => void): GestureEvent[] {
  const events: GestureEvent[] = [];
  fn((type) => events.push({ t, type }));
  return events;
}

interface Hold {
  since: number | null;
  fired: boolean;
}
const newHold = (): Hold => ({ since: null, fired: false });

/** True once when `active` has held for `ms`; re-arms when it goes inactive. */
function heldFor(h: Hold, active: boolean, t: number, ms: number): boolean {
  if (!active) {
    Object.assign(h, newHold());
    return false;
  }
  h.since ??= t;
  if (h.fired || t - h.since < ms) return false;
  return (h.fired = true);
}

interface Tracking {
  state: 'ok' | 'lost';
  lastSeenT: number;
  everOk: boolean;
}

function updateTracking(
  tr: Tracking,
  t: number,
  seen: boolean,
  lostMs: number,
): 'lost' | 'restored' | null {
  if (seen) {
    const restored = tr.state === 'lost' && tr.everOk;
    Object.assign(tr, { state: 'ok', lastSeenT: t, everOk: true });
    return restored ? 'restored' : null;
  }
  if (tr.state !== 'ok' || t - tr.lastSeenT <= lostMs) return null;
  tr.state = 'lost';
  return 'lost';
}

/** Tracking loss/restore events; returns the detectors (reset on loss, so nothing stays held). */
function trackingChange(
  tracking: Tracking,
  d: Detectors,
  t: number,
  seen: boolean,
  lostMs: number,
  emit: Emit,
): Detectors {
  const change = updateTracking(tracking, t, seen, lostMs);
  if (change === 'restored') emit('TRACKING_RESTORED');
  if (change !== 'lost') return d;
  if (d.sliding) emit('SLIDE_END');
  if (d.fists.guard) emit('GUARD_END');
  emit('TRACKING_LOST');
  return { ...initialDetectors(), zone: d.zone };
}

/** One calibration step; CALIBRATED on the frame it completes. */
function calibrate(
  calibrator: ReturnType<typeof createCalibrator>,
  t: number,
  m: Measures | null,
  emit: Emit,
) {
  const wasCalibrated = calibrator.status().state === 'calibrated';
  const calibration = calibrator.update(t, m);
  const calib = calibration.state === 'calibrated' ? calibration.calib : null;
  // d.zone stays 1 (the sim's start lane): an off-center player gets catch-up LANE events next frame.
  if (calib && !wasCalibrated) emit('CALIBRATED');
  return { calibration, calib, wasCalibrated };
}

export function createGestureEngine({
  video,
  config: base = gestureConfig,
  canRecalibrate = () => true,
}: GestureEngineOptions) {
  let config = base;
  const track = createBodyTracker(config, video);
  const calibrator = createCalibrator(config);
  let d = initialDetectors();
  const tracking: Tracking = { state: 'lost', lastSeenT: -Infinity, everOk: false };
  const tPose = newHold();
  const reset = (emit: Emit): void => {
    calibrator.reset();
    if (d.sliding) emit('SLIDE_END'); // never leave the sim stuck sliding
    if (d.fists.guard) emit('GUARD_END'); // …or guarding
    d = initialDetectors();
  };
  const trackingEvents = (t: number, seen: boolean, emit: Emit): void => {
    d = trackingChange(tracking, d, t, seen, config.trackingLostMs, emit);
  };
  function push(frame: PoseFrame): { signals: SignalFrame; events: GestureEvent[] } {
    const events: GestureEvent[] = [];
    const emit: Emit = (type) => events.push({ t: frame.t, type });
    const { width, height } = video();
    const body = track(frame);
    const m = measure(body, width / height, config);
    // Raw pose presence, not held landmarks: "no pose for 700 ms" shouldn't wait out the 300 ms hold too.
    trackingEvents(frame.t, frame.poses.length > 0 && m !== null, emit);
    if (heldFor(tPose, m?.tPose ?? false, frame.t, config.tPose.holdMs) && canRecalibrate()) {
      reset(emit);
      emit('RECALIBRATE');
    }
    const { calibration, calib, wasCalibrated } = calibrate(calibrator, frame.t, m, emit);
    const derived = deriveSignals(frame.t, m, calib, d, config);
    const signals: SignalFrame = {
      t: frame.t,
      ...derived,
      armsUp: m?.armsUp ?? false,
      tPose: m?.tPose ?? false,
      knees: m?.knees != null,
      zone: d.zone,
      tracking: tracking.state,
      calibration,
      pose:
        m && calib ? derivePoseState({ t: frame.t, body, m, calib, signals: derived, cfg: config }) : null,
    };
    if (m && calib && wasCalibrated) detectAll(d, signals, m, config, emit);
    return { signals, events };
  }
  return {
    push,
    /** Call periodically: tracking can be lost with no frames arriving at all (worker restarting). */
    tick: (t: number) => collect(t, (emit) => trackingEvents(t, false, emit)),
    /** Keyboard `C`: forget calibration; the player stands still again (unless the game forbids it now). */
    recalibrate: (t: number) => collect(t, (emit) => canRecalibrate() && reset(emit)),
    /** Use this player's scanned arm lengths (null = the defaults) for depth reconstruction. */
    setArms(arms: ArmLengths | null): void {
      config = { ...config, pose: { ...config.pose, ...(arms ?? base.pose) } };
    },
  };
}
