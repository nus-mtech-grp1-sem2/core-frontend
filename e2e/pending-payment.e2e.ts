import { expect, test } from './support/fixtures';
import { managedEvent, order } from './support/data';
import { customer, signInAs } from './support/session';

for (const tier of ['TIER1_GA', 'TIER2_SEATED']) {
  test(`${tier}: Buy ticket resumes the existing payment from Events and Home`, async ({
    page,
    api,
  }) => {
    await signInAs(page, customer);
    const event = managedEvent({ tier, organiser_sub: 'another-owner' });
    const pending = order({
      order_id: 77,
      status: 'PENDING',
      paid_at: null,
      reservation_expires_at: new Date(Date.now() + 600_000).toISOString(),
      items: [
        { order_item_id: 1, description: 'Reserved ticket', quantity: 1, unit_price_cents: 2500 },
      ],
    });
    let cancelled = false;
    api
      .on('GET', 'event/events', { json: { events: [event] } })
      .on('GET', 'event/events/7', { json: { event } })
      .on('GET', 'event/venues', { json: { venues: [] } })
      .on('GET', 'event/team-invitations', { json: { invitations: [] } })
      .on('GET', 'ticket/customers/me/tickets', { json: { tickets: [] } })
      .on('GET', 'order/customers/me/orders', () => ({
        json: { orders: cancelled ? [] : [pending] },
      }))
      .on('GET', 'order/orders/77', { json: { order: pending } })
      .on('POST', 'order/orders/77/cancel', () => {
        cancelled = true;
        return { json: {} };
      });
    await page.goto('/events');
    const card = page.locator('.event-card');
    const buy = card.getByRole('link', { name: 'Buy ticket', exact: true });
    await expect(buy).toHaveAttribute('href', '/checkout/77');
    await expect(card.getByRole('link', { name: event.title, exact: true })).toHaveAttribute(
      'href',
      '/checkout/77',
    );
    await buy.click();
    await expect(page).toHaveURL(/\/checkout\/77$/);
    await expect(page.getByLabel('Card number')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your active bookings' })).toHaveCount(0);
    await page.locator('app-header .brand').click();
    const heroBuy = page
      .locator('.slide.active')
      .getByRole('link', { name: 'Buy ticket', exact: true });
    await expect(heroBuy).toHaveAttribute('href', '/checkout/77');
    await heroBuy.click();
    await expect(page).toHaveURL(/\/checkout\/77$/);
    expect(api.requests('POST', 'queue/events/7/queue/join')).toHaveLength(0);
    expect(api.requests('POST', 'order/orders')).toHaveLength(0);
    await page
      .getByRole('complementary', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Events', exact: true })
      .click();
    await page.getByRole('button', { name: 'Cancel reservation', exact: true }).click();
    await expect(buy).toHaveAttribute('href', '/events/7/queue');
    await expect(page.getByRole('region', { name: 'Your active bookings' })).toHaveCount(0);
  });
}
