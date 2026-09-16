import { defineConfig, devices } from '@playwright/test';

// Fake-camera flags are on from day one; M1 adds `--use-file-for-fake-video-capture=fixtures/video/<clip>`.
const fakeCamera = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

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
      use: { ...devices['Desktop Chrome'], launchOptions: { args: fakeCamera } },
    },
  ],
});
