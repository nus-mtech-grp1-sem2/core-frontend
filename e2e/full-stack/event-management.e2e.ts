import { expect, test, type Page } from '@playwright/test';

import { accessToken } from './support/auth';
import { createEvent, publishEvent, signedInPage } from './support/events';
import { buyGaTicket, callAs, createPublishedGaEvent } from './support/orders';
import { assertLocalStack, sql } from './support/stack';
import { credentials } from './support/users';

// The organiser's event management against the real backend: drawing the seat map with the mouse,
// editing what an event allows as it moves from draft to on sale to cancelled, and its photo.
// Titles carry a run id because the local database keeps events between runs.
const runId = Date.now().toString(36);

/** A 1x1 PNG: a valid image. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => assertLocalStack());

interface Zone {
  inventoryItemId: number;
  name: string;
  priceCents: number;
  gridRow: number;
  gridCol: number;
  gridRowSpan: number;
  gridColSpan: number;
  soldCount: number;
}
interface Inventory {
  gridRows: number;
  gridCols: number;
  zones: Zone[];
  seats: { seatLabel: string; status: string }[];
}

const inventoryOf = async (page: Page, eventId: number): Promise<Inventory> => {
  const response = await callAs(
    page.request,
    'organiser',
    'get',
    `/api/inventory/events/${eventId}/inventory`,
  );
  expect(response.ok(), `inventory GET -> ${response.status()}`).toBe(true);
  return (await response.json()) as Inventory;
};

const cell = (page: Page, row: number, col: number) =>
  page.locator(`[data-grid-row="${row}"][data-grid-col="${col}"]`);

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await cell(page, ...from).hover();
  await page.mouse.down();
  await cell(page, ...to).hover();
  await page.mouse.up();
}

const zoneCard = (page: Page, index: number) => page.locator('.zone-card').nth(index);

test.describe('the seat map', () => {
  const title = `E2E Seat Map ${runId}`;
  let eventId = 0;

  test('zones drawn with the mouse become seats with their own prices', async ({ browser }) => {
    const page = await signedInPage(browser, 'organiser');
    eventId = await createEvent(page, { title, tier: 'TIER2_SEATED' });

    await page.goto(`/organiser/events/${eventId}/inventory`);
    await drag(page, [0, 0], [1, 3]); // 2 rows x 4 columns
    await zoneCard(page, 0).getByLabel('Zone name').fill('Stalls');
    await zoneCard(page, 0).getByLabel('Price per seat').fill('20');
    await drag(page, [3, 0], [3, 2]); // 1 row x 3 columns
    await zoneCard(page, 1).getByLabel('Zone name').fill('Balcony');
    await zoneCard(page, 1).getByLabel('Price per seat').fill('10.5');
    await expect(zoneCard(page, 0)).toContainText('8 seats');
    await expect(zoneCard(page, 1)).toContainText('3 seats');
    await page.getByRole('button', { name: 'Save inventory' }).click();
    await page.waitForURL('**/organiser/events');

    const inventory = await inventoryOf(page, eventId);
    expect(inventory.zones.map((z) => [z.name, z.priceCents, z.gridRow, z.gridCol])).toEqual([
      ['Stalls', 2000, 0, 0],
      ['Balcony', 1050, 3, 0],
    ]);
    expect(inventory.seats).toHaveLength(11);
    expect(new Set(inventory.seats.map((seat) => seat.seatLabel)).size).toBe(11);
    expect(inventory.seats.every((seat) => seat.status === 'AVAILABLE')).toBe(true);

    // The event's own seat count follows the zones.
    const details = await callAs(page.request, 'organiser', 'get', `/api/event/events/${eventId}`);
    expect(((await details.json()) as { event: { total_seats: number } }).event.total_seats).toBe(
      11,
    );
    await page.context().close();
  });

  test('the saved layout comes back, and moving and resizing it re-lays the seats', async ({
    browser,
  }) => {
    const page = await signedInPage(browser, 'organiser');
    await page.goto(`/organiser/events/${eventId}/inventory`);
    await expect(zoneCard(page, 0).getByLabel('Zone name')).toHaveValue('Stalls');
    await expect(zoneCard(page, 1).getByLabel('Zone name')).toHaveValue('Balcony');
    await expect(zoneCard(page, 1).getByLabel('Price per seat')).toHaveValue('10.5');

    // Pull the Stalls' bottom-right corner out one column and move the Balcony a row down.
    await drag(page, [1, 3], [1, 4]);
    await drag(page, [3, 1], [4, 1]);
    await expect(zoneCard(page, 0)).toContainText('10 seats');
    await page.getByRole('button', { name: 'Save inventory' }).click();
    await page.waitForURL('**/organiser/events');

    const inventory = await inventoryOf(page, eventId);
    expect(inventory.zones.map((z) => [z.name, z.gridRow, z.gridCol, z.gridColSpan])).toEqual([
      ['Stalls', 0, 0, 5],
      ['Balcony', 4, 0, 3],
    ]);
    expect(inventory.seats).toHaveLength(13);
    await page.context().close();
  });

  test('once on sale, zones can still be added, and the page says so', async ({ browser }) => {
    const page = await signedInPage(browser, 'organiser');
    await publishEvent(page, title);

    await page.goto(`/organiser/events/${eventId}/inventory`);
    await expect(
      page.getByText('This event is on sale. You can add or remove seats'),
    ).toBeVisible();
    await drag(page, [5, 0], [5, 1]);
    await zoneCard(page, 2).getByLabel('Zone name').fill('Standing');
    await zoneCard(page, 2).getByLabel('Price per seat').fill('5');
    await page.getByRole('button', { name: 'Save inventory' }).click();
    await page.waitForURL('**/organiser/events');

    const inventory = await inventoryOf(page, eventId);
    expect(inventory.zones.map((z) => z.name)).toEqual(['Stalls', 'Balcony', 'Standing']);
    expect(inventory.seats).toHaveLength(15);
    await page.context().close();
  });

  test('a zone with a sold seat cannot be removed or made smaller, and can be renamed', async ({
    browser,
  }) => {
    const page = await signedInPage(browser, 'organiser');
    // Selling a seat takes the waiting room and a checkout (covered by reserved-seating); here the
    // seat is marked sold in the disposable local database so the editor's rules can be tested.
    const stalls = (await inventoryOf(page, eventId)).zones[0];
    sql(
      `UPDATE event_inventory.seats SET status = 'SOLD'
        WHERE event_id = ${eventId} AND inventory_item_id = ${stalls.inventoryItemId} ORDER BY seat_id LIMIT 1`,
    );

    await page.goto(`/organiser/events/${eventId}/inventory`);
    await expect(zoneCard(page, 0)).toContainText('10 seats');
    await expect(zoneCard(page, 0).getByRole('button', { name: 'Remove' })).toBeDisabled();
    await expect(zoneCard(page, 1).getByRole('button', { name: 'Remove' })).toBeEnabled();
    // Its edges cannot be dragged: a drag from its corner resizes nothing.
    await drag(page, [1, 4], [1, 2]);
    await expect(zoneCard(page, 0)).toContainText('10 seats');

    // The backend enforces it too, whatever the page does.
    const before = await inventoryOf(page, eventId);
    const payload = (zones: object[]) => ({
      zones,
      gridRows: before.gridRows,
      gridCols: before.gridCols,
    });
    const asPayload = (zone: Zone, over: object = {}) => ({
      inventoryItemId: zone.inventoryItemId,
      name: zone.name,
      price: zone.priceCents / 100,
      color: '#2563eb',
      gridRow: zone.gridRow,
      gridCol: zone.gridCol,
      gridRowSpan: zone.gridRowSpan,
      gridColSpan: zone.gridColSpan,
      ...over,
    });
    const put = (body: object) =>
      callAs(page.request, 'organiser', 'put', `/api/inventory/events/${eventId}/inventory`, body);
    const [first, ...others] = before.zones;
    const shrink = await put(
      payload([asPayload(first, { gridColSpan: 2 }), ...others.map((z) => asPayload(z))]),
    );
    expect(shrink.status()).toBe(409);
    expect(((await shrink.json()) as { error: string }).error).toBe('cannot_modify_committed_seat');
    const drop = await put(payload(others.map((z) => asPayload(z))));
    expect(drop.status()).toBe(409);
    expect((await inventoryOf(page, eventId)).seats).toHaveLength(before.seats.length);

    // A rename goes through, and the sold seat stays sold.
    await zoneCard(page, 0).getByLabel('Zone name').fill('Front stalls');
    await page.getByRole('button', { name: 'Save inventory' }).click();
    await page.waitForURL('**/organiser/events');
    const after = await inventoryOf(page, eventId);
    expect(after.zones[0].name).toBe('Front stalls');
    expect(after.zones[0].soldCount).toBe('1');
    expect(after.seats.filter((seat) => seat.status === 'SOLD')).toHaveLength(1);
    await page.context().close();
  });
});

