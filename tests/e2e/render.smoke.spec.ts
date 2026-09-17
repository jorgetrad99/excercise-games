// M4 DoD: screenshot tests on seed 42 at t = 0/10/30 s, HUD flows, draw-call budget, console hygiene.
import { expect, test, type Page } from '@playwright/test';
import type { SimState } from '../../src/core/types';

/** Not ours: ANGLE's D3D compiler warns about float precision in three's PMREM shaders
 *  (X4122); MediaPipe's wasm logs glog lines like `W0916 … gl_context.cc:1119]` at startup. */
const BENIGN = /warning X4122|\[vite\]|^W\d{4} [\d:. ]+\d+ \w+\.cc:\d+\]/;

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !BENIGN.test(m.text())) {
      problems.push(`${m.type()}: ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

async function boot(page: Page, query: string): Promise<void> {
  await page.goto(`/?game=skate-run&${query}`);
  await expect
    .poll(() => page.evaluate(() => window.__game?.getRenderStats()?.frames ?? 0), {
      timeout: 20_000,
    })
    .toBeGreaterThan(3);
}

/** Advance the manual clock to sim time `t`, then let a couple of frames render it. */
async function seek(page: Page, t: number): Promise<void> {
  await page.evaluate((t) => window.__game.advance(t - window.__game.getState<SimState>().t), t);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

test.describe('renderer', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('seed 42 with bot autoplay looks the same at t = 0, 10, 30 s (+ 60 s: park biome)', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await boot(page, 'input=bot&seed=42&clock=manual');
    for (const t of [0, 10, 30, 60]) {
      await seek(page, t);
      await expect(page).toHaveScreenshot(`seed42-t${t}.png`, { maxDiffPixelRatio: 0.01 });
    }
    const state = await page.evaluate(() => {
      const s = window.__game.getState<SimState>();
      return { phase: s.phase, distance: s.distance, crashes: s.stats.crashes };
    });
    expect(state).toMatchObject({ phase: 'running', crashes: 0 });
    expect(state.distance).toBeGreaterThan(1000); // biome 2 (park) from 1000 m
    const stats = await page.evaluate(() => window.__game.getRenderStats()!);
    console.info('render stats at t=60', stats);
    expect(stats.calls).toBeLessThan(150);
    expect(problems).toEqual([]);
  });

  test('keyboard: crash → revive prompt (Enter) → crash → results card → Space plays again', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await boot(page, 'input=keyboard&seed=42&clock=manual&tokens=1');
    const phase = () => page.evaluate(() => window.__game.getState<SimState>().phase);
    const runUntil = async (want: string) => {
      for (let i = 0; i < 400 && (await phase()) !== want; i++)
        await page.evaluate(() => window.__game.advance(0.05));
      expect(await phase()).toBe(want);
    };
    await runUntil('crashed');
    await expect(page.locator('.hud .card')).toContainText('Revive?');
    await page.keyboard.press('Enter');
    await seek(page, (await page.evaluate(() => window.__game.getState<SimState>().t)) + 0.1);
    expect(await phase()).toBe('running');
    await runUntil('over'); // no tokens left: straight to results
    await expect(page.locator('.hud .results')).toContainText('Run over');
    await page.screenshot({ path: 'tmp/e2e/results-card.png' });
    await page.keyboard.press('Space'); // too soon: the card stays up for at least 1 s
    await page.waitForTimeout(300);
    expect(await phase()).toBe('over');
    await page.waitForTimeout(1_000);
    await page.keyboard.press('Space');
    await expect.poll(phase).toBe('countdown');
    expect(await page.evaluate(() => window.__game.getState<SimState>().t)).toBe(0);
    expect(problems).toEqual([]);
  });
});

test.describe('perf', { tag: '@perf' }, () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('holds >= 55 fps over 20 s at 1080p (bot autoplay + keyboard source live)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const problems = watchConsole(page);
    await boot(page, 'input=bot&seed=42');
    await page.waitForTimeout(2_000); // warm-up: shader compile, first chunks
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1_000);
      samples.push(await page.evaluate(() => window.__game.getFps()));
    }
    const stats = await page.evaluate(() => ({
      render: window.__game.getRenderStats(),
      phase: window.__game.getState<SimState>().phase,
      distance: Math.round(window.__game.getState<SimState>().distance),
    }));
    console.info('perf fps samples', samples.join(','), stats);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(55);
    expect(stats.render!.calls).toBeLessThan(150);
    expect(stats.phase).toBe('running');
    expect(problems).toEqual([]);
  });

  // PLAN M4 perf gate says "with pose running". The fake-camera placeholder never holds still long
  // enough to calibrate, so the run waits at the countdown, but the full scene still renders every
  // frame while the worker runs PoseLandmarker on the same GPU.
  test('holds >= 55 fps at 1080p while the pose worker tracks the fake camera', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = watchConsole(page);
    await page.goto('/?game=skate-run&input=pose');
    await expect
      .poll(() => page.evaluate(() => window.__game.getPoseStats()?.framesWithPose ?? 0), {
        timeout: 45_000,
      })
      .toBeGreaterThan(0);
    await page.waitForTimeout(2_000);
    const samples: { fps: number; poseFps: number }[] = [];
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1_000);
      samples.push(
        await page.evaluate(() => ({
          fps: window.__game.getFps(),
          poseFps: window.__game.getPoseStats()?.poseFps ?? 0,
        })),
      );
    }
    const calls = await page.evaluate(() => window.__game.getRenderStats()?.calls ?? 0);
    console.info('perf with pose', JSON.stringify(samples), { calls });
    expect(Math.min(...samples.map((s) => s.fps))).toBeGreaterThanOrEqual(55);
    expect(Math.min(...samples.map((s) => s.poseFps))).toBeGreaterThanOrEqual(20);
    expect(calls).toBeGreaterThan(20); // the 3D scene really drew
    await expect(page.locator('.hud .card')).toContainText('Get ready'); // held for calibration
    await page.keyboard.press('ArrowLeft'); // the keyboard fallback starts the run anyway
    await expect
      .poll(() => page.evaluate(() => window.__game.getState<SimState>().tick))
      .toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
