import { expect, test } from './support/fixtures';
import { expectAccessible } from './support/a11y';
import { managedEvent } from './support/data';
import { customer, signInAs } from './support/session';

test('a signed-out visitor can browse published events', async ({ page, api }) => {
  api
    .on('GET', 'event/events', { json: { events: [managedEvent()] } })
    .on('GET', 'event/events/7', { json: { event: managedEvent() } });

  await page.goto('/events');

  const card = page.getByRole('listitem').filter({ hasText: 'E2E Summer Concert' });
  await expect(card).toContainText('60 out of 100 seats remaining');
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('navigation')).toHaveCount(0);
  await expect(footer.getByRole('link')).toHaveAttribute(
    'href',
    'mailto:onestagecontacts@gmail.com',
  );
  await expectAccessible(page);
});

test('reports unavailable events instead of an empty list', async ({ page, api }) => {
  api.on('GET', 'event/events', { status: 500, json: { error: 'boom' } });

  await page.goto('/events');

  await expect(page.getByRole('alert')).toContainText('Events are unavailable right now.');
});

for (const tier of ['TIER1_GA', 'TIER2_SEATED']) {
  test(`${tier}: included completed and sold-out events come before available events`, async ({
    page,
    api,
  }) => {
    const event = managedEvent({ tier, remaining_qty: 0 });
    const availableEvent = managedEvent({ event_id: 8, tier, title: 'Tickets available' });
    const completedEvent = managedEvent({
      event_id: 9,
      tier,
      title: 'Completed show',
      starts_at: '2020-01-01T12:00:00Z',
    });
    const completedSoldOutEvent = managedEvent({
      ...completedEvent,
      event_id: 10,
      title: 'Completed sold-out show',
      remaining_qty: 0,
    });
    api
      .on('GET', 'event/events', {
        json: { events: [availableEvent, event, completedEvent, completedSoldOutEvent] },
      })
      .on('GET', 'event/events/7', { json: { event } })
      .on('GET', 'event/events/8', { json: { event: availableEvent } })
      .on('GET', 'event/events/9', { json: { event: completedEvent } })
      .on('GET', 'event/events/10', { json: { event: completedSoldOutEvent } });

    await page.goto('/events');
    const card = page.getByRole('listitem').filter({ hasText: event.title });
    await expect(card).toHaveCount(0);
    await expect(page.getByRole('link', { name: availableEvent.title, exact: true })).toBeVisible();
    await expect(page.locator('.count')).toHaveText('1 events');
    const includeSoldOut = page.getByRole('checkbox', { name: 'Include sold out events' });
    await expect(includeSoldOut).not.toBeChecked();
    await includeSoldOut.check();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Sold out');
    await expect(card.getByRole('link')).toHaveCount(0);
    await expect(page.locator('.count')).toHaveText('2 events');
    const titles = page.locator('.event-card h3');
    await expect(titles).toHaveText([event.title, availableEvent.title]);
    const includeCompleted = page.getByRole('checkbox', { name: 'Include completed events' });
    await includeCompleted.check();
    await expect(titles).toHaveText([
      completedEvent.title,
      completedSoldOutEvent.title,
      event.title,
      availableEvent.title,
    ]);
    await expect(page.locator('.count')).toHaveText('4 events');
    await expectAccessible(page);
    await includeSoldOut.uncheck();
    await expect(card).toHaveCount(0);
    await expect(titles).toHaveText([
      completedEvent.title,
      completedSoldOutEvent.title,
      availableEvent.title,
    ]);
    await includeCompleted.uncheck();
    await expect(titles).toHaveText([availableEvent.title]);
    await expect(page.locator('.count')).toHaveText('1 events');
    await expectAccessible(page);
  });

  test(`${tier}: browse, queue, select tickets and leave without an event-detail page`, async ({
    page,
    api,
  }) => {
    await signInAs(page, customer);
    const event = managedEvent({ tier, organiser_sub: 'someone-else' });
    let admitted = false;
    api
      .on('GET', 'event/events', { json: { events: [event] } })
      .on('GET', 'event/events/7', { json: { event } })
      .on('GET', 'event/team-invitations', { json: { invitations: [] } })
      .on('GET', 'ticket/customers/me/tickets', { json: { tickets: [] } })
      .on('GET', 'order/customers/me/orders', { json: { orders: [] } })
      .on('GET', 'queue/events/7/queue', { json: { queue: { status: 'OPEN' } } })
      .on('POST', 'queue/events/7/queue/join', {
        json: { queueEntryId: 71, status: 'WAITING', position: 1 },
      })
      .on('GET', 'queue/events/7/queue/me', () => ({
        json: admitted
          ? {
              queueEntryId: 71,
              status: 'ADMITTED',
              admissionToken: 'test-admission',
              tokenExpiresAt: new Date(Date.now() + 600_000).toISOString(),
            }
          : { queueEntryId: 71, status: 'WAITING', position: 1 },
      }))
      .on('DELETE', 'queue/events/7/queue/me', { json: {} })
      .on('GET', 'inventory/events/7/zones', { json: { zones: [] } })
      .on('GET', 'inventory/events/7/seats', {
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

    await page.goto('/events');
    const card = page.getByRole('listitem').filter({ hasText: event.title });
    await expect(page.getByRole('contentinfo').getByRole('navigation')).toHaveCount(0);
    await expect(card.getByRole('link', { name: event.title, exact: true })).toHaveAttribute(
      'href',
      '/events/7/queue',
    );
    await card.getByRole('link', { name: 'Buy ticket', exact: true }).click();
    await expect(page).toHaveURL(/\/events\/7\/queue$/);
    await expect(page.getByRole('button', { name: 'Leave queue', exact: true })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Leave queue', exact: true }).click();
    await expect(page).toHaveURL(/\/events$/);

    admitted = true;
    await page.getByRole('link', { name: 'Buy ticket', exact: true }).click();
    await expect(page).toHaveURL(/\/events\/7\/tickets$/);
    await expect(page.getByRole('button', { name: 'Buy tickets', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join queue', exact: true })).toHaveCount(0);
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Release my place', exact: true }).click();
    await expect(page).toHaveURL(/\/events$/);

    admitted = false;
    await page.goto('/events/7');
    await expect(page).toHaveURL(/\/events\/7\/queue$/);
    await expect(page.getByRole('button', { name: 'Leave queue', exact: true })).toBeVisible();
    expect(api.requests('DELETE', 'queue/events/7/queue/me')).toHaveLength(2);
  });
}

for (const failure of ['summary', 'join']) {
  test(`a sold-out queue reported by ${failure} returns to all events`, async ({ page, api }) => {
    await signInAs(page, customer);
    const event = managedEvent();
    api
      .on('GET', 'event/events', { json: { events: [event] } })
      .on('GET', 'event/events/7', { json: { event } })
      .on('GET', 'event/team-invitations', { json: { invitations: [] } })
      .on('GET', 'order/customers/me/orders', { json: { orders: [] } })
      .on('GET', 'queue/events/7/queue', {
        json: { queue: { status: failure === 'summary' ? 'DRAINED' : 'OPEN' } },
      })
      .on('POST', 'queue/events/7/queue/join', {
        status: 409,
        json: { error: 'queue_drained' },
      });

    await page.goto('/events/7/queue');
    await expect(page).toHaveURL(/\/events\?availability=sold-out$/);
    await expect(page.getByRole('status')).toContainText('This event is sold out.');
    await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
    await expect(page.getByText('This queue has closed', { exact: true })).toHaveCount(0);
    await expectAccessible(page);
  });
}
