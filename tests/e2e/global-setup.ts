import { existsSync } from 'node:fs';
import { acquire, waitForLock } from '../../scripts/e2e-lock.mjs';

// public/models/ is git-ignored, so a fresh clone or worktree has no pose models and every pose e2e
// fails with an unrelated-looking tracking error. Fail up front with the fix instead.
const REQUIRED = [
  'public/models/pose_landmarker_lite.task',
  'public/models/pose_landmarker_full.task',
  'public/models/pose_landmarker_heavy.task',
  'public/models/wasm/vision_wasm_internal.wasm',
];

/** Takes the machine-wide perf lock for the whole run and returns the teardown that releases it.
 *  A second e2e run fails fast; a tools-only probe run (`pnpm latency:pipeline`) or PERF_LOCK_WAIT=1 waits. */
export default async function globalSetup(): Promise<() => void> {
  const probeOnly = process.argv.some((a) => a === '--project=tools');
  if (probeOnly || process.env.PERF_LOCK_WAIT) await waitForLock({ label: 'playwright probe' });
  const release = acquire();
  const missing = REQUIRED.filter((f) => !existsSync(f));
  if (missing.length) {
    release();
    throw new Error(
      `public/models/ is incomplete (git-ignored, not in this checkout). Missing: ${missing.join(', ')}.\n` +
        'Run `pnpm vendor:models` before the e2e tests.',
    );
  }
  return release;
}
