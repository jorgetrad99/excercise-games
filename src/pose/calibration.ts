// Calibration state machine: waiting → calibrating (stand neutral & still) → calibrated. reset() starts over.
import type { Measures } from './body';
import type { GestureConfig } from './gestures.config';

/** Neutral stance captured at calibration. x/y are raw normalized image coords; lengths as in Measures. */
export interface Calib {
  shoulderX: number;
  /** Hip centre x: the room centre for positional movement (PLAN-BOXING BX-CAL-1, §7). */
  hipX: number;
  hipY: number;
  noseY: number;
  torsoLen: number;
  shoulderWidth: number;
  /** Knee y [left, right] when both knees were tracked through the hold (march reference), else null. */
  kneeY: [number, number] | null;
}

export type CalibStatus =
  | { state: 'waiting' }
  | { state: 'calibrating'; progress: number }
  | { state: 'calibrated'; calib: Calib };

/** Running mean of the measures since the hold started: calibration's own smoothing. */
interface Window {
  t: number;
  n: number;
  sum: Omit<Calib, 'kneeY'>;
  /** Knee y sums; null once a frame in the hold lacked either knee. */
  knees: [number, number] | null;
}

const toCalib = (w: Window): Calib => ({
  shoulderX: w.sum.shoulderX / w.n,
  hipX: w.sum.hipX / w.n,
  hipY: w.sum.hipY / w.n,
  noseY: w.sum.noseY / w.n,
  torsoLen: w.sum.torsoLen / w.n,
  shoulderWidth: w.sum.shoulderWidth / w.n,
  kneeY: w.knees ? [w.knees[0] / w.n, w.knees[1] / w.n] : null,
});

function add(w: Window, m: Measures): void {
  w.n++;
  w.sum.shoulderX += m.shoulderCenter.x;
  w.sum.hipX += m.hipCenter.x;
  w.sum.hipY += m.hipCenter.y;
  w.sum.noseY += m.nose!.y;
  w.sum.torsoLen += m.torsoLen;
  w.sum.shoulderWidth += m.shoulderWidth;
  w.knees = w.knees && m.knees ? [w.knees[0] + m.knees[0].y, w.knees[1] + m.knees[1].y] : null;
}

const empty = (t: number): Window => ({
  t,
  n: 0,
  knees: [0, 0],
  sum: { shoulderX: 0, hipX: 0, hipY: 0, noseY: 0, torsoLen: 0, shoulderWidth: 0 },
});

export function createCalibrator(cfg: GestureConfig) {
  let status: CalibStatus = { state: 'waiting' };
  let win: Window | null = null;

  // Drift is measured against the window's MEAN, not its first frame: gestures now use a low-lag
  // filter, and a single noisy anchor frame would keep restarting the hold for a still player.
  const drift = (w: Window, m: Measures): number => {
    const c = toCalib(w);
    return (
      Math.hypot((c.shoulderX - m.shoulderCenter.x) * m.aspect, c.hipY - m.hipCenter.y) / c.torsoLen
    );
  };

  return {
    status: (): CalibStatus => status,
    reset(): void {
      status = { state: 'waiting' };
      win = null;
    },
    update(t: number, m: Measures | null): CalibStatus {
      if (status.state === 'calibrated') return status;
      // Neutral = whole upper body visible, arms not raised.
      if (!m?.nose || m.armsUp || m.tPose) {
        win = null;
        return (status = { state: 'waiting' });
      }
      win ??= empty(t);
      add(win, m); // the frame is part of the mean it's compared with
      if (drift(win, m) > cfg.calibration.maxDrift) {
        win = empty(t);
        add(win, m);
      }
      const progress = (t - win.t) / cfg.calibration.holdMs;
      if (progress < 1) return (status = { state: 'calibrating', progress });
      return (status = { state: 'calibrated', calib: toCalib(win) });
    },
  };
}
