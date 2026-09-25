import { test as base } from '@playwright/test';

import { MockApi } from './api';

/**
 * `test` with a per-test API stub. Unmocked API calls fail the test at the end.
 * Sign a user in with `signInAs(page, user)` from ./session before `page.goto`.
 */
export const test = base.extend<{ api: MockApi }>({
  api: async ({ page }, use) => {
    const api = new MockApi();
    await api.install(page);
    await use(api);
    api.expectNoUnhandled();
  },
});

export { expect } from '@playwright/test';
