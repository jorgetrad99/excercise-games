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

test('capture wizard: practice mode steps through b1 demos without recording', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?game=boxing&record=1&capture=b1');
  await shows(page, 'Learn the moves (L)');
  await page.keyboard.press('l');
  await shows(page, 'Practice 1/6');
  const canvas = page.locator('.capture canvas');
  await expect(canvas).toBeVisible();
  // The figure is drawn: plenty of lit pixels.
  const lit = () =>
    canvas.evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]! > 200) n++;
      return n;
    });
  await expect.poll(lit).toBeGreaterThan(2000);
  for (let i = 0; i < 6; i++) await page.keyboard.press('n'); // clamps at the last step
  await shows(page, 'Practice 6/6');
  await shows(page, '1 left punch');
  await page.screenshot({ path: 'tmp/capture-demo/practice-6.png' });
  await page.keyboard.press('b');
  await shows(page, 'Practice 5/6');
  await shows(page, 'WITH twist');
  await page.keyboard.press('k');
  await shows(page, 'Step 1/6');
  await shows(page, 'Start (K)');
  await page.waitForTimeout(3500); // nothing counts down or downloads on its own
  await expect(page.locator('.capture')).toContainText('Start (K)');
  expect(errors).toEqual([]);
});
