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
  projects: [
    // Hermetic tier: the API is stubbed, nothing external is needed. This is what CI runs.
    {
      name: 'mocked',
      testIgnore: '**/full-stack/**',
      use: { ...devices['Desktop Chrome'] },
    },
    // Full-stack tier: real Cognito sign-in and the local backend (see README). Signs each
    // test account in once, then the journey tests reuse those sessions.
    {
      name: 'full-stack-setup',
      testMatch: '**/full-stack/auth.setup.e2e.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'full-stack',
      testMatch: '**/full-stack/**/*.e2e.ts',
      testIgnore: '**/full-stack/auth.setup.e2e.ts',
      dependencies: ['full-stack-setup'],
      fullyParallel: false,
      timeout: 120_000,
      // Traces record request headers, which here carry real Cognito tokens.
      use: { ...devices['Desktop Chrome'], trace: 'off' },
    },
  ],
  webServer: {
    command: 'npm start',
    url: baseURL,
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
});
