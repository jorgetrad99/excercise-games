// Kinect-style menu: a raised hand is a cursor; hovering a button for cursor.dwellMs selects it.
// TEMPORARY(synthetic-fixtures): synthetic poses fed through window.__game.injectPose.
import { expect, test, type Page } from '@playwright/test';
import { gestureConfig } from '../../src/pose/gestures.config';
import { syntheticPose } from '../../src/pose/testdata/synthetic';

/** Holds the right hand over the center of `selector` for `ms`, injecting frames at 30 fps. */
async function dwellOn(page: Page, selector: string, ms: number): Promise<void> {
  const box = (await page.locator(selector).boundingBox())!;
  const vp = page.viewportSize()!;
  const u = (box.x + box.width / 2) / vp.width;
  const v = (box.y + box.height / 2) / vp.height;
  // Invert hand-cursor's mapping for the synthetic body: shoulders at raw x 0.44/0.56, y 0.35, so
  // the shoulder width is 0.12 × aspect image heights.
  const { offset, drop, halfW, halfH } = gestureConfig.cursor;
  const width = 0.12 * (16 / 9); // image heights
  const dx = (u - 0.5) * 2 * halfW + offset;
  const dy = (v - 0.5) * 2 * halfH + drop;
  const pose = syntheticPose({}, 0, 0)!;
  pose[16] = { x: 0.5 - (dx * width) / (16 / 9), y: 0.35 + dy * width, z: 0, visibility: 0.95 };
  await page.evaluate(
    async ({ pose, ms }) => {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        window.__game.injectPose({ t: performance.now(), poses: [pose] });
        await new Promise((r) => setTimeout(r, 33));
      }
    },
    { pose, ms },
  );
}

test('hovering "2" then Boxing with a raised hand launches a 2-player Boxing match', async ({
  page,
}) => {
  await page.goto('/?input=keyboard&seed=42');
  const dwell = gestureConfig.cursor.dwellMs;
  await dwellOn(page, '[data-players="2"]', dwell / 2); // too short: nothing selected
  await expect(page.locator('[data-players="2"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.menu .cursor:not([hidden])')).toHaveCount(1); // a centered body is P2 (x ≥ 0.5)
  await dwellOn(page, '[data-players="2"]', dwell + 300);
  await expect(page.locator('[data-players="2"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__game.getActiveGame())).toBeNull();
  await dwellOn(page, '[data-game="boxing"]', dwell + 300);
  expect(await page.evaluate(() => window.__game.getActiveGame())).toBe('boxing');
  expect(await page.evaluate(() => window.__game.getPlayerCount())).toBe(2);
});

test('hands down: no cursor; mouse still works', async ({ page }) => {
  await page.goto('/?input=keyboard&seed=42');
  const pose = syntheticPose({}, 0, 0)!;
  await page.evaluate(
    (pose) => window.__game.injectPose({ t: performance.now(), poses: [pose] }),
    pose,
  );
  await expect(page.locator('.menu .cursor:not([hidden])')).toHaveCount(0);
  await page.getByRole('button', { name: 'Skate Run' }).click();
  expect(await page.evaluate(() => window.__game.getActiveGame())).toBe('skate-run');
  expect(await page.evaluate(() => window.__game.getPlayerCount())).toBe(1);
});
