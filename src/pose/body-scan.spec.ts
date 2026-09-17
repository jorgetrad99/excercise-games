// TEMPORARY(synthetic-fixtures): synthetic T-pose. PLAN-BOXING BX-CAL-6.
import { describe, expect, it } from 'vitest';
import { createBodyScan, SCAN_HOLD_MS, type ScanStatus } from './body-scan';
import { gestureConfig } from './gestures.config';
import { CALIBRATE, script, type Key } from './testdata/synthetic';

const video = () => ({ width: 1280, height: 720 });
const ASPECT = 16 / 9;
/** Synthetic geometry (testdata/synthetic.ts): shoulders at y .35 ±.06 x, hips y .65, T-pose elbows at
 *  x ±.18 and wrists ±.30 from the centre: torso .30 image heights. */
const TORSO = 0.3;
const EXPECTED = {
  upperArm: ((0.68 - 0.56) * ASPECT) / TORSO,
  forearm: ((0.8 - 0.68) * ASPECT) / TORSO,
  shoulderWidth: (0.12 * ASPECT) / TORSO,
};

function run(keys: Key[]): ScanStatus[] {
  const scan = createBodyScan(gestureConfig, video);
  return script(keys, { jitter: 0.001 }).map((f) => scan(f));
}

describe('body scan (BX-CAL-6)', () => {
  it('stand still, then hold a T-pose: measures arm lengths in torso lengths (±3 %)', () => {
    const out = run([
      CALIBRATE,
      { ms: 200, to: { tPose: true } },
      { ms: SCAN_HOLD_MS + 300, to: { tPose: true } },
    ]);
    expect(out[10]!.step).toBe('stand');
    const done = out.at(-1)!;
    expect(done.step).toBe('done');
    if (done.step !== 'done') return;
    for (const k of ['upperArm', 'forearm', 'shoulderWidth'] as const)
      expect(done.scan[k] / EXPECTED[k]).toBeCloseTo(1, 1.5);
  });

  it('the T-pose hold must be continuous: dropping the arms restarts it', () => {
    const out = run([
      CALIBRATE,
      { ms: 200, to: { tPose: true } },
      { ms: SCAN_HOLD_MS - 500, to: { tPose: true } },
      { ms: 300, to: {} },
      { ms: 1000, to: { tPose: true } },
    ]);
    expect(out.at(-1)!.step).toBe('tpose');
    expect(out.some((s) => s.step === 'done')).toBe(false);
  });
});
