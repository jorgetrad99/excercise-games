// PLAN-BOXING BX-CAL-6: the body scan is in the menu and saves per name. Applying it to reach
// (acceptance 5) is disabled until the guard-scores blocker is resolved.
// TEMPORARY(synthetic-fixtures): synthetic T-pose and punch, injected / replayed.
import { expect, test, type Page } from '@playwright/test';
import { boxingConfig as C } from '../../src/core/boxing/boxing.config';
import type { BoxingState } from '../../src/core/boxing/types';
import { CALIBRATE, fixture, script } from '../../src/pose/testdata/synthetic';

const NAME = 'Long Arms';

/** Feeds a stand-still + T-pose take to the menu (frame times rebased onto the page clock). */
async function scanInMenu(page: Page) {
  const frames = script(
    [CALIBRATE, { ms: 200, to: { tPose: true } }, { ms: 2600, to: { tPose: true } }],
    {
      fps: 30,
    },
  );
  await page.evaluate((fs) => {
    const t0 = performance.now();
    for (const f of fs) window.__game.injectPose({ t: t0 + f.t, poses: f.poses });
  }, frames);
}

/** Peak boxer-0 glove depth (the sim's body, boxer-local m) while a guard → half-punch replay plays. */
async function peakGloveZ(page: Page, names: string): Promise<number> {
  const keys = [
    CALIBRATE,
    { ms: 3600, to: {} }, // through the intro: BODY input is live in every phase
    { ms: 120, to: { punchR: 0.5 } },
    { ms: 300, to: { punchR: 0.5 } },
    { ms: 200, to: {} },
  ];
  const fx = fixture(script(keys, { base: { fists: 'guard' }, jitter: 0 }));
  await page.route('**/fixtures/pose/scan-punch.json', (r) => r.fulfill({ json: fx }));
  await page.goto(
    `/?game=boxing&input=replay:scan-punch.json&seed=42&names=${encodeURIComponent(names)}`,
  );
  return page.evaluate(
    (ms) =>
      new Promise<number>((resolve) => {
        let peak = -Infinity;
        const start = performance.now();
        const tick = () => {
          const b = window.__game.getState<BoxingState>().boxers[0].body;
          if (b.source === 'pose') peak = Math.max(peak, b.now.gloves[1][2]);
          if (performance.now() - start > ms) return resolve(peak);
          requestAnimationFrame(tick);
        };
        tick();
      }),
    7800,
  );
}

test('BX-CAL-6: Body scan in the menu measures and saves arm lengths per name', async ({
  page,
}) => {
  await page.goto('/?input=keyboard');
  await page.click('[data-nav="scan"]');
  await page.fill('.menu form input[name="name"]', NAME);
  await page.click('.menu form button[type="submit"]');
  await expect(page.locator('.scan-step')).toHaveAttribute('data-step', 'stand');
  await scanInMenu(page);
  await expect(page.locator('.scan-step')).toHaveAttribute('data-step', 'done');
  await page.click('[data-nav="save"]');
  const body = await page.evaluate(
    (name) => JSON.parse(localStorage.getItem('move-arcade.profile')!).players[name].body,
    NAME,
  );
  // Synthetic T-pose arms: 0.12 image widths per bone at 16:9 on a 0.30 torso ≈ 0.71 torso lengths each.
  expect(body.upperArm).toBeCloseTo(0.71, 1);
  expect(body.forearm).toBeCloseTo(0.71, 1);
});

test(
  'BX-CAL-6 blocker: a stored scan is NOT applied to reach (same take, same peak depth as no scan)',
  { tag: '@realtime' },
  async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/?input=keyboard');
    await page.evaluate((name) => {
      const scan = {
        upperArm: 0.71,
        forearm: 0.71,
        shoulderWidth: 0.71,
        at: '2026-09-16T00:00:00Z',
      };
      const profile = {
        version: 2,
        players: { [name]: { matches: [], body: scan } },
        lastNames: [],
      };
      localStorage.setItem('move-arcade.profile', JSON.stringify(profile));
    }, NAME);
    const scanned = await peakGloveZ(page, NAME);
    const unscanned = await peakGloveZ(page, 'Nobody Scanned');
    const contact = 2 * C.ring.gapM - C.body.head[2] - (C.body.headRadiusM + C.body.gloveRadiusM);
    console.info('BX-CAL-6 peak glove z', { scanned, unscanned, contact });
    // Jorge, 2026-09-17: with an accurate scan (these 0.71 arms are the synthetic figure's true lengths)
    // a plain guard read z 1.23 m, past head contact: standing in guard scored. Until armGainM is retuned
    // from the drills, main.ts stores scans but plays everyone with default proportions. When the scan is
    // re-enabled, this flips back to acceptance 5 (scanned reads deeper: 1.29 vs 1.04 m when last applied).
    expect(unscanned).toBeGreaterThan(contact); // default proportions: half extension lands
    expect(Math.abs(scanned - unscanned)).toBeLessThan(0.03);
  },
);
