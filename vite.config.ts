import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173, strictPort: true },
  // globalSetup: wait for the machine-wide perf lock (scripts/e2e-lock.mjs) before running suites.
  test: {
    include: ['src/**/*.spec.ts', 'tests/unit/**/*.spec.ts'],
    globalSetup: ['./scripts/vitest-perf-lock.mjs'],
  },
});
