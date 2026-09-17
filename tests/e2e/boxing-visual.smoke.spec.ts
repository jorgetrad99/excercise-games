import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const ROOT = 'tmp/visual-expressiveness';
async function harness(page: Page) {
  await page.goto('/?input=keyboard');
  await page.evaluate(async () => {
    const path = '/tests/e2e/boxing-visual-harness.ts';
    const module = (await import(
      /* @vite-ignore */ path
    )) as typeof import('./boxing-visual-harness');
    window.__boxingVisual = await module.createVisualHarness();
  });
}
test.use({ viewport: { width: 960, height: 720 } });

test('replacement head, rig following, clean-hit damage, fall and count recovery', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'warning' && /THREE/.test(m.text())) errors.push(m.text());
  });
  await harness(page);
  const neutral = await page.evaluate(() => window.__boxingVisual.inspect());
  expect(neutral.originalVisible).toBe(false);
  expect(neutral.size[0]).toBeGreaterThan(0.55);
  expect(neutral.size[1]).toBeGreaterThan(0.65);
  await page.screenshot({ path: `${ROOT}/head-neutral.png` });
  await page.evaluate(() => window.__boxingVisual.step(0.2, [{ type: 'DODGE_LEFT', player: 1 }]));
  const sway = await page.evaluate(() => window.__boxingVisual.inspect());
  expect(sway.center[0]! - neutral.center[0]!).toBeGreaterThan(0.2);
  await page.screenshot({ path: `${ROOT}/head-sway.png` });
  await page.evaluate(() => {
    window.__boxingVisual.step(0.8);
    window.__boxingVisual.step(0.2, [{ type: 'DUCK', player: 1 }]);
  });
  const duck = await page.evaluate(() => window.__boxingVisual.inspect());
  expect(neutral.center[1]! - duck.center[1]!).toBeGreaterThan(0.3);
  await page.screenshot({ path: `${ROOT}/head-duck.png` });
  await page.evaluate(() => {
    window.__boxingVisual.restart();
    window.__boxingVisual.step(0.3, [{ type: 'PUNCH_RIGHT', aim: { x: 1, y: 0 } }]);
  });
  const hit = await page.evaluate(() => window.__boxingVisual.inspect());
  expect(hit.rotation).not.toEqual(neutral.rotation);
  expect(hit.facePixels).not.toEqual(neutral.facePixels);
  expect(hit.sourcePixels).toEqual(neutral.sourcePixels);
  await page.screenshot({ path: `${ROOT}/head-hit.png` });
  // Accumulate real punches until zero stamina, then another hit starts the referee count.
  await page.evaluate(() => {
    const h = window.__boxingVisual;
    for (let i = 0; i < 20 && !h.state().boxers[1].dizzy; i++)
      h.step(0.5, [
        { type: i % 2 ? 'PUNCH_LEFT' : 'PUNCH_RIGHT', aim: { x: i % 2 ? -1 : 1, y: 0 } },
      ]);
  });
  await page.screenshot({ path: `${ROOT}/knockdown-fall.png` });
  await page.evaluate(() => window.__boxingVisual.step(0.5, [{ type: 'PUNCH_RIGHT' }]));
  const count = await page.evaluate(() => window.__boxingVisual.state().down);
  expect(count).not.toBeNull();
  expect(count!.getUpAt).toBeLessThan(10);
  await page.evaluate(() => window.__boxingVisual.step(0.6));
  const down = await page.evaluate(() => window.__boxingVisual.inspect());
  expect(down.center[1]!).toBeLessThan(neutral.center[1]! - 0.5);
  await page.screenshot({ path: `${ROOT}/knockdown-floor.png` });
  await page.evaluate(() => {
    const h = window.__boxingVisual,
      s = h.state();
    h.step(s.down!.getUpAt * 0.8 - s.phaseT - 0.4);
  });
  await page.screenshot({ path: `${ROOT}/count-get-up.png` });
  await page.evaluate(() => window.__boxingVisual.step(0.5));
  expect(await page.evaluate(() => window.__boxingVisual.state().phase)).toBe('fight');
  const up = await page.evaluate(() => window.__boxingVisual.inspect());
  expect(up.center[1]!).toBeGreaterThan(neutral.center[1]! - 0.1);
  await page.screenshot({ path: `${ROOT}/count-recovered-damage.png` });
  await page.evaluate(() => window.__boxingVisual.restart());
  expect((await page.evaluate(() => window.__boxingVisual.inspect())).facePixels).toEqual(
    neutral.facePixels,
  );
  expect(errors).toEqual([]);
});

