// Gesture engine (PLAN §2.2): PoseFrame → SignalFrame + edge-triggered GestureEvents.
// Context-free on purpose: it doesn't know if a run is active. The sim ignores events that don't apply
// (e.g. REVIVE_ACCEPT mid-run), which keeps this module testable from pose data alone.
import { createBodyTracker, measure, type Measures, type VideoSize } from './body';
import { createCalibrator, type Calib, type CalibStatus } from './calibration';
import { gestureConfig, type GestureConfig } from './gestures.config';
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
  | 'TRACKING_RESTORED';

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
  tracking: 'ok' | 'lost';
  calibration: CalibStatus;
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
  if (!m || !calib) return { leanX: 0, hipRise: 0, hipRiseVel: 0, headDrop: 0 };
  const hipRise = (calib.hipY - m.hipCenter.y) / calib.torsoLen;
  return {
    // Calibrated (not live) scale: live shoulder width collapses when the player turns sideways.
    leanX: ((calib.shoulderX - m.shoulderCenter.x) * m.aspect) / calib.shoulderWidth,
    hipRise,
    hipRiseVel: velocity(d, t, hipRise, cfg.jump.velocityWindowMs),
    headDrop: m.nose ? (m.nose.y - calib.noseY) / calib.torsoLen : 0,
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

export function createGestureEngine({ video, config = gestureConfig }: GestureEngineOptions) {
  const track = createBodyTracker(config, video);
  const calibrator = createCalibrator(config);
  let d = initialDetectors();
  const tracking: Tracking = { state: 'lost', lastSeenT: -Infinity, everOk: false };
  const tPose = newHold();

  const reset = (emit: Emit): void => {
    calibrator.reset();
    if (d.sliding) emit('SLIDE_END'); // never leave the sim stuck sliding
    d = initialDetectors();
  };
  const trackingEvents = (t: number, seen: boolean, emit: Emit): void => {
    const change = updateTracking(tracking, t, seen, config.trackingLostMs);
    if (change === 'restored') emit('TRACKING_RESTORED');
    if (change !== 'lost') return;
    if (d.sliding) emit('SLIDE_END');
    d = { ...initialDetectors(), zone: d.zone };
    emit('TRACKING_LOST');
  };

  function push(frame: PoseFrame): { signals: SignalFrame; events: GestureEvent[] } {
    const events: GestureEvent[] = [];
    const emit: Emit = (type) => events.push({ t: frame.t, type });
    const { width, height } = video();
    const m = measure(track(frame), width / height, config);
    // Raw pose presence, not held landmarks: "no pose for 700 ms" shouldn't wait out the 300 ms hold too.
    trackingEvents(frame.t, frame.poses.length > 0 && m !== null, emit);
    if (heldFor(tPose, m?.tPose ?? false, frame.t, config.tPose.holdMs)) {
      reset(emit);
      emit('RECALIBRATE');
    }
    const wasCalibrated = calibrator.status().state === 'calibrated';
    const calibration = calibrator.update(frame.t, m);
    const calib = calibration.state === 'calibrated' ? calibration.calib : null;
    if (calib && !wasCalibrated) {
      // d.zone stays 1 (the sim's start lane): an off-center player gets catch-up LANE events next frame.
      emit('CALIBRATED');
    }
    const signals: SignalFrame = {
      t: frame.t,
      ...deriveSignals(frame.t, m, calib, d, config),
      armsUp: m?.armsUp ?? false,
      tPose: m?.tPose ?? false,
      zone: d.zone,
      tracking: tracking.state,
      calibration,
    };
    if (m && calib && wasCalibrated) detectAll(d, signals, m, config, emit);
    return { signals, events };
  }

  return {
    push,
    /** Call periodically: tracking can be lost with no frames arriving at all (worker restarting). */
    tick: (t: number) => collect(t, (emit) => trackingEvents(t, false, emit)),
    /** Keyboard `C`: forget calibration; the player stands still again. */
    recalibrate: (t: number) => collect(t, reset),
  };
}
