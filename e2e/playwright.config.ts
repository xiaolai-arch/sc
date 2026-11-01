import { defineConfig } from '@playwright/test';

/**
 * E2E drives the real Electron application through Playwright's `_electron`.
 * The model layer is a checked-in fake CLI (see fixtures/fake-codex.mjs), so
 * this suite never needs network access, API keys, or a signed build.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  outputDir: '../test-results/e2e',
  use: {
    trace: 'retain-on-failure'
  }
});
