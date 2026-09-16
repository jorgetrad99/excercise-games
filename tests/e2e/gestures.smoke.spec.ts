import { expect, test } from '@playwright/test';
import { CALIBRATE, JUMP, fixture, script } from '../../src/pose/testdata/synthetic';

test('keyboard input and inject() land in the event log', async ({ page }) => {
  await page.goto('/?input=keyboard&debug=1');
  await expect.poll(() => page.evaluate(() => typeof window.__game?.getEvents)).toBe('function');
  for (const k of ['ArrowLeft', 'ArrowRight', 'Space']) await page.keyboard.press(k);
  await page.keyboard.down('ArrowDown');
  await page.keyboard.up('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('c');
  await page.evaluate(() => window.__game.inject({ type: 'REVIVE' }));
  const types = await page.evaluate(() => window.__game.getEvents().map((e) => e.type));
  expect(types).toEqual([
    'LANE_LEFT',
    'LANE_RIGHT',
    'JUMP',
    'SLIDE_START',
    'SLIDE_END',
    'GRAB',
    'RECALIBRATE',
    'REVIVE',
  ]);
});

// TEMPORARY(synthetic-fixtures): serves a synthetic fixture as fixtures/pose/*.json; switch the route
// off and point ?input=replay: at Jorge's recording once it exists.
test('replay input drives the gesture engine end to end, HUD shows live signals', async ({
  page,
}) => {
  const fx = fixture(
    script([CALIBRATE, { ms: 300, to: { lean: -0.06 } }, { ms: 600, to: {} }, ...JUMP]),
  );
  await page.route('**/fixtures/pose/synthetic-lean-jump.json', (route) =>
    route.fulfill({ json: fx }),
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?input=replay:synthetic-lean-jump.json&debug=1');
  await expect
    .poll(() => page.evaluate(() => window.__game.getEvents().map((e) => e.type)), {
      timeout: 15_000,
    })
    .toEqual(['LANE_LEFT', 'JUMP']);
  const signals = await page.evaluate(() => window.__game.getSignals());
  expect(signals?.calibration.state).toBe('calibrated');
  expect(signals?.tracking).toBe('ok');
  await page.locator('canvas.signal-hud').screenshot({ path: 'tmp/e2e/signal-hud.png' });
  expect(errors).toEqual([]);
});
