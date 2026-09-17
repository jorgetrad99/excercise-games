import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { recordGate } from './gates';

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
const STILL = {
  body: { sway: 0, duck: 0, rise: 0, forward: 0 },
  torso: { rot: [0, 0, 0, 1] },
  hips: { rot: [0, 0, 0, 1] },
  head: { rot: [0, 0, 0, 1] },
  arms: [null, null],
} as const;

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
  expect(hit.faceRadius - neutral.faceRadius).toBeGreaterThan(0.005); // one hit already swells
  await page.screenshot({ path: `${ROOT}/head-hit.png` });
  // Accumulate real punches until zero stamina, then another hit starts the referee count.
  await page.evaluate(() => {
    const h = window.__boxingVisual;
    for (let i = 0; i < 20 && !h.state().boxers[1].dizzy; i++)
      h.step(0.5, [
        { type: i % 2 ? 'PUNCH_LEFT' : 'PUNCH_RIGHT', aim: { x: i % 2 ? -1 : 1, y: 0 } },
      ]);
  });
  // Dizzy is still standing in the sim (it can dodge and be hit): the head stays up.
  expect(await page.evaluate(() => window.__boxingVisual.state().boxers[1].dizzy)).toBe(true);
  const dizzy = await page.evaluate(() => window.__boxingVisual.inspect());
  expect(dizzy.center[1]!).toBeGreaterThan(neutral.center[1]! - 0.15);
  await page.screenshot({ path: `${ROOT}/dizzy-standing.png` });
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
  const beaten = await page.evaluate(() => window.__boxingVisual.inspect());
  expect(beaten.faceRadius).toBeGreaterThan(hit.faceRadius);
  await page.evaluate(() => window.__boxingVisual.restart());
  const fresh = await page.evaluate(() => window.__boxingVisual.inspect());
  expect(fresh.facePixels).toEqual(neutral.facePixels);
  expect(fresh.faceRadius).toBeCloseTo(neutral.faceRadius, 6);
  expect(errors).toEqual([]);
});

test('head snaps away from the blow: left cheek turns right, right cheek left, chin tips up', async ({
  page,
}) => {
  await harness(page);
  const neutral = await page.evaluate(() => window.__boxingVisual.inspect());
  // Boxer 0 punches boxer 1. A straight right lands on the left cheek, a straight left on the right
  // cheek, an uppercut on the chin (presentation.impactZone). Sample the peak of the snap.
  const peak = (type: 'PUNCH_LEFT' | 'PUNCH_RIGHT', aim: { x: number; y: number }) =>
    page.evaluate(
      ([type, aim]) => {
        const h = window.__boxingVisual;
        h.restart();
        h.step(0.3, [{ type, aim }]);
        return h.inspect().faceDir;
      },
      [type, aim] as const,
    );
  const left = await peak('PUNCH_RIGHT', { x: 0, y: 0 });
  const right = await peak('PUNCH_LEFT', { x: 0, y: 0 });
  const chin = await peak('PUNCH_RIGHT', { x: 0, y: 1 });
  expect(left[0]! - neutral.faceDir[0]!).toBeLessThan(-0.15);
  expect(right[0]! - neutral.faceDir[0]!).toBeGreaterThan(0.15);
  expect(chin[1]! - neutral.faceDir[1]!).toBeGreaterThan(0.1);
  expect(Math.abs(chin[0]! - neutral.faceDir[0]!)).toBeLessThan(0.1);
});

