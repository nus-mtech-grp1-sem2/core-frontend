import { mkdir, writeFile } from 'node:fs/promises';

import { expect, test, type Browser } from '@playwright/test';

import { useSession } from './support/auth';
import { createPublishedGaEvent } from './support/orders';
import { assertLocalStack } from './support/stack';
import type { Role } from './support/users';

const roles: readonly Role[] = ['customer', 'customer2', 'helper'];
const title = `E2E Browser Load ${Date.now().toString(36)}`;

interface BrowserTiming {
  readonly role: Role;
  readonly browseToCheckoutMs: number;
  readonly checkoutToPaidMs: number;
  readonly totalMs: number;
}

async function buyThroughBrowser(browser: Browser, role: Role): Promise<BrowserTiming> {
  const context = await browser.newContext();
  await useSession(context, role);
  const page = await context.newPage();
  const startedAt = performance.now();
  try {
    await page.goto('/events');
    await page.getByRole('link', { name: title }).first().click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await page.getByLabel('Quantity').fill('1');
    await page.getByRole('button', { name: /Buy tickets/ }).click();
    await page.waitForURL(/\/checkout\/\d+/);
    const checkoutAt = performance.now();

    await page.getByLabel('Card number').fill('4242424242424242');
    await page.getByLabel('Expiry date').fill('12/99');
    await page.getByLabel('CVC').fill('123');
    await page.getByRole('button', { name: /^Pay/ }).click();
    await page.waitForURL(/\/my-events/, { timeout: 60_000 });
    await expect(page.getByRole('article').filter({ hasText: title })).toHaveCount(1, {
      timeout: 60_000,
    });
    const completedAt = performance.now();
    return {
      role,
      browseToCheckoutMs: Math.round(checkoutAt - startedAt),
      checkoutToPaidMs: Math.round(completedAt - checkoutAt),
      totalMs: Math.round(completedAt - startedAt),
    };
  } finally {
    await context.close();
  }
}

test('three retained users complete the buyer UI journey concurrently', async ({
  browser,
  request,
}) => {
  assertLocalStack();
  await createPublishedGaEvent(request, title, 20);

  const timings = await Promise.all(roles.map((role) => buyThroughBrowser(browser, role)));
  expect(timings).toHaveLength(roles.length);
  expect(timings.every((timing) => timing.totalMs > 0)).toBe(true);

  const totals = timings.map((timing) => timing.totalMs).sort((a, b) => a - b);
  const evidence = {
    generatedAt: new Date().toISOString(),
    scenario: 'D-browser-overlay',
    browserUsers: roles.length,
    successfulJourneys: timings.length,
    totalMs: {
      min: totals[0],
      median: totals[Math.floor(totals.length / 2)],
      max: totals[totals.length - 1],
    },
    timings,
    constraints: {
      target: 'local disposable full stack',
      payment: 'simulated',
      cognitoUsers: 'retained existing accounts only',
      traces: 'disabled',
    },
  };
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/buyer-load-evidence.json',
    `${JSON.stringify(evidence, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
});
