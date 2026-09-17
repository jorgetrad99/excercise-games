// TEMPORARY(synthetic-fixtures). PLAN-BOXING BX-CAL-2 (knees signal), BX-CAL-4 (recalibration gate),
// BX-CAL-6 (scanned arm lengths feed the depth model).
import { describe, expect, it } from 'vitest';
import { createGestureEngine } from './gestures';
import { CALIBRATE, script } from './testdata/synthetic';

const video = () => ({ width: 1280, height: 720 });
const TPOSE = [
  CALIBRATE,
  { ms: 100, to: { tPose: true } },
  { ms: 1200, to: { tPose: true } },
];

describe('gesture engine calibration hooks', () => {
  it('BX-CAL-4: a closed gate ignores the T-pose hold and keyboard C; an open one recalibrates', () => {
    let open = false;
    const engine = createGestureEngine({ video, canRecalibrate: () => open });
    const types = script(TPOSE).flatMap((f) => engine.push(f).events.map((e) => e.type));
    expect(types).toEqual(['CALIBRATED']);
    expect(engine.recalibrate(5000)).toEqual([]);
    open = true;
    expect(engine.recalibrate(5100).map((e) => e.type)).toEqual([]); // reset only: no event of its own
    expect(engine.push(script([{ ms: 40, to: {} }])[0]!).signals.calibration.state).not.toBe('calibrated');
  });

  it('BX-CAL-2: the knees signal follows whether both knees are tracked', () => {
    // A fresh engine per case: a lost landmark is deliberately held for holdLandmarkMs.
    const [seen, hidden] = [{}, { kneesHidden: true }].map(
      (to) => createGestureEngine({ video }).push(script([{ ms: 40, to }])[0]!).signals.knees,
    );
    expect([seen, hidden]).toEqual([true, false]);
  });

  it('BX-CAL-6: scanned arm lengths change the reconstructed reach of the same frames', () => {
    const frames = script([CALIBRATE, { ms: 300, to: {} }, { ms: 300, to: { punchR: 0.5 } }], {
      base: { fists: 'guard' },
      jitter: 0,
    });
    const reach = (arms: { upperArm: number; forearm: number } | null) => {
      const engine = createGestureEngine({ video });
      engine.setArms(arms);
      return frames.map((f) => engine.push(f).signals.pose).at(-1)!.arms[1]!.wrist.z;
    };
    const short = reach({ upperArm: 0.45, forearm: 0.43 });
    const long = reach({ upperArm: 0.6, forearm: 0.58 });
    expect(long).toBeGreaterThan(short + 0.1); // longer bones: the same 2D arm points more at the camera
    expect(reach(null)).toBeCloseTo(reach({ upperArm: 0.5, forearm: 0.48 }), 9); // null = defaults
  });
});
