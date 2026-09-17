import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Fake camera = the INTERIM placeholder clip (scripts/make-placeholder-clip.mjs) until Jorge's
// fixtures/video/<clip> exists; swap the path then. Chrome loops the file.
const FAKE_CLIP = path.resolve('tests/e2e/assets/placeholder-person.mjpeg');
// Isolate parallel worktrees without accidentally testing another branch's Vite server.
const PORT = process.env.PLAYWRIGHT_PORT ?? '5173';
const BASE_URL = `http://localhost:${PORT}`;
const fakeCamera = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-video-capture=${FAKE_CLIP}`,
];

export default defineConfig({
  // The suite measures GPU/pose FPS and wall-clock replays; concurrent games compete for the GPU.
  workers: 1,
  testDir: 'tests/e2e',
  outputDir: 'tmp/test-results',
  reporter: 'list',
  use: { baseURL: BASE_URL },
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'smoke',
      testMatch: /.*\.smoke\.spec\.ts/,
      // channel 'chromium' = new headless: uses the real GPU (headless-shell falls back to SwiftShader).
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        launchOptions: { args: fakeCamera },
      },
    },
    {
      // On-demand measurement tools (pnpm latency:pipeline); not part of verify.
      name: 'tools',
      testMatch: /.*\.tool\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        launchOptions: { args: fakeCamera },
      },
    },
  ],
});
