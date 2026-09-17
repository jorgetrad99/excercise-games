// Kinect-style menu: a raised hand is a cursor; hovering a button for cursor.dwellMs selects it.
// TEMPORARY(synthetic-fixtures): synthetic poses fed through window.__game.injectPose.
import { expect, test, type Page } from '@playwright/test';
import { gestureConfig } from '../../src/pose/gestures.config';
import { syntheticPose } from '../../src/pose/testdata/synthetic';
import type { Landmark } from '../../src/pose/types';

const ASPECT = 16 / 9;
/** Where the synthetic bodies stand: screen-left body = P1, screen-right = P2 (mirrored view). */
const BODY = { center: {}, left: { walk: -0.3, scale: 0.7 }, right: { walk: 0.3, scale: 0.7 } };
type Body = keyof typeof BODY;

/** `body` with its right hand raised over the center of `selector` (null = hands down). */
async function bodyPose(page: Page, body: Body, selector: string | null): Promise<Landmark[]> {
  const pose = syntheticPose(BODY[body], 0, 0)!;
  if (!selector) return pose;
  const box = (await page.locator(selector).boundingBox())!;
  const vp = page.viewportSize()!;
  const u = (box.x + box.width / 2) / vp.width;
  const v = (box.y + box.height / 2) / vp.height;
  // Invert hand-cursor's mapping from this body's own shoulders.
  const [ls, rs] = [pose[11]!, pose[12]!];
  const width = Math.hypot((ls.x - rs.x) * ASPECT, ls.y - rs.y); // image heights
  const cx = 1 - (ls.x + rs.x) / 2;
  const cy = (ls.y + rs.y) / 2;
  const { offset, drop, halfW, halfH } = gestureConfig.cursor;
  const dx = (u - 0.5) * 2 * halfW + offset;
  const dy = (v - 0.5) * 2 * halfH + drop;
  pose[16] = { x: 1 - (cx + (dx * width) / ASPECT), y: cy + dy * width, z: 0, visibility: 0.95 };
  return pose;
}

/** Holds each body's hand over its target for `ms`, injecting frames at 30 fps. */
async function hold(page: Page, targets: [Body, string | null][], ms: number): Promise<void> {
  const poses = await Promise.all(targets.map(([b, sel]) => bodyPose(page, b, sel)));
  await page.evaluate(
    async ({ poses, ms }) => {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        window.__game.injectPose({ t: performance.now(), poses });
        await new Promise((r) => setTimeout(r, 33));
      }
    },
    { poses, ms },
  );
}

const DWELL = gestureConfig.cursor.dwellMs;
const pressed = (page: Page, sel: string) =>
  expect(page.locator(sel)).toHaveAttribute('aria-pressed', 'true');

test('two bodies: pick 2 players and Boxing, each claims their own slot by hovering, then start', async ({
  page,
}) => {
  await page.goto('/?input=keyboard&seed=42');
  await hold(page, [['center', '[data-players="2"]']], DWELL / 2); // too short: nothing selected
  await expect(page.locator('[data-players="2"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.menu .cursor:not([hidden])')).toHaveCount(1); // a centered body is P2 (x ≥ 0.5)
  await hold(page, [['center', '[data-players="2"]']], DWELL + 300);
  await pressed(page, '[data-players="2"]');
  await hold(page, [['center', '[data-game="boxing"]']], DWELL + 300);
  expect(await page.evaluate(() => window.__game.getActiveGame())).toBeNull(); // "Who's playing?" first
  await expect(page.getByText("Who's playing Boxing?")).toBeVisible();

  // The right body's hand over the LEFT slot's name does nothing: slots answer only to their side.
  const leftP1 = '[data-slot="0"][data-name="Player 1"]';
  await hold(
    page,
    [
      ['left', null],
      ['right', leftP1],
    ],
    DWELL + 300,
  );
  await expect(page.locator(leftP1)).toHaveAttribute('aria-pressed', 'false');

  await hold(
    page,
    [
      ['left', leftP1],
      ['right', '[data-slot="1"][data-name="Player 2"]'],
    ],
    DWELL + 300,
  );
  await pressed(page, leftP1);
  await pressed(page, '[data-slot="1"][data-name="Player 2"]');
  await hold(
    page,
    [
      ['left', '[data-nav="start"]'],
      ['right', null],
    ],
    DWELL + 300,
  );
  expect(await page.evaluate(() => window.__game.getActiveGame())).toBe('boxing');
  expect(await page.evaluate(() => window.__game.getPlayerCount())).toBe(2);
  await expect(page.locator('.player-hud.p1 .bhud .me')).toContainText('Player 1');
  await expect(page.locator('.player-hud.p2 .bhud .me')).toContainText('Player 2');
});

test('hands down: no cursor; mouse still works, and a typed name is used', async ({ page }) => {
  await page.goto('/?input=keyboard&seed=42');
  await hold(page, [['center', null]], 100);
  await expect(page.locator('.menu .cursor:not([hidden])')).toHaveCount(0);
  await page.getByRole('button', { name: 'Skate Run' }).click();
  await page.getByLabel('New name for Player').fill('  Ana  ');
  await page.getByRole('button', { name: 'Add' }).click();
  await pressed(page, '[data-name="Ana"]');
  await page.getByRole('button', { name: 'Start' }).click();
  expect(await page.evaluate(() => window.__game.getActiveGame())).toBe('skate-run');
  expect(await page.evaluate(() => window.__game.getPlayerCount())).toBe(1);
});
