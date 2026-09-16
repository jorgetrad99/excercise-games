// On-demand: live input-to-screen latency by stage on THIS machine (pnpm latency:pipeline, LABEL=...).
// Fake camera (placeholder clip) → worker → gesture engine; the bot keeps the run alive so the render
// path is realistic; ArrowUp presses (GRAB: harmless) measure the key → sim → render path.
// Writes tmp/latency/pipeline-<LABEL>.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const LABEL = process.env.LABEL ?? 'current';

test.use({ viewport: { width: 1920, height: 1080 } });

test('pipeline latency by stage', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?game=skate-run&input=pose&autoplay=1&latency=1&seed=42&tokens=99');
  await expect
    .poll(() => page.evaluate(() => window.__game.getPoseStats()?.framesWithPose ?? 0), {
      timeout: 45_000,
    })
    .toBeGreaterThan(0);
  await page.keyboard.press('ArrowUp'); // opens the calibration gate (keyboard fallback)
  await page.waitForTimeout(2_000);
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(250);
  }
  const summary = await page.evaluate(() => window.__game.getLatency());
  const poseStats = await page.evaluate(() => window.__game.getPoseStats());
  mkdirSync('tmp/latency', { recursive: true });
  writeFileSync(
    `tmp/latency/pipeline-${LABEL}.json`,
    JSON.stringify({ label: LABEL, summary, poseStats }, null, 2),
  );
  await page.screenshot({ path: `tmp/latency/overlay-${LABEL}.png` });
  console.log(JSON.stringify(summary, null, 1));
  expect(summary.pipeline.workerRoundTrip.n).toBeGreaterThan(50);
  expect(summary.keyEvents.inputToNextFrame.n).toBeGreaterThan(30);
});
