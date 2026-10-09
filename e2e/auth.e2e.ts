import type { Page } from '@playwright/test';

import type { MockApi } from './support/api';
import { managedEvent, order, ticket } from './support/data';
import { expect, test } from './support/fixtures';
import {
  CLIENT_ID,
  COGNITO_DOMAIN,
  pkceChallenge,
  signInThroughHostedUi,
  stubCognito,
} from './support/cognito';
import { customer, testTokens } from './support/session';

// Sign-in, sign-up and sign-out happen on Cognito's hosted pages, not in this app: the app sends
// the browser there, takes it back, trades the code for tokens, and keeps them. Cognito is stood
// in for (support/cognito), so what is tested is exactly that: what the app sends, and what it
// does with each answer. Real Cognito is exercised by full-stack/auth-session.e2e.ts.

const TOKEN_PREFIX = `CognitoIdentityServiceProvider.${CLIENT_ID}`;

/** What signed-in pages ask for; the home page is where Cognito sends the browser back to. */
function stubBrowsing(api: MockApi) {
  api
    .on('GET', 'event/events', { json: { events: [managedEvent()] } })
    .on('GET', 'event/venues', { json: { venues: [] } })
    .on('GET', 'ticket/customers/me/tickets', { json: { tickets: [ticket()] } })
    .on('GET', 'order/customers/me/orders', { json: { orders: [order()] } });
}

const storedKeys = (page: Page, storage: 'sessionStorage' | 'localStorage') =>
  page.evaluate((name) => Object.keys(window[name as 'sessionStorage']), storage);

// The footer offers "Sign in" whoever is looking, so only the header says who is signed in.
const signInLink = (page: Page) => page.getByRole('banner').getByRole('link', { name: 'Login' });

