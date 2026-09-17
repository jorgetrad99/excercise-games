// vitest globalSetup: unit/tool suites wait for the perf lock (scripts/e2e-lock.mjs), so a direct
// `vitest` call can't run while perf gates measure.
import { existsSync, readdirSync } from 'node:fs';
import { waitForLock } from './e2e-lock.mjs';

export async function setup() {
  // Printed every run so a session trips over it instead of planning around recordings it assumes
  // exist (PROGRESS 2026-09-17 "No real pose recordings").
  const dir = 'fixtures/pose';
  if (!existsSync(dir) || !readdirSync(dir).some((f) => f.endsWith('.json'))) {
    console.warn(
      `NO REAL POSE RECORDINGS: ${dir}/ has none. Every pose test is synthetic; "provisional until ` +
        `drills" values stay untuned; BX-CAL-6 is blocked. See docs/PROGRESS.md "No real pose recordings".`,
    );
  }
  await waitForLock({ label: 'vitest' });
}