test('same-tick redraws are stable; live head rotation composes and clears', async ({ page }) => {
  await harness(page);
  await page.evaluate(() => window.__boxingVisual.step(0.3, [{ type: 'PUNCH_RIGHT' }]));
  const first = await page.evaluate(() => window.__boxingVisual.inspect());
  await page.evaluate(() => {
    for (let i = 0; i < 50; i++) window.__boxingVisual.render();
  });
  const stable = await page.evaluate(() => window.__boxingVisual.inspect());
  for (const key of ['center', 'rotation', 'size'] as const)
    stable[key].forEach((n, i) => expect(n).toBeCloseTo(first[key][i]!, 10));
  expect(stable.facePixels).toEqual(first.facePixels);
  await page.evaluate(() =>
    window.__boxingVisual.live({ rotations: { head: [0, 0.258819, 0, 0.965926] } }),
  );
  expect((await page.evaluate(() => window.__boxingVisual.inspect())).rotation).not.toEqual(
    first.rotation,
  );
  await page.evaluate(() => window.__boxingVisual.live(null));
  const cleared = await page.evaluate(() => window.__boxingVisual.inspect());
  cleared.rotation.forEach((n, i) => expect(n).toBeCloseTo(first.rotation[i]!, 10));
});

test(
  'live fake-camera face reaches Boxing at 1080p with pose and render performance intact',
  { tag: '@perf' },
  async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const errors: string[] = [];
    let crops = 0;
    page.on('console', (m) => {
      if (m.text().startsWith('FACEDBG')) crops++;
      if (m.type() === 'error' || (m.type() === 'warning' && /THREE/.test(m.text())))
        errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?game=boxing&input=pose&seed=42&clock=manual');
    await expect.poll(() => crops, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.keyboard.press('Space');
    await page.evaluate(() => window.__game.advance(3.1));
    await expect
      .poll(() => page.evaluate(() => window.__game.getFps()), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(55);
    const samples = [];
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(1000);
      samples.push(
        await page.evaluate(() => ({
          fps: window.__game.getFps(),
          pose: window.__game.getPoseStats(),
          render: window.__game.getRenderStats(),
        })),
      );
    }
    await mkdir(ROOT, { recursive: true });
    await writeFile(`${ROOT}/live-face-performance.json`, JSON.stringify(samples, null, 2));
    for (const sample of samples) {
      expect(sample.fps).toBeGreaterThanOrEqual(55);
      expect(sample.pose!.poseFps).toBeGreaterThanOrEqual(20);
      expect(sample.pose!.lastPoseCount).toBeGreaterThan(0);
      expect(sample.render!.calls).toBeLessThan(150);
    }
    await page.screenshot({ path: `${ROOT}/live-webcam-face.png` });
    await page.evaluate(() => {
      window.__game.advance(3.1);
      window.__game.inject({ type: 'DODGE_LEFT', player: 1 });
      window.__game.advance(0.2);
    });
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    await page.screenshot({ path: `${ROOT}/live-webcam-sway.png` });
    for (let i = 0; i < 6; i++) {
      await page.evaluate((i) => {
        window.__game.inject({
          type: i % 2 ? 'PUNCH_LEFT' : 'PUNCH_RIGHT',
          aim: { x: i % 2 ? -0.8 : 0.8, y: 0 },
        });
        window.__game.advance(0.5);
      }, i);
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
    }
    await page.screenshot({ path: `${ROOT}/live-webcam-damage.png` });
    expect(errors).toEqual([]);
  },
);
