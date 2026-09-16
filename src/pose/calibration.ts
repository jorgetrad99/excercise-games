// Calibration state machine: waiting → calibrating (stand neutral & still) → calibrated. reset() starts over.
import type { Measures } from './body';
import type { GestureConfig } from './gestures.config';

/** Neutral stance captured at calibration. x/y are raw normalized image coords; lengths as in Measures. */
export interface Calib {
  shoulderX: number;
  hipY: number;
  noseY: number;
  torsoLen: number;
  shoulderWidth: number;
}

export type CalibStatus =
  | { state: 'waiting' }
  | { state: 'calibrating'; progress: number }
  | { state: 'calibrated'; calib: Calib };

export function createCalibrator(cfg: GestureConfig) {
  let status: CalibStatus = { state: 'waiting' };
  let anchor: { t: number; m: Measures } | null = null;

  const drift = (a: Measures, b: Measures): number =>
    Math.hypot(
      (a.shoulderCenter.x - b.shoulderCenter.x) * a.aspect,
      a.hipCenter.y - b.hipCenter.y,
    ) / a.torsoLen;

  return {
    status: (): CalibStatus => status,
    reset(): void {
      status = { state: 'waiting' };
      anchor = null;
    },
    update(t: number, m: Measures | null): CalibStatus {
      if (status.state === 'calibrated') return status;
      // Neutral = whole upper body visible, arms not raised.
      if (!m?.nose || m.armsUp || m.tPose) {
        anchor = null;
        return (status = { state: 'waiting' });
      }
      if (!anchor || drift(anchor.m, m) > cfg.calibration.maxDrift) anchor = { t, m };
      const progress = (t - anchor.t) / cfg.calibration.holdMs;
      if (progress < 1) return (status = { state: 'calibrating', progress });
      const calib = {
        shoulderX: m.shoulderCenter.x,
        hipY: m.hipCenter.y,
        noseY: m.nose.y,
        torsoLen: m.torsoLen,
        shoulderWidth: m.shoulderWidth,
      };
      return (status = { state: 'calibrated', calib });
    },
  };
}
