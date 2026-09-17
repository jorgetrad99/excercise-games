import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { recordGate } from './gates';

// M1 DoD shape: fake camera → worker PoseLandmarker → ≥ 1 pose at ≥ 20 pose-fps for 5 s.
// Runs on the INTERIM placeholder clip, not Jorge's recorded fixture (see docs/PROGRESS.md).
const stats = (page: Page) =>
  page.evaluate(() => ({ now: performance.now(), s: window.__game.getPoseStats() }));

test(
  'fake camera clip is tracked by the worker pipeline at >= 20 pose-fps for 5 s',
  { tag: '@perf' },
  async ({ page }) => {
    test.setTimeout(90_000);
    const logs: string[] = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

    await page.goto('/?game=skate-run&input=pose&debug=1&record=1');
    try {
      await expect
        .poll(async () => (await stats(page)).s?.framesWithPose ?? 0, { timeout: 45_000 })
        .toBeGreaterThan(0);
    } catch (err) {
      console.log(logs.join('\n')); // worker/MediaPipe console is the only clue when init fails
      throw err;
    }

    const a = await stats(page);
    await page.waitForTimeout(5_000);
    const b = await stats(page);
    const seconds = (b.now - a.now) / 1000;
    const processed = b.s!.framesProcessed - a.s!.framesProcessed;
    const withPose = b.s!.framesWithPose - a.s!.framesWithPose;
    const summary = {
      poseFps: processed / seconds,
      withPose,
      processed,
      delegate: b.s!.delegate,
      video: b.s!.video,
      cameraFps: b.s!.cameraFps,
      inferMs: b.s!.inferMs,
    };
    console.log('pose e2e', JSON.stringify(summary));
    recordGate(
      'pose-1p-5s',
      { poseFps: [summary.poseFps], withPoseRatio: [withPose / processed] },
      { poseFps: '>= 20', withPoseRatio: '> 0.9' },
    );
    await page.screenshot({ path: 'tmp/e2e/pose-smoke.png' });

    expect(b.s!.video).toEqual({ width: 1280, height: 720 });
    expect(summary.poseFps).toBeGreaterThanOrEqual(20);
    expect(withPose / processed).toBeGreaterThan(0.9); // the person is in every frame of the clip
    expect(b.s!.restarts).toBe(0);

    // ?record=1: the download is a fixture with rebased time and 33 landmarks per pose.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('button.download'),
    ]);
    const fixture = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(fixture).toMatchObject({
      version: 1,
      model: 'full',
      video: { width: 1280, height: 720 },
    });
    expect(fixture.frames.length).toBeGreaterThan(100);
    expect(fixture.frames[0].t).toBe(0);
    expect(fixture.frames[0].poses[0]).toHaveLength(33);

    expect(logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'))).toEqual([]);
  },
);
