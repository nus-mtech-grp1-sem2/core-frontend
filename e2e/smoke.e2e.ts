import { expect, test } from './support/fixtures';

test.beforeEach(async ({ page }) => {
  // Keep the smoke test hermetic: no backend is running, so answer every gateway call.
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable_in_smoke_test' } }),
  );
});

test('home page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/OneStage/);
});

for (const path of ['/my-events', '/helper', '/checkin', '/organiser/events']) {
  test(`${path} redirects a signed-out visitor to sign in`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?returnUrl=/);
  });
}
