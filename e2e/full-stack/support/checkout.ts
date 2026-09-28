import type { Page } from '@playwright/test';

/** Fills the (simulated) card form on the checkout page and pays. */
export async function payAtCheckout(page: Page): Promise<void> {
  await page.waitForURL(/\/checkout\/\d+/);
  await page.getByLabel('Card number').fill('4242424242424242');
  await page.getByLabel('Expiry date').fill('12/99');
  await page.getByLabel('CVC').fill('123');
  await page.getByRole('button', { name: /^Pay/ }).click();
}
