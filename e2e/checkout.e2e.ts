import { expect, test } from './support/fixtures';
import { expectAccessible } from './support/a11y';
import { inDays } from './support/data';
import { customer, signInAs } from './support/session';

const ORDER_ID = 301;
const CARD = '4242424242424242';

function pendingOrder(status = 'PENDING') {
  return {
    order_id: ORDER_ID,
    event_id: 7,
    status,
    currency: 'SGD',
    total_amount_cents: 5000,
    reservation_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    items: [
      { order_item_id: 1, description: 'General admission', quantity: 2, unit_price_cents: 2500 },
    ],
  };
}

test.beforeEach(async ({ page, api }) => {
  await signInAs(page, customer);
  api.on('GET', 'event/events/7', {
    json: {
      event: {
        title: 'E2E Summer Concert',
        venue: 'Marina Bay Arena',
        starts_at: inDays(14),
        tier: 'TIER1_GA',
      },
    },
  });
});

test('an already-paid order needs no further payment', async ({ page, api }) => {
  api.on('GET', `order/orders/${ORDER_ID}`, { json: { order: pendingOrder('PAID') } });

  await page.goto(`/checkout/${ORDER_ID}`);

  await expect(page.getByRole('heading', { name: 'Payment complete' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View my tickets' })).toBeVisible();
});

test('shows the order summary and payment form for a reservation', async ({ page, api }) => {
  api.on('GET', `order/orders/${ORDER_ID}`, { json: { order: pendingOrder() } });

  await page.goto(`/checkout/${ORDER_ID}`);

  await expect(page.getByRole('heading', { name: 'Order summary' })).toBeVisible();
  // The line item is rendered twice (ticket-type chip and summary line).
  await expect(page.getByText('General admission').first()).toBeVisible();
  await expect(page.getByLabel('Card number')).toBeVisible();
  await expectAccessible(page);
});

test('rejects malformed card details without contacting the order service', async ({
  page,
  api,
}) => {
  api.on('GET', `order/orders/${ORDER_ID}`, { json: { order: pendingOrder() } });
  await page.goto(`/checkout/${ORDER_ID}`);

  await page.getByLabel('Card number').fill('1234');
  await page.getByLabel('Expiry date').fill('13/99');
  await page.getByLabel('CVC').fill('12');
  await page.getByRole('button', { name: /^Pay/ }).click();

  await expect(page.getByText('Enter exactly 3 digits.')).toBeVisible();
  expect(api.requests('POST', `order/orders/${ORDER_ID}/payment-requests`)).toHaveLength(0);
});

test('submits only a placeholder token, never the card details', async ({ page, api }) => {
  api
    .on('GET', `order/orders/${ORDER_ID}`, { json: { order: pendingOrder() } })
    .on('POST', `order/orders/${ORDER_ID}/payment-requests`, {
      json: { order: pendingOrder(), paymentStatus: 'PROCESSING' },
    });
  await page.goto(`/checkout/${ORDER_ID}`);

  await page.getByLabel('Card number').fill(CARD);
  await page.getByLabel('Expiry date').fill('12/99');
  await page.getByLabel('CVC').fill('123');
  await page.getByRole('button', { name: /^Pay/ }).click();

  await expect(page.getByRole('button', { name: /Processing/ })).toBeVisible();
  const [request] = api.requests('POST', `order/orders/${ORDER_ID}/payment-requests`);
  expect(request.postDataJSON()).toEqual({ paymentToken: 'simulated' });
  expect(request.postData()).not.toContain(CARD);
});
