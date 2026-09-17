import { existsSync } from 'node:fs';
import { acquireE2eLock } from './e2e-lock';

// public/models/ is git-ignored, so a fresh clone or worktree has no pose models and every pose e2e
// fails with an unrelated-looking tracking error. Fail up front with the fix instead.
const REQUIRED = [
  'public/models/pose_landmarker_lite.task',
  'public/models/pose_landmarker_full.task',
  'public/models/pose_landmarker_heavy.task',
  'public/models/wasm/vision_wasm_internal.wasm',
];

/** Returns the teardown (Playwright runs it after all tests): releases the e2e lock. */
export default function globalSetup(): () => void {
  const release = acquireE2eLock();
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
