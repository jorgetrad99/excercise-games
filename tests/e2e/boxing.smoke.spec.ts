// Piece 4: Boxing through the real shell — menu, keyboard + 1P bot, 2P shared state, the pose path
// (replay), and screenshot baselines. TEMPORARY(synthetic-fixtures): the replay test uses synthetic
// boxing poses until a recorded boxing fixture exists.
import { expect, test, type Page } from '@playwright/test';
import { boxingConfig as C } from '../../src/core/boxing/boxing.config';
import type { BoxingState } from '../../src/core/boxing/types';
import { CALIBRATE, fixture, script, scriptTwo, type Key } from '../../src/pose/testdata/synthetic';

/** Not ours: ANGLE's D3D compiler precision warnings; Vite's own logs. */
const BENIGN = /warning X4122|\[vite\]/;

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !BENIGN.test(m.text()))
      problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

async function boot(page: Page, query: string): Promise<void> {
  await page.goto(`/?game=boxing&${query}`);
  await expect
    .poll(() => page.evaluate(() => window.__game?.getRenderStats()?.frames ?? 0), {
      timeout: 20_000,
    })
    .toBeGreaterThan(3);
}

/** Advance the manual clock to sim time `t`, then let a couple of frames render it. */
async function seek(page: Page, t: number): Promise<void> {
  await page.evaluate((t) => window.__game.advance(t - window.__game.getState().t), t);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

const state = (page: Page, player = 0) =>
  page.evaluate(
    (p) => JSON.parse(JSON.stringify(window.__game.getState<BoxingState>(p))),
    player,
  ) as Promise<BoxingState>;

test('menu lists Boxing and launches it', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/?input=keyboard&seed=42');
  await page.getByRole('button', { name: 'Boxing' }).click();
  expect(await page.evaluate(() => window.__game.getActiveGame())).toBe('boxing');
  await expect
    .poll(() => page.evaluate(() => window.__game.getRenderStats()?.frames ?? 0))
    .toBeGreaterThan(10);
  await expect(page.locator('.bhud')).toHaveCount(1);
  expect(problems).toEqual([]);
});

test('1P keyboard: Z/X punch boxer 0, the bot fights back as boxer 1', async ({ page }) => {
  const problems = watchConsole(page);
  await boot(page, 'input=keyboard&seed=42&clock=manual');
  await seek(page, C.phases.introS + 0.1);
  expect((await state(page)).phase).toBe('fight');
  await page.keyboard.press('x');
  await seek(page, C.phases.introS + 0.2);
  expect((await state(page)).boxers[0].fists[1].phase).not.toBe('ready');
  await seek(page, C.phases.introS + 12);
  const s = await state(page);
  const b0 = s.boxers[0];
  // The punch resolved (hit, block or whiff all cost someone stamina), and the bot has been punching.
  expect(s.boxers[1].stamina < 10 || b0.stamina < 10).toBe(true);
  expect(s.boxers[1].landed).toBeGreaterThan(0); // boxer 0 never guards: the bot lands
  expect(problems).toEqual([]);
});

test('2P: one shared match state; each player drives their own boxer; no bot', async ({ page }) => {
  const problems = watchConsole(page);
  await boot(page, 'players=2&input=keyboard&seed=42&clock=manual');
  expect(await page.evaluate(() => window.__game.getPlayerCount())).toBe(2);
  await seek(page, C.phases.introS + 0.1);
  await page.evaluate(() => window.__game.inject({ type: 'PUNCH_RIGHT', player: 1 }));
  await seek(page, C.phases.introS + 1);
  let p1 = await state(page, 0);
  expect(await state(page, 1)).toEqual(p1); // the same state from both players' side
  expect(p1.boxers[0].stamina).toBeCloseTo(10 - C.stamina.clean);
  expect(p1.boxers[1].landed).toBe(1);

  await page.keyboard.press('z'); // keyboard = P1 = boxer 0
  await seek(page, C.phases.introS + 10);
  p1 = await state(page, 0);
  expect(p1.boxers[0].landed).toBe(1);
  expect(p1.boxers[1].landed).toBe(1); // nobody else threw anything: no bot in 2P
  await expect(page.locator('.player-hud .bhud')).toHaveCount(2);
  expect(problems).toEqual([]);
});

