// Phase 2 Piece 3 / PLAN M6a: local 2-player (numPoses 2, zone split, two sims on one seed, split screen).
// TEMPORARY(synthetic-fixtures): the replay test uses synthetic two-person frames and the perf test a
// composited two-person placeholder clip, until Jorge records two-players.json and a real 2-person clip.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { SimState } from '../../src/core/types';
import { CALIBRATE, JUMP, fixture, scriptTwo, type Key } from '../../src/pose/testdata/synthetic';

// This whole file sees two people in front of the fake camera.
test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${path.resolve('tests/e2e/assets/placeholder-two-people.mjpeg')}`,
    ],
  },
});

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const stand = (ms: number): Key => ({ ms, to: {} });

test(
  'replay: two bodies are tracked independently, each driving only its own run',
  { tag: '@realtime' },
  async ({ page }) => {
    test.setTimeout(60_000);
    // Timeline (ms): both calibrate by ~2 s → shared countdown. P2 steps out 2.5–4.0 s (< 2 s: only P2
    // pauses). At ~9 s P1 leans left + jumps, P2 leans right. Realtime replay: where on the track an
    // event lands depends on frame timing, so this test asserts inputs and lanes, not collisions or
    // scores (the manual-clock test below does those deterministically).
    const fx = fixture(
      scriptTwo(
        [
          CALIBRATE,
          stand(6500),
          { ms: 300, to: { lean: -0.06 } },
          stand(600),
          ...JUMP,
          stand(1500),
        ],
        [
          CALIBRATE,
          { ms: 1500, to: { visible: false } },
          stand(5000),
          { ms: 300, to: { lean: 0.06 } },
          stand(2850),
        ],
      ),
    );
    await page.route('**/fixtures/pose/synthetic-two-players.json', (r) => r.fulfill({ json: fx }));
    const errors = watchErrors(page);
    await page.goto(
      '/?game=skate-run&players=2&input=replay:synthetic-two-players.json&seed=42&tokens=0',
    );
    expect(await page.evaluate(() => window.__game.getPlayerCount())).toBe(2);

    const byPlayer = () =>
      page.evaluate(() => {
        const out: string[][] = [[], []];
        for (const e of window.__game.getEvents() as { type: string; player?: number }[])
          out[e.player ?? 0]!.push(e.type);
        return out;
      });
    await expect.poll(byPlayer, { timeout: 30_000 }).toEqual([
      ['LANE_LEFT', 'JUMP'],
      ['PAUSE', 'RESUME', 'LANE_RIGHT'],
    ]);
    await page.waitForTimeout(300); // let both sims apply the last events

    const [p1, p2] = await page.evaluate(() =>
      [0, 1].map((i) => {
        const s = window.__game.getState<SimState>(i);
        return {
          seed: s.seed,
          lane: s.targetLane,
          distance: s.distance,
          jumps: s.stats.jumps,
          calibrated: window.__game.getSignals(i)?.calibration.state,
        };
      }),
    );
    console.info('two-player replay', { p1, p2 });
    expect([p1!.seed, p2!.seed]).toEqual([42, 42]);
    expect([p1!.calibrated, p2!.calibrated]).toEqual(['calibrated', 'calibrated']);
    expect([p1!.lane, p2!.lane]).toEqual([-1, 1]);
    expect([p1!.jumps, p2!.jumps]).toEqual([1, 0]);
    await expect(page.locator('.player-hud .hud')).toHaveCount(2);
    await page.screenshot({ path: 'tmp/two-players/replay.png' });
    expect(errors).toEqual([]);
  },
);

test('manual clock: same seed, different inputs → independent collisions and scores', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/?game=skate-run&players=2&input=keyboard&seed=42&clock=manual&tokens=0');
  await expect
    .poll(() => page.evaluate(() => window.__game.getRenderStats()?.frames ?? 0), {
      timeout: 20_000,
    })
    .toBeGreaterThan(3);
  const [p1, p2] = await page.evaluate(() => {
    const g = window.__game;
    g.advance(3.5); // countdown
    g.inject({ type: 'LANE_RIGHT', player: 1 }); // P2 only: into the right lane's parked car on seed 42
    g.advance(5);
    return [0, 1].map((i) => {
      const s = g.getState<SimState>(i);
      return {
        phase: s.phase,
        lane: s.targetLane,
        distance: Math.round(s.distance),
        coins: s.coins,
        score: Math.round(s.score),
      };
    });
  });
  expect(p1).toEqual({ phase: 'running', lane: 0, distance: 70, coins: 6, score: 70 });
  expect(p2).toEqual({ phase: 'over', lane: 1, distance: 56, coins: 0, score: 56 });
  // Keyboard is P1's fallback only.
  await page.keyboard.press('ArrowLeft');
  await page.evaluate(() => window.__game.advance(0.1));
  expect(
    await page.evaluate(() => [0, 1].map((i) => window.__game.getState<SimState>(i).targetLane)),
  ).toEqual([-1, 1]);
  expect(errors).toEqual([]);
});

test.describe('split screen', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('seed 42 bots: two halves, each with its own HUD', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/?game=skate-run&players=2&input=bot&seed=42&clock=manual');
    await expect
      .poll(() => page.evaluate(() => window.__game.getRenderStats()?.frames ?? 0), {
        timeout: 20_000,
      })
      .toBeGreaterThan(3);
    await page.evaluate(() => window.__game.advance(10));
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    await expect(page).toHaveScreenshot('two-players-seed42-t10.png', { maxDiffPixelRatio: 0.01 });
    const phases = await page.evaluate(() =>
      [0, 1].map((i) => window.__game.getState<SimState>(i).phase),
    );
    expect(phases).toEqual(['running', 'running']);
    expect(errors).toEqual([]);
  });
});

test.describe('perf', { tag: '@perf' }, () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('2 players at 1080p: >= 55 fps, >= 20 pose-fps with two bodies tracked, draw calls < 150', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    // Bots drive both runs so both halves render a moving world while the worker tracks two people.
    await page.goto('/?game=skate-run&players=2&input=pose&autoplay=1&seed=42&tokens=99');
    await expect
      .poll(
        () =>
          page.evaluate(() => [0, 1].map((i) => window.__game.getSignals(i)?.tracking ?? 'none')),
        { timeout: 60_000 },
      )
      .toEqual(['ok', 'ok']);
    await page.keyboard.press('ArrowUp'); // any key opens the calibration gate (the placeholder sways)
    await page.waitForTimeout(3_000); // warm-up: countdown, shader compile, first chunks
    const samples: { fps: number; poseFps: number; poses: number; calls: number; tris: number }[] =
      [];
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1_000);
      samples.push(
        await page.evaluate(() => {
          const pose = window.__game.getPoseStats();
          const r = window.__game.getRenderStats();
          return {
            fps: window.__game.getFps(),
            poseFps: pose?.poseFps ?? 0,
            poses: pose?.lastPoseCount ?? 0,
            calls: r?.calls ?? 0,
            tris: r?.triangles ?? 0,
          };
        }),
      );
    }
    const phases = await page.evaluate(() =>
      [0, 1].map((i) => window.__game.getState<SimState>(i).phase),
    );
    console.info('perf 2 players', JSON.stringify(samples), { phases });
    expect(phases).toEqual(['running', 'running']);
    expect(Math.min(...samples.map((s) => s.fps))).toBeGreaterThanOrEqual(55);
    expect(Math.min(...samples.map((s) => s.poseFps))).toBeGreaterThanOrEqual(20);
    expect(samples.filter((s) => s.poses === 2).length).toBeGreaterThanOrEqual(12);
    expect(Math.max(...samples.map((s) => s.calls))).toBeLessThan(150);
    expect(errors).toEqual([]);
  });
});
