import { expect, test } from './support/fixtures';
import { expectAccessible } from './support/a11y';
import { managedEvent } from './support/data';
import { organiser, signInAs } from './support/session';

test.beforeEach(async ({ page }) => {
  await signInAs(page, organiser);
});

test.describe('sales', () => {
  test('lists each event with what it has sold', async ({ page, api }) => {
    api
      .on('GET', 'event/events/manage', {
        json: {
          events: [
            managedEvent(),
            managedEvent({ event_id: 8, title: 'E2E Sold Out Show', remaining_qty: 0 }),
          ],
        },
      })
      .on('GET', 'order/events/7/orders/summary', {
        json: { paidOrders: 12, ticketsSold: 40, revenueCents: 100000 },
      })
      .on('GET', 'order/events/8/orders/summary', {
        json: { paidOrders: 30, ticketsSold: 100, revenueCents: 250000 },
      });

    await page.goto('/organiser/sales');

    const open = page.getByRole('row').filter({ hasText: 'E2E Summer Concert' });
    await expect(open).toContainText('40');
    await expect(open).toContainText('On sale');
    const soldOut = page.getByRole('row').filter({ hasText: 'E2E Sold Out Show' });
    await expect(soldOut).toContainText('100');
    await expect(soldOut).toContainText('Sold out');
    await expectAccessible(page);
  });

  test('reports a failure to load instead of empty figures', async ({ page, api }) => {
    api.on('GET', 'event/events/manage', { status: 500, json: { error: 'boom' } });

    await page.goto('/organiser/sales');

    await expect(page.getByRole('alert')).toContainText("Couldn't load sales figures.");
  });
});

test.describe('attendees', () => {
  test('shows who bought tickets for the selected event', async ({ page, api }) => {
    api
      .on('GET', 'event/events/manage', { json: { events: [managedEvent()] } })
      .on('GET', 'order/events/7/attendees', {
        json: {
          attendees: [
            {
              order_id: 301,
              customer_email: 'buyer@example.test',
              paid_at: new Date().toISOString(),
              description: 'General admission',
              quantity: 2,
              seat_id: null,
            },
          ],
        },
      });

    await page.goto('/organiser/attendees');

    const row = page.getByRole('row').filter({ hasText: 'buyer@example.test' });
    await expect(row).toContainText('General admission');
    await expect(row).toContainText('2');
    await expectAccessible(page);
  });

  test('says so when nobody has bought a ticket', async ({ page, api }) => {
    api
      .on('GET', 'event/events/manage', { json: { events: [managedEvent()] } })
      .on('GET', 'order/events/7/attendees', { json: { attendees: [] } });

    await page.goto('/organiser/attendees');

    await expect(page.getByText('No one has bought a ticket for this event yet.')).toBeVisible();
  });

  test('reports a failure to load attendees', async ({ page, api }) => {
    api
      .on('GET', 'event/events/manage', { json: { events: [managedEvent()] } })
      .on('GET', 'order/events/7/attendees', { status: 500, json: { error: 'boom' } });

    await page.goto('/organiser/attendees');

    await expect(page.getByRole('alert')).toContainText("Couldn't load attendees.");
  });
});
