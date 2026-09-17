// Body scan (PLAN-BOXING BX-CAL-6): stand still (the normal calibration), then hold a T-pose. With the
// arms straight out to the sides they lie in the image plane, so their 2D lengths are their true
// lengths: upper arm and forearm in calibrated torso lengths, averaged over both arms and the hold.
// These replace the default bone lengths in the depth model (pose-state.ts) and normalise reach.
import { createBodyTracker, measure, type Point, type VideoSize } from './body';
import { createCalibrator } from './calibration';
import type { GestureConfig } from './gestures.config';
import type { PoseFrame } from './types';

export interface ArmScan {
  upperArm: number;
  forearm: number;
  shoulderWidth: number;
}

export type ScanStatus =
  | { step: 'stand'; progress: number }
  | { step: 'tpose'; progress: number }
  | { step: 'done'; scan: ArmScan };

/** How long the T-pose must be held, ms. */
export const SCAN_HOLD_MS = 2000;

export function createBodyScan(config: GestureConfig, video: () => VideoSize) {
  const track = createBodyTracker(config, video);
  const calibrator = createCalibrator(config);
  let sum: (ArmScan & { n: number; since: number }) | null = null;
  let status: ScanStatus = { step: 'stand', progress: 0 };

  return (frame: PoseFrame): ScanStatus => {
    if (status.step === 'done') return status;
    const { width, height } = video();
    const aspect = width / height;
    const body = track(frame);
    const m = measure(body, aspect, config);
    const cal = calibrator.update(frame.t, m);
    if (cal.state !== 'calibrated') {
      return (status = { step: 'stand', progress: cal.state === 'calibrating' ? cal.progress : 0 });
    }
    const { lShoulder, rShoulder, lElbow, rElbow, lWrist, rWrist } = body;
    const len = (a: Point | null, b: Point | null) =>
      a && b ? Math.hypot((a.x - b.x) * aspect, a.y - b.y) / cal.calib.torsoLen : null;
    const upper = [len(lShoulder, lElbow), len(rShoulder, rElbow)];
    const fore = [len(lElbow, lWrist), len(rElbow, rWrist)];
    if (!m?.tPose || [...upper, ...fore].some((v) => v === null)) {
      sum = null; // the hold has to be continuous
      return (status = { step: 'tpose', progress: 0 });
    }
    sum ??= { upperArm: 0, forearm: 0, shoulderWidth: 0, n: 0, since: frame.t };
    sum.upperArm += (upper[0]! + upper[1]!) / 2;
    sum.forearm += (fore[0]! + fore[1]!) / 2;
    sum.shoulderWidth += m.shoulderWidth / cal.calib.torsoLen;
    sum.n++;
    const progress = (frame.t - sum.since) / SCAN_HOLD_MS;
    if (progress < 1) return (status = { step: 'tpose', progress });
    const { n } = sum;
    return (status = {
      step: 'done',
      scan: {
        upperArm: sum.upperArm / n,
        forearm: sum.forearm / n,
        shoulderWidth: sum.shoulderWidth / n,
      },
    });
  };
}
