import { describe, expect, it } from 'vitest';
import type { Measures } from './body';
import { createCalibrator } from './calibration';
import { gestureConfig } from './gestures.config';

const measures = (dx: number): Measures => ({
  shoulderCenter: { x: 0.5 + dx, y: 0.35 },
  hipCenter: { x: 0.5, y: 0.65 },
  nose: { x: 0.5, y: 0.25 },
  torsoLen: 0.3,
  shoulderWidth: 0.2,
  aspect: 1,
  armsUp: false,
  tPose: false,
});

describe('calibrator', () => {
  it('calibrates a still player whose frames jitter more than maxDrift apart (drift vs window mean)', () => {
    // ±0.6·maxDrift around the mean: consecutive frames differ by 1.2·maxDrift.
    const amp = 0.6 * gestureConfig.calibration.maxDrift * 0.3;
    const cal = createCalibrator(gestureConfig);
    let state = '';
    for (let t = 0; t <= 2100; t += 33)
      state = cal.update(t, measures(t % 66 === 0 ? amp : -amp)).state;
    expect(state).toBe('calibrated');
    const calib =
      cal.status().state === 'calibrated'
        ? (cal.status() as { calib: { shoulderX: number } }).calib
        : null;
    expect(calib!.shoulderX).toBeCloseTo(0.5, 2); // the mean, not a noisy single frame
  });

  it('restarts the hold when the player actually moves', () => {
    const cal = createCalibrator(gestureConfig);
    for (let t = 0; t < 1500; t += 33) cal.update(t, measures(0));
    const s = cal.update(1500, measures(0.1));
    expect(s).toEqual({ state: 'calibrating', progress: 0 });
  });
});
