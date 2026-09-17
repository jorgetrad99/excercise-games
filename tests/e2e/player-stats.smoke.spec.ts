// Named players' match history: a finished match is saved under the player's name, survives a
// reload, and the menu's Stats page shows the record, one chart per stat and the table.
import { expect, test, type Page } from '@playwright/test';
import type { BoxingState } from '../../src/core/boxing/types';

/** Boxing with bots on both sides (autoplay), manual clock: steps until the match is over. */
async function finishBoxing(page: Page, query: string): Promise<BoxingState> {
  await page.goto(`/?game=boxing&input=keyboard&autoplay=1&clock=manual&seed=42&${query}`);
  await expect
    .poll(() => page.evaluate(() => window.__game.getRenderStats()?.frames ?? 0))
    .toBeGreaterThan(2);
  for (let i = 0; i < 60; i++) {
    const phase = await page.evaluate(() => {
      window.__game.advance(20);
      return window.__game.getState<BoxingState>().phase;
    });
    if (phase === 'over') break;
  }
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__game.getState<BoxingState>())));
}

const saved = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('move-arcade.profile') ?? 'null'));

test('2P match: both names get a record; reload; Stats shows record, charts and table', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const s = await finishBoxing(page, 'players=2&names=Ana,Beto');
  expect(s.phase).toBe('over');
  await expect.poll(async () => (await saved(page))?.players?.Beto?.matches?.length ?? 0).toBe(1);
  const profile = await saved(page);
  const ana = profile.players.Ana.matches[0];
  const beto = profile.players.Beto.matches[0];
  expect(profile.version).toBe(2);
  expect(ana).toMatchObject({ game: 'boxing', players: 2, opponent: 'Beto' });
  expect(beto).toMatchObject({ opponent: 'Ana' });
  expect(ana.stats.cleanHits).toBe(s.boxers[0].landed);
  expect(ana.stats.knockdownsTaken).toBe(beto.stats.knockdownsScored);
  const expected =
    s.winner === null ? ['draw', 'draw'] : s.winner === 0 ? ['win', 'loss'] : ['loss', 'win'];
  expect([ana.result, beto.result]).toEqual(expected);

  // A frame loop that keeps running on the results card must not record the match twice.
  await page.waitForTimeout(500);
  expect((await saved(page)).players.Ana.matches).toHaveLength(1);

  await page.goto('/?input=keyboard');
  await page.getByRole('button', { name: 'Stats' }).click();
  await page.locator('[data-stats-player="Ana"]').click();
  await page.locator('[data-stats-game="boxing"]').click();
  await expect(page.getByText('Ana · Boxing: 1 match')).toBeVisible();
  await expect(page.locator('.stats-page .chart canvas')).toHaveCount(5);
  await expect(page.locator('.stats-page tbody tr')).toHaveCount(1);
  await expect(page.locator('.stats-page figcaption').first()).toHaveText('clean hits');
  await page.screenshot({ path: 'tmp/e2e/stats-page.png' });
  expect(errors).toEqual([]);
});

test('1P vs CPU: opponent is CPU; names persist as the next session’s default', async ({
  page,
}) => {
  await finishBoxing(page, 'names=Cleo');
  await expect.poll(async () => (await saved(page))?.players?.Cleo?.matches?.length ?? 0).toBe(1);
  expect((await saved(page)).players.Cleo.matches[0]).toMatchObject({
    players: 1,
    opponent: 'CPU',
  });
  await expect(page.locator('.bhud .me')).toContainText('Cleo');
});
