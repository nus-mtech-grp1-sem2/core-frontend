import { expect, test, type Page } from '@playwright/test';

import { signInThroughCognito } from './support/auth';
import { assertLocalStack } from './support/stack';
import { credentials } from './support/users';

// The parts of sign-in that only real Cognito can answer: what its tokens contain, that its hosted
// session really ends on sign-out, and that a real refresh token renews an expired session and the
// backend accepts the result. The mocked tier (e2e/auth.e2e.ts) covers what the app sends and does.
// These sign in interactively as customer2 (a fresh browser session; the other accounts' saved
// sessions are unaffected) and never print or store the tokens.

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => assertLocalStack());

type Claims = Readonly<Record<string, unknown>>;

/** The payload of the stored token whose key ends with `suffix` (`idToken` or `accessToken`). */
async function storedClaims(page: Page, suffix: string): Promise<Claims> {
  return page.evaluate((wanted) => {
    const key = Object.keys(sessionStorage).find((name) => name.endsWith(`.${wanted}`));
    if (!key) throw new Error(`no stored ${wanted}`);
    const payload = (sessionStorage.getItem(key) ?? '')
      .split('.')[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  }, suffix);
}

test('signing in through Cognito gives tokens with the name, email and scopes the app relies on', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInThroughCognito(page, 'customer2');

  const id = await storedClaims(page, 'idToken');
  const access = await storedClaims(page, 'accessToken');
  expect(id['email']).toBe(credentials('customer2').email);
  // The door looks attendees up by name, which the ID token only carries with the profile scope.
  expect(typeof id['name']).toBe('string');
  expect((id['name'] as string).trim().length).toBeGreaterThan(0);
  expect(String(access['scope']).split(' ')).toEqual(
    expect.arrayContaining(['openid', 'email', 'profile']),
  );
  expect(access['client_id']).toBe('gh94lqsterju3qoffje1grep8');
  expect(String(access['iss'])).toContain('ap-southeast-1_cgmx4fpO2');
  expect(id['sub']).toBe(access['sub']);

  // The app keeps them for the tab only.
  const local = await page.evaluate(() => Object.keys(localStorage));
  expect(local.filter((key) => /Token$/.test(key))).toEqual([]);
  await context.close();
});

test('an expired session is renewed with the real refresh token and the backend accepts it', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInThroughCognito(page, 'customer2');
  const before = await storedClaims(page, 'accessToken');

  // Make the stored tokens look expired (the signature is not checked in the browser).
  await page.evaluate(() => {
    for (const key of Object.keys(sessionStorage)) {
      if (!key.endsWith('.accessToken') && !key.endsWith('.idToken')) continue;
      const [header, payload, signature] = (sessionStorage.getItem(key) ?? '').split('.');
      const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Record<
        string,
        unknown
      >;
      claims['exp'] = Math.floor(Date.now() / 1000) - 600;
      const forged = btoa(JSON.stringify(claims))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
      sessionStorage.setItem(key, `${header}.${forged}.${signature}`);
    }
  });

  const refreshed = page.waitForRequest(
    (request) =>
      request.url().includes('cognito-idp.') &&
      (request.headers()['x-amz-target'] ?? '').endsWith('GetTokensFromRefreshToken'),
  );
  const tickets = page.waitForResponse((response) =>
    response.url().endsWith('/api/ticket/customers/me/tickets'),
  );
  await page.goto('/my-events');

  await refreshed;
  const response = await tickets;
  expect(response.status(), 'the backend accepts the renewed token').toBe(200);
  await expect(page).toHaveURL(/\/my-events$/);
  const after = await storedClaims(page, 'accessToken');
  expect(Number(after['exp'])).toBeGreaterThan(Math.floor(Date.now() / 1000));
  expect(after['jti']).not.toBe(before['jti']);
  await context.close();
});

test('signing out ends the Cognito session, so the next sign-in asks for a password again', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInThroughCognito(page, 'customer2');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/localhost:4200/);
  await expect(page.getByRole('banner').getByRole('link', { name: 'Login' })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);

  // Cognito's own cookie is gone: the hosted page shows the sign-in form instead of signing
  // the next person in as customer2 without a password.
  await page.goto('/login');
  await page.getByRole('button', { name: /Continue to sign in/ }).click();
  await page.waitForURL(/amazoncognito\.com/);
  await expect(page.locator('input[name="username"]').first()).toBeVisible();
  // Still on Cognito's page, not bounced back to the app already signed in.
  expect(new URL(page.url()).hostname).toMatch(/\.amazoncognito\.com$/);
  await context.close();
});