test.describe('going to Cognito', () => {
  test('sign in sends the browser to the hosted sign-in with a PKCE challenge and state', async ({
    page,
  }) => {
    const cognito = await stubCognito(page, { user: customer });
    await page.goto('/login');

    await page.getByRole('button', { name: /Continue to sign in/ }).click();
    await page.waitForURL(new RegExp(COGNITO_DOMAIN));

    expect(cognito.authorize).toHaveLength(1);
    const query = cognito.authorize[0].searchParams;
    expect(query.get('client_id')).toBe(CLIENT_ID);
    expect(query.get('response_type')).toBe('code');
    expect(query.get('redirect_uri')).toBe('http://localhost:4200/');
    expect(query.get('scope')?.split(' ').sort()).toEqual(['email', 'openid', 'phone', 'profile']);
    expect(query.get('code_challenge_method')).toBe('S256');
    expect(query.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(query.get('state')?.length).toBeGreaterThanOrEqual(16);
    expect(cognito.signUp).toHaveLength(0);
  });

  test('sign up sends the browser to the hosted sign-up instead', async ({ page }) => {
    const cognito = await stubCognito(page, { user: customer });
    await page.goto('/register');

    await page.getByRole('button', { name: /Continue to sign up/ }).click();
    await page.waitForURL(new RegExp(COGNITO_DOMAIN));

    expect(cognito.signUp).toHaveLength(1);
    expect(cognito.authorize).toHaveLength(0);
    const query = cognito.signUp[0].searchParams;
    expect(query.get('client_id')).toBe(CLIENT_ID);
    expect(query.get('response_type')).toBe('code');
    expect(query.get('redirect_uri')).toBe('http://localhost:4200/');
    expect(query.get('code_challenge_method')).toBe('S256');
    expect(cognito.signUp[0].protocol).toBe('https:');
  });

  test('every attempt gets its own state and challenge', async ({ page }) => {
    const cognito = await stubCognito(page, { user: customer });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.goto('/login');
      await page.getByRole('button', { name: /Continue to sign in/ }).click();
      await page.waitForURL(new RegExp(COGNITO_DOMAIN));
    }

    const [first, second] = cognito.authorize.map((url) => url.searchParams);
    expect(first.get('state')).not.toBe(second.get('state'));
    expect(first.get('code_challenge')).not.toBe(second.get('code_challenge'));
  });

  test('the old confirmation address just leads to sign in', async ({ page }) => {
    await page.goto('/confirm');

    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('coming back signed in', () => {
  test('the code is traded for tokens with the PKCE verifier, and the visitor is signed in', async ({
    page,
    api,
  }) => {
    stubBrowsing(api);
    const cognito = await stubCognito(page, { user: customer });

    await signInThroughHostedUi(page);

    expect(cognito.tokens).toHaveLength(1);
    const exchange = cognito.tokens[0];
    expect(exchange.get('grant_type')).toBe('authorization_code');
    expect(exchange.get('code')).toBe('stub-code');
    expect(exchange.get('client_id')).toBe(CLIENT_ID);
    expect(exchange.get('redirect_uri')).toBe('http://localhost:4200/');
    // The verifier hashes to the challenge sent at the start: only this browser can finish it.
    expect(pkceChallenge(exchange.get('code_verifier') ?? '')).toBe(
      cognito.authorize[0].searchParams.get('code_challenge'),
    );

    await expect(page.getByText(customer.email)).toBeVisible();
    await expect(signInLink(page)).toHaveCount(0);
    // The one-time code and state are not left in the address bar.
    expect(page.url()).toBe('http://localhost:4200/');
  });

  test('tokens are kept for the tab only and sent to the API as a bearer token', async ({
    page,
    api,
  }) => {
    stubBrowsing(api);
    const cognito = await stubCognito(page, { user: customer });

    await signInThroughHostedUi(page);
    await page.goto('/my-events');
    await expect(page.getByRole('article').first()).toBeVisible();

    const keys = await storedKeys(page, 'sessionStorage');
    expect(keys.filter((key) => key.endsWith('.accessToken'))).toHaveLength(1);
    expect(keys.filter((key) => key.endsWith('.refreshToken'))).toHaveLength(1);
    // Nothing that can be used to act as the user outlives the tab.
    expect((await storedKeys(page, 'localStorage')).filter((key) => /Token$/.test(key))).toEqual(
      [],
    );

    const [tickets] = api.requests('GET', 'ticket/customers/me/tickets');
    expect(await tickets.headerValue('authorization')).toBe(`Bearer ${cognito.issued.accessToken}`);
  });

  test('a callback whose state was not made by this browser is refused', async ({ page, api }) => {
    stubBrowsing(api);
    const cognito = await stubCognito(page, { user: customer });

    await page.goto('/?code=stub-code&state=not-the-state-we-sent');

    await expect(signInLink(page)).toBeVisible();
    expect(cognito.tokens).toHaveLength(0);
    expect(await storedKeys(page, 'sessionStorage')).toEqual([]);
  });

  test('Cognito refusing the code leaves the visitor signed out and the site usable', async ({
    page,
    api,
  }) => {
    stubBrowsing(api);
    await stubCognito(page, { user: customer, tokenError: 'invalid_grant' });
    await page.goto('/login');
    await page.getByRole('button', { name: /Continue to sign in/ }).click();
    await page.waitForURL(new RegExp(COGNITO_DOMAIN));
    const state = new URL(page.url()).searchParams.get('state');

    await page.goto(`/?code=used-or-expired&state=${state}`);

    await expect(signInLink(page)).toBeVisible();
    await expect(page.getByText('E2E Summer Concert').first()).toBeVisible();
    expect(await storedKeys(page, 'sessionStorage')).toEqual([]);
  });

  test('a sign-in Cognito reports as failed leaves the visitor signed out', async ({
    page,
    api,
  }) => {
    stubBrowsing(api);
    const cognito = await stubCognito(page, { user: customer });
    await page.goto('/login');
    await page.getByRole('button', { name: /Continue to sign in/ }).click();
    await page.waitForURL(new RegExp(COGNITO_DOMAIN));
    const state = new URL(page.url()).searchParams.get('state');

    await page.goto(`/?error=access_denied&error_description=Denied&state=${state}`);

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('Sign-in was cancelled.')).toBeVisible();
    await expect(signInLink(page)).toBeVisible();
    expect(cognito.tokens).toHaveLength(0);
  });

  test('after signing in, the visitor goes back to where they were headed', async ({
    page,
    api,
  }) => {
    stubBrowsing(api);
    await stubCognito(page, { user: customer });

    await page.goto('/my-events');
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fmy-events$/);
    await page.getByRole('button', { name: /Continue to sign in/ }).click();
    await page.waitForURL(new RegExp(COGNITO_DOMAIN));
    const state = new URL(page.url()).searchParams.get('state');
    await page.goto(`/?code=stub-code&state=${state}`);

    await expect(page).toHaveURL(/\/my-events$/);
  });

  test('an unsafe return URL is ignored after signing in', async ({ page, api }) => {
    stubBrowsing(api);
    await stubCognito(page, { user: customer });

    await page.goto('/login?returnUrl=https%3A%2F%2Fevil.example');
    await page.getByRole('button', { name: /Continue to sign in/ }).click();
    await page.waitForURL(new RegExp(COGNITO_DOMAIN));
    const state = new URL(page.url()).searchParams.get('state');
    await page.goto(`/?code=stub-code&state=${state}`);

    await expect(page).toHaveURL('http://localhost:4200/');
    await expect(page.getByText('E2E Summer Concert').first()).toBeVisible();
  });
});

test.describe('a session that has run out', () => {
  /** Signed-in storage whose tokens have already expired, seeded once so sign-out can clear it. */
  async function seedExpiredSession(page: Page) {
    const tokens = testTokens(customer, -600);
    const username = customer.sub;
    await page.addInitScript(
      ({ entries }) => {
        if (sessionStorage.getItem('e2e-seeded')) return;
        sessionStorage.setItem('e2e-seeded', '1');
        for (const [key, value] of Object.entries(entries)) sessionStorage.setItem(key, value);
      },
      {
        entries: {
          [`${TOKEN_PREFIX}.LastAuthUser`]: username,
          [`${TOKEN_PREFIX}.${username}.idToken`]: tokens.idToken,
          [`${TOKEN_PREFIX}.${username}.accessToken`]: tokens.accessToken,
          [`${TOKEN_PREFIX}.${username}.refreshToken`]: tokens.refreshToken,
          [`${TOKEN_PREFIX}.${username}.clockDrift`]: '0',
        },
      },
    );
  }

  test('is renewed with the refresh token without the visitor noticing', async ({ page, api }) => {
    stubBrowsing(api);
    const cognito = await stubCognito(page, { user: customer });
    await seedExpiredSession(page);

    await page.goto('/my-events');

    await expect(page.getByRole('article').first()).toBeVisible();
    await expect(page).toHaveURL(/\/my-events$/);
    const refresh = cognito.idp.filter(({ target }) => target === 'GetTokensFromRefreshToken');
    expect(refresh).toHaveLength(1);
    expect(JSON.parse(refresh[0].body)).toMatchObject({
      ClientId: CLIENT_ID,
      RefreshToken: testTokens(customer).refreshToken,
    });
  });

  test('sends the visitor to sign in when the refresh token has expired too', async ({
    page,
    api,
  }) => {
    stubBrowsing(api);
    await stubCognito(page, { user: customer, refreshExpired: true });
    await seedExpiredSession(page);

    await page.goto('/my-events');

    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fmy-events$/);
    await expect(page.getByRole('button', { name: /Continue to sign in/ })).toBeVisible();
  });
});

test.describe('signing out', () => {
  test('ends the Cognito session too, clears the tab, and protected pages ask for sign in again', async ({
    page,
    api,
  }) => {
    stubBrowsing(api);
    const cognito = await stubCognito(page, { user: customer });
    await signInThroughHostedUi(page);
    expect((await storedKeys(page, 'sessionStorage')).length).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Sign out' }).click();

    // Without visiting Cognito's logout the hosted page would sign the next person straight in.
    await expect.poll(() => cognito.logout.length).toBe(1);
    expect(cognito.logout[0].searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(cognito.logout[0].searchParams.get('logout_uri')).toBe('http://localhost:4200/');
    await expect(signInLink(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    expect(await storedKeys(page, 'sessionStorage')).toEqual([]);
    expect(await storedKeys(page, 'localStorage')).toEqual([]);

    await page.goto('/my-events');
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fmy-events$/);
  });

  test('a second sign-in after signing out starts a fresh exchange', async ({ page, api }) => {
    stubBrowsing(api);
    const cognito = await stubCognito(page, { user: customer });
    await signInThroughHostedUi(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(signInLink(page)).toBeVisible();

    await signInThroughHostedUi(page);

    expect(cognito.tokens).toHaveLength(2);
    expect(cognito.authorize).toHaveLength(2);
    await expect(page.getByText(customer.email)).toBeVisible();
  });
});
