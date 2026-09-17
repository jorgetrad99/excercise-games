import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Fake camera = the INTERIM placeholder clip (scripts/make-placeholder-clip.mjs) until Jorge's
// fixtures/video/<clip> exists; swap the path then. Chrome loops the file.
const FAKE_CLIP = path.resolve('tests/e2e/assets/placeholder-person.mjpeg');
const fakeCamera = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-video-capture=${FAKE_CLIP}`,
];

/** The perf describe blocks (`test.describe('perf', …)`); grep also sees the project name, hence the whitespace. */
const PERF = /\sperf\s/;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'tmp/test-results',
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'pnpm exec vite --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'smoke',
      testMatch: /.*\.smoke\.spec\.ts/,
      grepInvert: PERF,
      // channel 'chromium' = new headless: uses the real GPU (headless-shell falls back to SwiftShader).
      use: { ...devices['Desktop Chrome'], channel: 'chromium', launchOptions: { args: fakeCamera } },
    },
    {
      // fps / pose-fps gates measure the GPU the other smoke pages share: run them after smoke, one at
      // a time. In parallel, 2P pose-fps dipped to 19 from contention alone (PROGRESS 2026-09-16).
      name: 'smoke-perf',
      testMatch: /.*\.smoke\.spec\.ts/,
      grep: PERF,
      dependencies: ['smoke'],
      workers: 1,
      use: { ...devices['Desktop Chrome'], channel: 'chromium', launchOptions: { args: fakeCamera } },
    },
    {
      // On-demand measurement tools (pnpm latency:pipeline); not part of verify.
      name: 'tools',
      testMatch: /.*\.tool\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], channel: 'chromium', launchOptions: { args: fakeCamera } },
    },
  ],
});
