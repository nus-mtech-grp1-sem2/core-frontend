import { defineConfig, devices } from '@playwright/test';

/**
 * The Cognito app client only allows http://localhost:4200/ as a callback, so
 * the app must be served on exactly this origin for any test that signs in.
 */
const baseURL = 'http://localhost:4200';
const ci = !!process.env['CI'];

export default defineConfig({
  testDir: './e2e',
  // `.e2e.ts`, not `.spec.ts`: `ng test` picks up `**/*.spec.ts` from the project root.
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  workers: ci ? 2 : undefined,
  reporter: ci
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm start',
    url: baseURL,
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
});
