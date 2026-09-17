import { expect, test, type Page } from '@playwright/test';
import { CALIBRATE, fixture, script, type Key } from '../../src/pose/testdata/synthetic';
import { recordGate } from './gates';

// End-to-end body latency, camera frame → rendered glove, reported on every verify run (not gated yet:
// the budget gets set from these numbers). Two measured halves, because no single source has both:
//  1. pipeline: fake camera → landmarks on the main thread (FrameTiming, per frame), live worker;
//  2. rig response: a pose step arriving → the rendered glove covering 90 % of its final move
//     (replayed synthetic step, sampled every animation frame from the drawn rig).
// Total ≈ (1) p50 + (2); display scan-out and camera exposure are outside what software can see.

const rigResponseKeys: Key[] = [
  CALIBRATE,
  { ms: 1200, to: {} }, // intro starts: the step happens before the fight, on the live path only
  { ms: 34, to: { punchR: 1 } }, // one frame: a step, so easing/extrapolation shows directly
  { ms: 1500, to: { punchR: 1 } },
];

async function pipeline(page: Page, url: string, players: number) {
  await page.goto(url);
  await expect
    .poll(() => page.evaluate(() => window.__game.getPoseStats()?.framesWithPose ?? 0), {
      timeout: 45_000,
    })
    .toBeGreaterThan(30);
  await page.waitForTimeout(6_000);
  const l = await page.evaluate(() => window.__game.getLatency().pipeline);
  const poseFps = await page.evaluate(() => window.__game.getPoseStats()?.poseFps ?? 0);
  return { players, captureToResult: l.captureToResult, infer: l.infer, poseFps };
}

/** Samples drawn right-glove position and the live reach signal once per animation frame. */
async function rigResponse(page: Page) {
  const fx = fixture(script(rigResponseKeys, { base: { fists: 'ready' } }));
  await page.route('**/fixtures/pose/latency-step.json', (r) => r.fulfill({ json: fx }));
  await page.goto('/?game=boxing&input=replay:latency-step.json&seed=42');
  return page.evaluate(
    () =>
      new Promise<{ t: number; reach: number; glove: number[] }[]>((resolve) => {
        const out: { t: number; reach: number; glove: number[] }[] = [];
        const tick = (t: number) => {
          const reach = window.__game.getSignals()?.pose?.arms[1]?.reach ?? NaN;
          const glove = window.__game.getRenderStats()?.rig?.[0]?.gloves[1];
          if (glove && Number.isFinite(reach)) out.push({ t, reach, glove });
          // Calibrated at ~2.5 s, step 1.2 s later, then 1.5 s held (the fight starts ~3 s after calibration).
          if (out.length > 0 && t - out[0]!.t > 2_400) return resolve(out);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** ms from the pose step reaching the main thread to the drawn glove covering 90 % of its move. */
function response(samples: { t: number; reach: number; glove: number[] }[]) {
  // Onset = the first frame whose live pose shows the step (reach moved half of its total change).
  const r0 = samples[0]!.reach;
  const r1 = samples.at(-1)!.reach;
  const onset = samples.findIndex((s) => Math.abs(s.reach - r0) > Math.abs(r1 - r0) / 2);
  if (onset < 1) return { ms: NaN, moveM: NaN };
  const before = samples[onset - 1]!.glove;
  const dist = (g: number[]) => Math.hypot(...g.map((v, i) => v - before[i]!));
  const tail = samples.slice(onset + 30, onset + 50); // settled, still before the fight starts
  const moveM = tail.reduce((a, s) => a + dist(s.glove), 0) / tail.length;
  const reached = samples.findIndex((s, i) => i >= onset && dist(s.glove) >= 0.9 * moveM);
  return { ms: samples[reached]!.t - samples[onset]!.t, moveM };
}

test.describe('latency', { tag: '@perf' }, () => {
  test('camera → rendered glove, 1P and 2P, reported per run', async ({ page }) => {
    test.setTimeout(150_000);
    const one = await pipeline(page, '/?game=boxing&input=pose&seed=42', 1);
    const two = await pipeline(page, '/?game=boxing&input=pose&players=2&seed=42', 2);
    const samples = await rigResponse(page);
    const rig = response(samples);
    const total = (p: typeof one) => p.captureToResult.p50 + rig.ms;
    recordGate(
      'latency-camera-to-glove',
      {
        pipeline1pP50: [one.captureToResult.p50],
        pipeline1pP95: [one.captureToResult.p95],
        pipeline2pP50: [two.captureToResult.p50],
        pipeline2pP95: [two.captureToResult.p95],
        rigResponse90: [rig.ms],
        rigMoveCm: [rig.moveM * 100],
        total1pP50: [total(one)],
        total2pP50: [total(two)],
        poseFps1p: [one.poseFps],
        poseFps2p: [two.poseFps],
      },
      { report: 'measured only; budget to be set from these values' },
    );
    expect(one.captureToResult.n).toBeGreaterThan(30);
    expect(two.captureToResult.n).toBeGreaterThan(30);
    expect(Number.isFinite(rig.ms)).toBe(true);
  });
});
