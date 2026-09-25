import { expect, test } from './support/fixtures';
import { expectAccessible } from './support/a11y';
import { order, ticket } from './support/data';
import { customer, signInAs } from './support/session';

test.beforeEach(async ({ page, api }) => {
  await signInAs(page, customer);
  api.on('GET', 'event/helper/shifts', { json: { events: [] } });
});

test('shows the signed-in customer and their ticket with a QR code', async ({ page, api }) => {
  api
    .on('GET', 'ticket/customers/me/tickets', { json: { tickets: [ticket()] } })
    .on('GET', 'order/customers/me/orders', { json: { orders: [order()] } });

  await page.goto('/my-events');

  await expect(page.getByText(customer.email)).toBeVisible();
  const card = page.getByRole('article').filter({ hasText: 'E2E Summer Concert' });
  await expect(card).toContainText('Marina Bay Arena');
  await expect(card).toContainText('Ready to scan');
  await expect(card.getByRole('img', { name: 'QR code for ticket 501' })).toBeVisible();
  await expectAccessible(page);
});

test('shows a checked-in ticket as checked in', async ({ page, api }) => {
  api
    .on('GET', 'ticket/customers/me/tickets', {
      json: { tickets: [ticket({ status: 'CHECKED_IN' })] },
    })
    .on('GET', 'order/customers/me/orders', { json: { orders: [order()] } });

  await page.goto('/my-events');

  await expect(page.getByRole('article').filter({ hasText: 'E2E Summer Concert' })).toContainText(
    'Checked in',
  );
});

test('says so when the customer has no tickets', async ({ page, api }) => {
  api
    .on('GET', 'ticket/customers/me/tickets', { json: { tickets: [] } })
    .on('GET', 'order/customers/me/orders', { json: { orders: [] } });

  await page.goto('/my-events');

  await expect(page.getByRole('heading', { name: 'No tickets yet' })).toBeVisible();
  await expectAccessible(page);
});

test('reports a failure to load tickets instead of an empty list', async ({ page, api }) => {
  api
    .on('GET', 'ticket/customers/me/tickets', { status: 500, json: { error: 'boom' } })
    .on('GET', 'order/customers/me/orders', { json: { orders: [] } });

  await page.goto('/my-events');

  await expect(page.getByRole('alert')).toContainText("Couldn't load your tickets.");
  await expect(page.getByRole('heading', { name: 'No tickets yet' })).toHaveCount(0);
});