test('the face is lit like the head: no seam at the cap edge, and it darkens with the light', async ({
  page,
}) => {
  await harness(page);
  // With sky light only, shading depends on normal.y alone: along the equator, skin should read the
  // same from the face onto the shell. An unlit face or a dark fringe at the oval both break that.
  const sweep = await page.evaluate(() => window.__boxingVisual.seam());
  const shell = sweep.at(-1)!;
  const jump = Math.max(...sweep.flatMap((c) => c.map((v, i) => Math.abs(v - shell[i]!))));
  expect(jump).toBeLessThan(24);
  const { bright, dim } = await page.evaluate(() => window.__boxingVisual.lighting());
  const sum = (c: number[]) => c.reduce((a, b) => a + b, 0);
  expect(sum(bright) - sum(dim)).toBeGreaterThan(60);
  await page.screenshot({ path: `${ROOT}/head-lit.png` });
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
  await page.evaluate(
    (still) => window.__boxingVisual.live({ ...still, head: { rot: [0, 0.258819, 0, 0.965926] } }),
    STILL,
  );
  expect((await page.evaluate(() => window.__boxingVisual.inspect())).rotation).not.toEqual(
    first.rotation,
  );
  await page.evaluate(() => window.__boxingVisual.live(null));
  const cleared = await page.evaluate(() => window.__boxingVisual.inspect());
  cleared.rotation.forEach((n, i) => expect(n).toBeCloseTo(first.rotation[i]!, 10));
});

test('the sim stays authoritative: a live sway or reach never shows a dodge or punch', async ({
  page,
}) => {
  await harness(page);
  const neutral = await page.evaluate(() => window.__boxingVisual.inspect());
  // A full-body sway and a step toward the camera the sim never heard about: only a small lean shows.
  await page.evaluate(
    (still) =>
      window.__boxingVisual.live({ ...still, body: { sway: 1, duck: 0, rise: 0, forward: 0.3 } }),
    STILL,
  );
  const leaned = await page.evaluate(() => window.__boxingVisual.inspect());
  expect(Math.abs(leaned.center[0]! - neutral.center[0]!)).toBeGreaterThan(0.03);
  expect(Math.abs(leaned.center[0]! - neutral.center[0]!)).toBeLessThan(0.08);
  // A sim dodge replaces the live lean instead of adding to it: same spot as with no live pose at all.
  await page.evaluate(() => window.__boxingVisual.step(0.2, [{ type: 'DODGE_RIGHT', player: 1 }]));
  const dodgedLive = await page.evaluate(() => window.__boxingVisual.inspect());
  await page.evaluate(() => {
    const h = window.__boxingVisual;
    h.restart();
    h.live(null);
    h.step(0.2, [{ type: 'DODGE_RIGHT', player: 1 }]);
  });
  const dodgedSim = await page.evaluate(() => window.__boxingVisual.inspect());
  expect(Math.abs(dodgedSim.center[0]! - neutral.center[0]!)).toBeGreaterThan(0.2);
  dodgedLive.center.forEach((n, i) => expect(n).toBeCloseTo(dodgedSim.center[i]!, 3));
  // Both arms punched straight at the camera: gloves at rest creep forward, never reach a punch.
  await page.evaluate((still) => {
    window.__boxingVisual.step(1);
    const forward = [-0.7071068, 0, 0, 0.7071068] as const; // swings (0,-1,0) onto (0,0,1)
    const arm = { upperRot: forward, foreRot: forward };
    window.__boxingVisual.live({ ...still, arms: [arm, arm] });
  }, STILL);
  const reached = await page.evaluate(() => window.__boxingVisual.inspect());
  for (const hand of [0, 1]) {
    const dz = reached.gloves[hand]![2]! - neutral.gloves[hand]![2]!;
    expect(dz).toBeGreaterThan(0.05);
    expect(dz).toBeLessThanOrEqual(0.12 + 1e-6);
  }
});

test(
  'live fake-camera face reaches Boxing at 1080p with pose and render performance intact',
  { tag: '@perf' },
  async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || (m.type() === 'warning' && /THREE/.test(m.text())))
        errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?game=boxing&input=pose&seed=42&clock=manual');
    await expect
      .poll(() => page.evaluate(() => window.__game.getFaceVersion()), { timeout: 30_000 })
      .toBeGreaterThan(0);
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
    recordGate(
      'boxing-1p-1080p-face',
      {
        fps: samples.map((s) => s.fps),
        poseFps: samples.map((s) => s.pose?.poseFps ?? 0),
        calls: samples.map((s) => s.render?.calls ?? NaN),
      },
      { fps: '>= 55 each', poseFps: '>= 20 each', calls: '< 150 each' },
    );
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