test.describe('general admission zones', () => {
  test('a zone with a sale in it cannot be removed', async ({ browser }) => {
    const page = await signedInPage(browser, 'organiser');
    const eventId = await createPublishedGaEvent(page.request, `E2E GA Sold ${runId}`, 6);
    await buyGaTicket(page.request, 'customer', eventId, {
      name: 'Casey Customer',
      email: credentials('customer').email,
    });

    await page.goto(`/organiser/events/${eventId}/inventory`);

    await expect(zoneCard(page, 0).getByRole('button', { name: 'Remove' })).toBeDisabled();
    await page.context().close();
  });

  test('the event page counts its seats and what has sold', async ({ browser }) => {
    const page = await signedInPage(browser, 'organiser');
    const eventId = await createPublishedGaEvent(page.request, `E2E GA Summary ${runId}`, 6);
    await buyGaTicket(page.request, 'customer', eventId, {
      name: 'Casey Customer',
      email: credentials('customer').email,
    });

    await page.goto(`/organiser/events/${eventId}`);

    await expect(page.getByText('1 zone · 6 seats, 1 sold')).toBeVisible();
    await page.context().close();
  });
});

test.describe('capacity below the available buyers', () => {
  test('is refused with a 4xx the organiser can act on', async ({ browser }) => {
    const page = await signedInPage(browser, 'organiser');
    // createPublishedGaEvent sets available buyers equal to the seats.
    const eventId = await createPublishedGaEvent(page.request, `E2E Buyers ${runId}`, 6);
    const zone = (await inventoryOf(page, eventId)).zones[0];

    const shrink = await callAs(
      page.request,
      'organiser',
      'put',
      `/api/inventory/events/${eventId}/inventory`,
      {
        zones: [
          {
            inventoryItemId: zone.inventoryItemId,
            name: zone.name,
            price: zone.priceCents / 100,
            color: '#2563eb',
            gridRow: 0,
            gridCol: 0,
            gridRowSpan: 1,
            gridColSpan: 3,
          },
        ],
        gridRows: 1,
        gridCols: 6,
      },
    );

    expect(shrink.status()).toBeGreaterThanOrEqual(400);
    expect(shrink.status()).toBeLessThan(500);
    await page.context().close();
  });
});

