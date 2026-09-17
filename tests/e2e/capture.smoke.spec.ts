// PLAN-BOXING §11.1: the capture wizard end to end on the fake camera. ?capture=smoke is 2 steps of 1 s.
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/** Waits until the wizard shows `text`. */
const shows = (page: Page, text: string) =>
  expect(page.locator('.capture')).toContainText(text, { timeout: 15_000 });

test('capture wizard: 2 steps with Keep download one bundle of 2 takes', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?game=boxing&record=1&capture=smoke');
  // Frames flowing first, so the takes hold poses (the wizard itself never waits on detection).
  await expect
    .poll(() => page.evaluate(() => window.__game.getPoseStats()?.framesWithPose ?? 0), {
      timeout: 45_000,
    })
    .toBeGreaterThan(0);

  await shows(page, 'Start (K)');
  await page.keyboard.press('k');
  for (const step of ['A', 'B']) {
    await shows(page, `Smoke step ${step}`);
    // Punch events never come from pose in Boxing, so the clip can't add these. Countdown: no take.
    await page.evaluate(() => window.__game.inject({ type: 'PUNCH_LEFT' }));
    await shows(page, 'GO');
    await page.evaluate(() => window.__game.inject({ type: 'PUNCH_RIGHT' }));
    await shows(page, 'Keep (K)');
    if (step === 'A') await page.keyboard.press('k');
  }
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.capture button[data-key="k"]'),
  ]);
  expect(download.suggestedFilename()).toMatch(/^capture-smoke-.+\.json$/);
  const bundle = JSON.parse(await readFile((await download.path())!, 'utf8'));

  expect(bundle).toMatchObject({ kind: 'capture', script: 'smoke' });
  expect(bundle.takes).toHaveLength(2);
  bundle.takes.forEach((take: Record<string, unknown>, i: number) => {
    expect(take).toMatchObject({
      version: 1,
      model: 'full',
      step: ['a', 'b'][i],
      windowMs: [1000, 2000],
    });
    const types = (take['events'] as { type: string }[]).map((e) => e.type);
    expect(types).toContain('PUNCH_RIGHT');
    expect(types).not.toContain('PUNCH_LEFT');
    const frames = take['frames'] as { t: number }[];
    expect(frames.length).toBeGreaterThan(10);
    expect(frames.every((f) => f.t >= 0 && f.t <= 3000)).toBe(true);
  });
  expect(errors).toEqual([]);
});
