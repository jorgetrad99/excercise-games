import { defineConfig } from 'vitest/config';

// Analysis tools (tests/tools/*.tool.ts): slow or machine-specific, run on demand, never in verify.
export default defineConfig({
  test: {
    include: ['tests/tools/**/*.tool.ts'],
    silent: false,
    testTimeout: 600_000,
    globalSetup: ['./scripts/vitest-perf-lock.mjs'],
  },
});
