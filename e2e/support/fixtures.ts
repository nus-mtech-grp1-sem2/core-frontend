import { test as base } from '@playwright/test';

import { MockApi } from './api';

/**
 * `test` with a per-test API stub. Unmocked API calls fail the test at the end.
 * Sign a user in with `signInAs(page, user)` from ./session before `page.goto`.
 */
export const test = base.extend<{ api: MockApi; hermetic: void }>({
  // Nothing in this tier may reach the internet. Web fonts are the one thing the app asks for
  // outside its own origin; they are refused so the page falls back to system fonts (the CSS asks
  // for `display=swap`), and any other outside request fails the test.
  hermetic: [
    async ({ context }, use) => {
      const outside: string[] = [];
      await context.route(/^https?:\/\/(?!localhost[:/])/, (route) => {
        const url = route.request().url();
        if (!/^https:\/\/fonts\.g(oogleapis|static)\.com\//.test(url)) outside.push(url);
        return route.abort();
      });
      await use();
      if (outside.length > 0) {
        throw new Error(
          `Requests to the internet from a hermetic test:\n${outside.map((url) => `  ${url}`).join('\n')}`,
        );
      }
    },
    { auto: true },
  ],

  api: async ({ page }, use) => {
    const api = new MockApi();
    await api.install(page);
    await use(api);
    api.expectNoUnhandled();
  },
});

export { expect } from '@playwright/test';
