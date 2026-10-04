import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';

import { credentials, type Role } from './users';

const AUTH_DIR = 'e2e/.auth';
const sessionFile = (role: Role) => `${AUTH_DIR}/${role}.session.json`;

type SessionEntries = Record<string, string>;

/** Signs in through Cognito Managed Login (a two-step form) and returns the app's session. */
export async function signInThroughCognito(page: Page, role: Role): Promise<SessionEntries> {
  const { email, password } = credentials(role);
  await page.goto('/login');
  await page.getByRole('button', { name: /Continue to sign in/ }).click();
  await page.waitForURL(/amazoncognito\.com/);
  await page.locator('input[name="username"]').fill(email);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]:visible').click();
  await page.waitForURL(/localhost:4200/);
  await page.getByText(email).first().waitFor();

  // Amplify keeps its tokens in sessionStorage, which Playwright's storageState does not save.
  return page.evaluate(() =>
    Object.fromEntries(
      Object.keys(sessionStorage)
        .filter((key) => key.startsWith('CognitoIdentityServiceProvider.'))
        .map((key) => [key, sessionStorage.getItem(key) ?? '']),
    ),
  );
}

export function saveSession(role: Role, entries: SessionEntries): void {
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(sessionFile(role), JSON.stringify(entries), { mode: 0o600 });
}

function loadSession(role: Role): SessionEntries {
  try {
    return JSON.parse(readFileSync(sessionFile(role), 'utf8')) as SessionEntries;
  } catch {
    throw new Error(`No saved session for "${role}". Run the full-stack-setup project first.`);
  }
}

/** Signs `context` in as `role` from the session saved by the setup project. */
export async function useSession(context: BrowserContext, role: Role): Promise<void> {
  const entries = loadSession(role);
  await context.addInitScript((values) => {
    // Seed only when absent so tokens Amplify has since refreshed are not overwritten.
    for (const [key, value] of Object.entries(values)) {
      if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, value);
    }
  }, entries);
}

/** The current access token for `role`, e.g. for direct API calls that set up test data. */
export function accessToken(role: Role): string {
  const entries = loadSession(role);
  const key = Object.keys(entries).find((name) => name.endsWith('.accessToken'));
  if (!key) throw new Error(`Saved session for "${role}" has no access token.`);
  return entries[key];
}

/** The Cognito user id (`sub`) for `role`, read from its saved id token. */
export function userSub(role: Role): string {
  const entries = loadSession(role);
  const key = Object.keys(entries).find((name) => name.endsWith('.idToken'));
  if (!key) throw new Error(`Saved session for "${role}" has no id token.`);
  const payload = entries[key].split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
  const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as { sub?: string };
  if (!claims.sub) throw new Error(`Saved id token for "${role}" has no sub claim.`);
  return claims.sub;
}