test.describe('an event through its life', () => {
  const title = `E2E Lifecycle ${runId}`;
  const renamed = `E2E Lifecycle Renamed ${runId}`;
  let eventId = 0;

  const publicTitles = async (page: Page): Promise<string[]> => {
    const response = await page.request.get('/api/event/events');
    expect(response.ok()).toBe(true);
    return ((await response.json()) as { events: { event_name: string }[] }).events.map(
      (e) => e.event_name,
    );
  };

  test('a draft can be edited, given a photo and is not on the public list', async ({
    browser,
  }) => {
    const page = await signedInPage(browser, 'organiser');
    eventId = await createEvent(page, { title, tier: 'TIER1_GA' });

    await page.goto(`/organiser/events/${eventId}`);
    await page.getByLabel('Title').fill(renamed);
    await page.getByLabel('Venue').fill('Renamed Hall');
    await page.getByLabel('Description').fill('Edited by the e2e suite');
    await page
      .getByLabel('Event photo')
      .setInputFiles({ name: 'poster.png', mimeType: 'image/png', buffer: PNG });
    const uploaded = page.waitForResponse(
      (r) => r.url().endsWith(`/events/${eventId}/image`) && r.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Save changes' }).click();
    expect((await uploaded).ok()).toBe(true);
    await expect(page.getByRole('heading', { name: renamed })).toBeVisible();

    // What was saved is what the service now holds, photo included.
    const saved = await callAs(page.request, 'organiser', 'get', `/api/event/events/${eventId}`);
    expect(((await saved.json()) as { event: Record<string, unknown> }).event).toMatchObject({
      title: renamed,
      venue: 'Renamed Hall',
      description: 'Edited by the e2e suite',
      status: 'DRAFT',
    });
    const photo = await page.request.get(`/api/event/events/${eventId}/image`);
    expect(photo.status()).toBe(200);
    expect(photo.headers()['content-type']).toBe('image/png');
    expect((await photo.body()).equals(PNG)).toBe(true);

    // A draft is invisible to customers.
    expect(await publicTitles(page)).not.toContain(renamed);
    await page.context().close();
  });

  test('a draft with no inventory cannot be published, and the page says why', async ({
    browser,
  }) => {
    const page = await signedInPage(browser, 'organiser');
    await page.goto('/organiser/events');
    const card = page.getByRole('listitem').filter({ hasText: renamed });
    page.once('dialog', (dialog) => void dialog.accept());
    await card.getByRole('button', { name: 'Publish' }).click();

    await expect(page.getByRole('alert')).toContainText('Configure inventory before publishing');
    await expect(card).not.toContainText('On sale');
    await page.context().close();
  });

  test('another draft can be deleted, after asking', async ({ browser }) => {
    const page = await signedInPage(browser, 'organiser');
    const doomed = `E2E Doomed Draft ${runId}`;
    const doomedId = await createEvent(page, { title: doomed, tier: 'TIER1_GA' });

    await page.goto(`/organiser/events/${doomedId}`);
    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.getByRole('button', { name: 'Delete draft' }).click();
    expect(sql(`SELECT COUNT(*) FROM event_inventory.events WHERE event_id = ${doomedId}`)).toBe(
      '1',
    );

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete draft' }).click();
    await page.waitForURL('**/organiser/events');
    await expect(page.getByRole('listitem').filter({ hasText: doomed })).toHaveCount(0);
    expect(sql(`SELECT COUNT(*) FROM event_inventory.events WHERE event_id = ${doomedId}`)).toBe(
      '0',
    );
    await page.context().close();
  });

  test('once published the event is public and its details are locked', async ({ browser }) => {
    const page = await signedInPage(browser, 'organiser');
    await callAs(page.request, 'organiser', 'put', `/api/inventory/events/${eventId}/inventory`, {
      zones: [
        {
          inventoryItemId: null,
          name: 'General admission',
          price: 5,
          color: '#2563eb',
          gridRow: 0,
          gridCol: 0,
          gridRowSpan: 1,
          gridColSpan: 10,
        },
      ],
      gridRows: 1,
      gridCols: 10,
    });
    await publishEvent(page, renamed);
    expect(await publicTitles(page)).toContain(renamed);

    await page.goto(`/organiser/events/${eventId}`);
    await expect(page.getByText('This event has already been published')).toBeVisible();
    await expect(page.getByLabel('Title')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Delete draft' })).toHaveCount(0);

    // The backend refuses the same edit, whatever the page allows, and a published event cannot be deleted.
    const edit = await callAs(page.request, 'organiser', 'put', `/api/event/events/${eventId}`, {
      title: 'Sneaky rename',
      venue: 'X',
      startsAt: '2099-01-01T10:00',
      tier: 'TIER1_GA',
    });
    expect(edit.status()).toBe(409);
    expect(((await edit.json()) as { error: string }).error).toBe('event_not_editable');
    const removal = await page.request.delete(`/api/event/events/${eventId}`, {
      headers: { Authorization: `Bearer ${accessToken('organiser')}` },
    });
    expect(removal.status()).toBe(409);
    await page.context().close();
  });

  test('cancelling takes it off sale and re-publishing puts it back', async ({ browser }) => {
    const page = await signedInPage(browser, 'organiser');
    await page.goto(`/organiser/events/${eventId}`);

    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.getByRole('button', { name: 'Cancel event' }).click();
    expect(await publicTitles(page)).toContain(renamed);

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Cancel event' }).click();
    await expect(page.getByRole('button', { name: 'Re-publish event' })).toBeVisible();
    expect(await publicTitles(page)).not.toContain(renamed);

    // Nobody can buy or queue for a cancelled event.
    const order = await callAs(page.request, 'customer', 'post', '/api/order/orders', {
      eventId,
      quantity: 1,
      customerEmail: 'e2e@example.com',
      customerName: 'E2E',
    });
    expect(order.status()).toBe(409);
    expect(((await order.json()) as { error: string }).error).toBe('event_not_on_sale');

    // The organiser's inventory editor is locked too.
    await page.goto(`/organiser/events/${eventId}/inventory`);
    await expect(page.getByText('This event has been cancelled')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save inventory' })).toBeDisabled();

    await page.goto(`/organiser/events/${eventId}`);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Re-publish event' }).click();
    await expect(page.getByRole('button', { name: 'Cancel event' })).toBeVisible();
    expect(await publicTitles(page)).toContain(renamed);
    await page.context().close();
  });
});