test('pose replay: punches and guard go through the gesture engine into the sim', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const READY = { fists: 'ready' } as const;
  const keys: Key[] = [
    CALIBRATE,
    { ms: 3500, to: {} }, // intro
    { ms: 120, to: { punchR: 1 } },
    { ms: 80, to: { punchR: 1 } },
    { ms: 250, to: {} },
    { ms: 600, to: {} },
    { ms: 120, to: { hookR: 1 } },
    { ms: 250, to: {} },
    { ms: 600, to: {} },
    { ms: 300, to: { fists: 'guard' } },
    { ms: 800, to: { fists: 'guard' } },
    { ms: 300, to: {} },
    { ms: 800, to: {} },
  ];
  const fx = fixture(script(keys, { base: READY }));
  await page.route('**/fixtures/pose/synthetic-boxing.json', (r) => r.fulfill({ json: fx }));
  const problems = watchConsole(page);
  await page.goto('/?game=boxing&input=replay:synthetic-boxing.json&seed=42');
  const punches = () =>
    page.evaluate(() =>
      (window.__game.getEvents() as { type: string; aim?: { x: number; y: number } }[]).filter(
        (e) => e.type !== 'JUMP',
      ),
    );
  await expect
    .poll(async () => (await punches()).map((e) => e.type), { timeout: 30_000 })
    .toEqual(['PUNCH_RIGHT', 'PUNCH_RIGHT', 'GUARD_START', 'GUARD_END']);
  const [straight, hook] = await punches();
  expect(Math.abs(straight!.aim!.x)).toBeLessThan(0.5);
  expect(hook!.aim!.x).toBeLessThan(-0.5);
  const s = await state(page);
  expect(s.tick).toBeGreaterThan(0); // calibration opened the gate
  expect(s.boxers[0].fists[1].phase).toBe('ready');
  // The continuous mirroring pose rides along with the discrete events.
  const pose = await page.evaluate(() => window.__game.getSignals()?.pose ?? null);
  expect(pose?.arms[0]?.upperRot).toHaveLength(4);
  expect(pose?.arms[1]?.reach).toBeGreaterThanOrEqual(0);
  expect(problems).toEqual([]);
});

test('2P pose replay: one body missing > 2 s pauses the shared match; both back resumes it', async ({
  page,
}) => {
  test.setTimeout(60_000);
  // Timeline (ms): both calibrate → intro. P2 leaves 5.5–9.5 s (> PAUSE_BOTH_MS), then stands back.
  const stand = (ms: number): Key => ({ ms, to: {} });
  const fx = fixture(
    scriptTwo(
      [CALIBRATE, stand(12_000)],
      [CALIBRATE, stand(3000), { ms: 4000, to: { visible: false } }, stand(5000)],
    ),
  );
  await page.route('**/fixtures/pose/synthetic-boxing-2p.json', (r) => r.fulfill({ json: fx }));
  const problems = watchConsole(page);
  await page.goto('/?game=boxing&players=2&input=replay:synthetic-boxing-2p.json&seed=42');
  const phase = () => page.evaluate(() => window.__game.getState<BoxingState>().phase);
  const byPlayer = () =>
    page.evaluate(() =>
      (window.__game.getEvents() as { type: string; player?: number }[]).map(
        (e) => `${e.player}:${e.type}`,
      ),
    );
  // P2's own tracking loss pauses the match at once (0.7 s); after 2 s the pause-both rule holds
  // both players, so P2's return alone (its TRACKING_RESTORED) can't resume it: only both-back does.
  const bothPaused = ['1:PAUSE', '0:PAUSE', '1:PAUSE'];
  await expect.poll(byPlayer, { timeout: 20_000 }).toEqual(bothPaused);
  expect(await phase()).toBe('paused');
  await expect.poll(byPlayer, { timeout: 20_000 }).toEqual([...bothPaused, '0:RESUME', '1:RESUME']);
  await expect.poll(phase).not.toBe('paused');
  expect(problems).toEqual([]);
});

test.describe('boxing renderer', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('seed 42 bot vs bot looks the same mid-fight and at a knockdown; 2P split screen', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await boot(page, 'input=bot&seed=42&clock=manual');
    await seek(page, 8.2);
    await expect(page).toHaveScreenshot('boxing-seed42-t8.png', { maxDiffPixelRatio: 0.01 });
    await seek(page, 35.5); // boxer 1 is down, count running (seed 42)
    expect((await state(page)).phase).toBe('down');
    await expect(page).toHaveScreenshot('boxing-seed42-down.png', { maxDiffPixelRatio: 0.01 });
    const stats = await page.evaluate(() => window.__game.getRenderStats()!);
    expect(stats.calls).toBeLessThan(150);

    await boot(page, 'players=2&input=keyboard&seed=42&clock=manual');
    await seek(page, C.phases.introS + 0.5);
    await expect(page).toHaveScreenshot('boxing-2p-seed42.png', { maxDiffPixelRatio: 0.01 });
    expect(problems).toEqual([]);
  });
});
