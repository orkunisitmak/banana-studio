import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4179', trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/browser-test-server.mjs',
    url: 'http://127.0.0.1:4179/tests/ui/keyboard-shortcuts.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
