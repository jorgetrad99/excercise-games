import { expect, test } from '@playwright/test';
import type { SimState } from '../../src/core/types';

test('page boots, exposes window.__game and renders frames', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?game=skate-run&debug=1&input=keyboard&seed=42');
  await expect.poll(() => page.evaluate(() => typeof window.__game)).toBe('object');
  expect(await page.evaluate(() => window.__game.getState<SimState>().seed)).toBe(42);
  // Same startup budget as the other boot polls: the first frame compiles every shader (~1.7 s idle)
  // and the smoke workers all boot GPU pages at once (flaked 2/6 verify runs at the 5 s default).
  await expect
    .poll(() => page.evaluate(() => window.__game.getRenderStats()?.frames ?? 0), {
      timeout: 20_000,
    })
    .toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('without ?game the menu lists registered games and launches the chosen one', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?input=keyboard&seed=42');
  const pick = page.getByRole('button', { name: 'Skate Run' });
  await expect(pick).toBeVisible();
  expect(await page.evaluate(() => window.__game.getActiveGame())).toBeNull();
  expect(await page.evaluate(() => window.__game.getRenderStats())).toBeNull();

  await pick.click();
  await expect(pick).toBeHidden();
  expect(await page.evaluate(() => window.__game.getActiveGame())).toBe('skate-run');
  await expect
    .poll(() => page.evaluate(() => window.__game.getRenderStats()?.frames ?? 0))
    .toBeGreaterThan(10);
  expect(await page.evaluate(() => window.__game.getState<SimState>().phase)).not.toBe('over');
  expect(errors).toEqual([]);
});

test('MediaPipe wasm and pose model are vendored and served locally (run `pnpm vendor:models` if red)', async ({
  request,
}) => {
  for (const path of [
    '/models/pose_landmarker_full.task',
    '/models/wasm/vision_wasm_internal.wasm',
  ]) {
    // Size, not status: Vite's SPA fallback answers 200 + index.html for missing files.
    const size = Number((await request.head(path)).headers()['content-length']);
    expect(size, path).toBeGreaterThan(1_000_000);
  }
});
