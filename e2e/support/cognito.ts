import { createHash } from 'node:crypto';

import type { Page } from '@playwright/test';

import { testTokens, type TestTokens, type TestUser } from './session';

/** Must match `domain` in src/app/app.config.ts: the Cognito hosted UI the app redirects to. */
export const COGNITO_DOMAIN = 'ap-southeast-1cgmx4fpo2.auth.ap-southeast-1.amazoncognito.com';
export const CLIENT_ID = 'gh94lqsterju3qoffje1grep8';

export interface StubOptions {
  /** Who Cognito says signed in when the app trades a code for tokens. */
  readonly user: TestUser;
  /** Answer the token endpoint with this error instead of tokens. */
  readonly tokenError?: 'invalid_grant';
  /** Answer a refresh with "the refresh token has expired". */
  readonly refreshExpired?: boolean;
}

/** What the stand-in Cognito was asked, in order. */
export interface CognitoCalls {
  /** The tokens it hands out, so a test can tell they are the ones the app then uses. */
  readonly issued: TestTokens;
  readonly authorize: URL[];
  readonly signUp: URL[];
  readonly tokens: URLSearchParams[];
  readonly logout: URL[];
  readonly idp: { readonly target: string; readonly body: string }[];
}

/**
 * Stands in for Cognito's hosted UI and its token API, so the app's sign-in, sign-up, callback,
 * refresh and sign-out can be run without a network or a real account. The hosted pages are a
 * placeholder; what matters is what the app sends and what it does with the answers.
 */
export async function stubCognito(page: Page, options: StubOptions): Promise<CognitoCalls> {
  const tokens = testTokens(options.user);
  const calls: CognitoCalls = {
    issued: tokens,
    authorize: [],
    signUp: [],
    tokens: [],
    logout: [],
    idp: [],
  };

  await page.route(`https://${COGNITO_DOMAIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    switch (url.pathname) {
      case '/oauth2/authorize':
        calls.authorize.push(url);
        return route.fulfill({ contentType: 'text/html', body: '<h1>Hosted sign in</h1>' });
      case '/signup':
        calls.signUp.push(url);
        return route.fulfill({ contentType: 'text/html', body: '<h1>Hosted sign up</h1>' });
      case '/oauth2/token':
        calls.tokens.push(new URLSearchParams(request.postData() ?? ''));
        if (options.tokenError) {
          return route.fulfill({ status: 400, json: { error: options.tokenError } });
        }
        return route.fulfill({
          json: {
            id_token: tokens.idToken,
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken,
            token_type: 'Bearer',
            expires_in: 3600,
          },
        });
      case '/logout':
        calls.logout.push(url);
        // Cognito ends its session and sends the browser to `logout_uri`.
        return route.fulfill({
          status: 302,
          headers: { location: url.searchParams.get('logout_uri') ?? '/' },
        });
      default:
        return route.fulfill({ status: 404, body: 'not stubbed' });
    }
  });

  await page.route('https://cognito-idp.*.amazonaws.com/**', async (route) => {
    const request = route.request();
    const target = (request.headers()['x-amz-target'] ?? '').split('.').pop() ?? '';
    calls.idp.push({ target, body: request.postData() ?? '' });
    if (target === 'GetTokensFromRefreshToken' || target === 'InitiateAuth') {
      if (options.refreshExpired) {
        return route.fulfill({
          status: 400,
          contentType: 'application/x-amz-json-1.1',
          body: JSON.stringify({
            __type: 'NotAuthorizedException',
            message: 'Refresh Token has expired',
          }),
        });
      }
      return route.fulfill({
        contentType: 'application/x-amz-json-1.1',
        body: JSON.stringify({
          AuthenticationResult: {
            AccessToken: tokens.accessToken,
            IdToken: tokens.idToken,
            ExpiresIn: 3600,
            TokenType: 'Bearer',
          },
        }),
      });
    }
    return route.fulfill({ contentType: 'application/x-amz-json-1.1', body: '{}' });
  });

  return calls;
}

/** The PKCE challenge the app must have derived from the verifier it later sends. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Signs in the way a person does: opens the sign-in page, follows the redirect to the hosted UI,
 * and comes back to the app the way Cognito sends the browser back, with a code and the state the
 * app made. Returns once the app has traded the code for tokens.
 */
export async function signInThroughHostedUi(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: /Continue to sign in/ }).click();
  await page.waitForURL(new RegExp(COGNITO_DOMAIN));
  const state = new URL(page.url()).searchParams.get('state');
  await page.goto(`/?code=stub-code&state=${state}`);
  await page.getByRole('button', { name: 'Sign out' }).waitFor();
}
