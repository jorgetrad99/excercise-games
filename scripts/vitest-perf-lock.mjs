// vitest globalSetup: unit/tool suites wait for the perf lock (scripts/e2e-lock.mjs), so a direct
// `vitest` call can't run while perf gates measure.
import { waitForLock } from './e2e-lock.mjs';

export async function setup() {
  await waitForLock({ label: 'vitest' });
}
