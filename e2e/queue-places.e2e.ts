import { expect, test } from './support/fixtures';
import { expectAccessible } from './support/a11y';
import { managedEvent, order } from './support/data';
import { customer, signInAs } from './support/session';

for (const width of [1280, 390]) {
  test(`retained queue places form a neat independent stack at ${width}px`, async ({
    page,
    api,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await signInAs(page, customer);
    const events = [
      managedEvent({ title: 'Summer Concert', organiser_sub: 'another-owner' }),
      managedEvent({
        event_id: 8,
        title: 'Autumn Concert',
        tier: 'TIER2_SEATED',
        organiser_sub: 'another-owner',
      }),
    ];
    const expiry = new Date(Date.now() + 600_000).toISOString();
    const reservation = order({
      order_id: 400,
      event_id: 9,
      event_title: 'Christmas Party',
      status: 'PENDING',
      reservation_expires_at: expiry,
      paid_at: null,
    });
    const released = new Set<number>();
    api
      .on('GET', 'event/events', { json: { events } })
      .on('GET', 'event/venues', { json: { venues: [] } })
      .on('GET', 'event/team-invitations', { json: { invitations: [] } })
      .on('GET', 'ticket/customers/me/tickets', { json: { tickets: [] } })
      .on('GET', 'order/customers/me/orders', { json: { orders: [reservation] } });
    for (const event of events) {
      const id = event.event_id;
      const admission = {
        queueEntryId: id,
        status: 'ADMITTED',
        admissionToken: `test-token-${id}`,
        tokenExpiresAt: expiry,
      };
      api
        .on('GET', `event/events/${id}`, { json: { event } })
        .on('GET', `queue/events/${id}/queue`, { json: { queue: { status: 'OPEN' } } })
        .on('POST', `queue/events/${id}/queue/join`, { json: admission })
        .on('GET', `queue/events/${id}/queue/me`, () => ({
          json: released.has(id) ? { queueEntryId: id, status: 'LEFT' } : admission,
        }))
        .on('DELETE', `queue/events/${id}/queue/me`, () => {
          released.add(id);
          return { json: {} };
        })
        .on('GET', `inventory/events/${id}/zones`, { json: { zones: [] } })
        .on('GET', `inventory/events/${id}/seats`, {
          json: {
            gridRows: 1,
            gridCols: 1,
            seats: [
              {
                seatId: 1,
                seatLabel: 'A1',
                gridRow: 0,
                gridCol: 0,
                inventoryItemId: 1,
                sectionName: 'Stalls',
                priceCents: 2500,
                color: '#2563EB',
                status: 'AVAILABLE',
                tag: 'NONE',
              },
            ],
          },
        });
    }
    await page.goto('/events');
    const sidebar = page.getByRole('complementary', { name: 'Workspace navigation' });
    for (const event of events) {
      const card = page.locator('.event-card').filter({ hasText: event.title });
      await card.getByRole('link', { name: 'Buy ticket', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/events/${event.event_id}/tickets$`));
      await expect(page.getByRole('button', { name: 'Buy tickets', exact: true })).toBeVisible();
      await sidebar.getByRole('link', { name: 'Events', exact: true }).click();
      await expect(page).toHaveURL(/\/events$/);
    }
    const stack = page.getByRole('region', { name: 'Your active bookings' });
    await expect(stack.locator('.place-card')).toHaveCount(2);
    await expect(stack.locator('.place-card h3')).toHaveText(['Summer Concert', 'Autumn Concert']);
    await expect(
      stack.getByRole('heading', { name: 'Your active bookings', exact: true }),
    ).toHaveCount(1);
    await expect(stack.locator('app-reservation-card')).toHaveCount(1);
    await expect(stack).toContainText('3 active');
    await expect(stack).toContainText('Christmas Party');
    const heroBox = await page.locator('.page-head').boundingBox();
    const stackBox = await stack.boundingBox();
    const toolbarBox = await page.locator('.toolbar').boundingBox();
    expect(stackBox!.y).toBeGreaterThanOrEqual(heroBox!.y + heroBox!.height);
    expect(stackBox!.y + stackBox!.height).toBeLessThanOrEqual(toolbarBox!.y);
    const boxes = await stack.locator('.place-card, .reservation-card').evaluateAll((cards) =>
      cards.map((card) => ({
        x: card.getBoundingClientRect().x,
        width: card.getBoundingClientRect().width,
        overflow: card.scrollWidth > card.clientWidth,
      })),
    );
    expect(boxes[0].x).toBe(boxes[1].x);
    expect(boxes[0].width).toBe(boxes[1].width);
    expect(boxes[0].x).toBe(boxes[2].x);
    expect(boxes[0].width).toBe(boxes[2].width);
    expect(boxes.every((box) => !box.overflow)).toBe(true);
    if (width > 720) {
      const sidebarBox = await sidebar.boundingBox();
      expect(sidebarBox!.y).toBeLessThan(heroBox!.y + heroBox!.height);
      expect(stackBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x + sidebarBox!.width);
      const actionColumns = await stack
        .locator('.place-actions, .reservation-actions')
        .evaluateAll((actions) => actions.map((element) => element.getBoundingClientRect().x));
      expect(new Set(actionColumns).size).toBe(1);
    }
    await expectAccessible(page);
    await stack.screenshot({ path: `test-results/queue-places-${width}.png` });
    await page.reload();
    await expect(stack.locator('.place-card')).toHaveCount(2);
    expect(api.requests('POST', 'queue/events/7/queue/join')).toHaveLength(1);
    expect(api.requests('POST', 'queue/events/8/queue/join')).toHaveLength(1);

    await page.locator('app-header .brand').click();
    await expect(stack.locator('.place-card')).toHaveCount(2);
    await expect(stack.locator('app-reservation-card')).toHaveCount(1);
    await expect(stack).toContainText('3 active');
    await expectAccessible(page);
    await sidebar.getByRole('link', { name: 'Events', exact: true }).click();

    await stack
      .getByRole('link', { name: 'Return to tickets for Summer Concert', exact: true })
      .click();
    await expect(page).toHaveURL(/\/events\/7\/tickets$/);
    await expect(stack).toHaveCount(0);
    expect(api.requests('POST', 'queue/events/7/queue/join')).toHaveLength(1);
    await sidebar.getByRole('link', { name: 'My events', exact: true }).click();
    await expect(stack.locator('.place-card')).toHaveCount(2);
    await expect(stack.locator('app-reservation-card')).toHaveCount(1);
    await expect(stack).toContainText('3 active');
    await expectAccessible(page);
    await stack
      .getByRole('button', { name: 'Release my place for Summer Concert', exact: true })
      .click();
    await expect(stack.locator('.place-card')).toHaveCount(1);
    await expect(stack).toContainText('Autumn Concert');
    expect(api.requests('DELETE', 'queue/events/7/queue/me')).toHaveLength(1);
    expect(api.requests('DELETE', 'queue/events/8/queue/me')).toHaveLength(0);
    await expect(page).toHaveURL(/\/my-events$/);

    const pendingOrder = {
      order_id: 301,
      event_id: 8,
      status: 'PENDING',
      currency: 'SGD',
      total_amount_cents: 2500,
      reservation_expires_at: expiry,
      items: [{ order_item_id: 1, description: 'Seat A1', quantity: 1, unit_price_cents: 2500 }],
    };
    api
      .on('POST', 'order/orders', { json: { order: pendingOrder } })
      .on('GET', 'order/orders/301', { json: { order: pendingOrder } });
    await stack
      .getByRole('link', { name: 'Return to tickets for Autumn Concert', exact: true })
      .click();
    await expect(page).toHaveURL(/\/events\/8\/tickets$/);
    await page.locator('button.seat').click();
    await page.getByRole('button', { name: 'Buy tickets', exact: true }).click();
    await expect(page).toHaveURL(/\/checkout\/301$/);
    await expect(stack).toHaveCount(0);
  });
}
