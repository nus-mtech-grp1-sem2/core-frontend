import type { Page } from '@playwright/test';

/**
 * Must match `userPoolClientId` in src/app/app.config.ts: Amplify namespaces its
 * stored tokens by app client id. A mismatch shows up as every signed-in test
 * being treated as signed out.
 */
const CLIENT_ID = 'gh94lqsterju3qoffje1grep8';
const ISSUER = 'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_test';

export interface TestUser {
  readonly sub: string;
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
}

export const customer: TestUser = {
  sub: '00000000-0000-4000-8000-000000000001',
  email: 'customer@example.test',
  givenName: 'Casey',
  familyName: 'Customer',
};

export const helper: TestUser = {
  sub: '00000000-0000-4000-8000-000000000002',
  email: 'helper@example.test',
  givenName: 'Harper',
  familyName: 'Helper',
};

export const organiser: TestUser = {
  sub: '00000000-0000-4000-8000-000000000003',
  email: 'organiser@example.test',
  givenName: 'Olive',
  familyName: 'Organiser',
};

/**
 * An unsigned JWT. The browser only decodes tokens (Amplify does not verify the
 * signature); the real check happens in the backend, which these tests never
 * reach. Never usable against a real service.
 */
function unsignedJwt(payload: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none', typ: 'JWT' })}.${part(payload)}.test-signature`;
}

export interface TestTokens {
  readonly idToken: string;
  readonly accessToken: string;
  readonly refreshToken: string;
}

/** Unsigned tokens for `user`, as Cognito's token endpoint would return them. */
export function testTokens(user: TestUser, lifetimeSeconds = 3600): TestTokens {
  const now = Math.floor(Date.now() / 1000);
  const common = { sub: user.sub, iss: ISSUER, iat: now, exp: now + lifetimeSeconds };
  const username = user.sub;

  return {
    idToken: unsignedJwt({
      ...common,
      token_use: 'id',
      aud: CLIENT_ID,
      email: user.email,
      given_name: user.givenName,
      family_name: user.familyName,
      'cognito:username': username,
    }),
    accessToken: unsignedJwt({
      ...common,
      token_use: 'access',
      client_id: CLIENT_ID,
      username,
      scope: 'openid email phone',
    }),
    refreshToken: 'test-refresh-token',
  };
}

/**
 * Makes the app believe `user` is signed in, without contacting Cognito.
 *
 * The app keeps its Amplify tokens in `sessionStorage` (see app.config.ts), which
 * Playwright's saved `storageState` does not capture, so they are written by an
 * init script that runs before the app boots.
 */
export async function signInAs(page: Page, user: TestUser): Promise<void> {
  const { idToken, accessToken, refreshToken } = testTokens(user);
  const username = user.sub;

  const prefix = `CognitoIdentityServiceProvider.${CLIENT_ID}`;
  const entries: Record<string, string> = {
    [`${prefix}.LastAuthUser`]: username,
    [`${prefix}.${username}.idToken`]: idToken,
    [`${prefix}.${username}.accessToken`]: accessToken,
    [`${prefix}.${username}.refreshToken`]: refreshToken,
    [`${prefix}.${username}.clockDrift`]: '0',
  };

  await page.addInitScript((values) => {
    try {
      for (const [key, value] of Object.entries(values)) {
        window.sessionStorage.setItem(key, value);
      }
    } catch {
      // Storage is unavailable on some frames (about:blank); the app frame is what matters.
    }
  }, entries);
}
