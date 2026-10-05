import type { Page } from '@playwright/test';

import { expect, test } from './support/fixtures';
import { managedEvent } from './support/data';
import { organiser, signInAs } from './support/session';

const EVENT_ID = 7;
const NO_NAME = 'Please enter group seat name.';

interface Zone {
  inventoryItemId: number;
  name: string;
  code: string;
  priceCents: number;
  color: string;
  seatCount: number;
  soldCount: number;
  heldCount: number;
  gridRow: number;
  gridCol: number;
  gridRowSpan: number;
  gridColSpan: number;
}

const zone = (overrides: Partial<Zone> = {}): Zone => ({
  inventoryItemId: 11,
  name: 'Stalls',
  code: 'A',
  priceCents: 1500,
  color: '#2563EB',
  seatCount: 6,
  soldCount: 0,
  heldCount: 0,
  gridRow: 0,
  gridCol: 0,
  gridRowSpan: 2,
  gridColSpan: 3,
  ...overrides,
});

/** Stubs the event and its inventory, as the editor loads them. */
function stubEditor(
  api: import('./support/api').MockApi,
  options: {
    event?: Record<string, unknown>;
    zones?: Zone[];
    gridRows?: number;
    gridCols?: number;
  } = {},
) {
  api
    .on('GET', `event/events/${EVENT_ID}`, {
      json: { event: managedEvent({ status: 'DRAFT', ...options.event }) },
    })
    .on('GET', `inventory/events/${EVENT_ID}/inventory`, {
      json: {
        gridRows: options.gridRows ?? 6,
        gridCols: options.gridCols ?? 8,
        zones: options.zones ?? [],
        seats: [],
      },
    })
    // Saving sends the organiser back to their event list.
    .on('GET', 'event/events/manage', { json: { events: [managedEvent({ status: 'DRAFT' })] } });
}

const cell = (page: Page, row: number, col: number) =>
  page.locator(`[data-grid-row="${row}"][data-grid-col="${col}"]`);

/** Draws (or drags) with the real mouse from one cell to another, as a person would. */
async function drag(page: Page, from: [number, number], to: [number, number]) {
  await cell(page, ...from).hover();
  await page.mouse.down();
  await cell(page, ...to).hover();
  await page.mouse.up();
}

const zoneCards = (page: Page) => page.locator('.zone-card');

test.beforeEach(async ({ page }) => {
  await signInAs(page, organiser);
});

test.describe('drawing zones', () => {
  test('dragging across empty cells draws a zone that is named, priced and saved', async ({
    page,
    api,
  }) => {
    stubEditor(api);
    api.on('PUT', `inventory/events/${EVENT_ID}/inventory`, { status: 204 });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);
    await expect(page.getByRole('heading', { name: 'Configure inventory' })).toBeVisible();
    await expect(page.getByText('No zones yet')).toBeVisible();

    // A 2 x 3 block from row 0, column 1.
    await drag(page, [0, 1], [1, 3]);

    await expect(zoneCards(page)).toHaveCount(1);
    await expect(zoneCards(page).first()).toContainText('6 capacity');
    await page.getByLabel('Zone name').fill('Floor');
    await page.getByLabel('Price per seat').fill('12.5');
    await page.getByRole('button', { name: 'Save inventory' }).click();

    await page.waitForURL('**/organiser/events');
    const [save] = api.requests('PUT', `inventory/events/${EVENT_ID}/inventory`);
    expect(save.postDataJSON()).toEqual({
      zones: [
        {
          inventoryItemId: null,
          name: 'Floor',
          price: 12.5,
          color: '#2563EB',
          gridRow: 0,
          gridCol: 1,
          gridRowSpan: 2,
          gridColSpan: 3,
        },
      ],
      gridRows: 6,
      gridCols: 8,
    });
  });

  test('a plain click on the map does not create a zone', async ({ page, api }) => {
    stubEditor(api);
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);

    await cell(page, 2, 2).click();

    await expect(zoneCards(page)).toHaveCount(0);
    await expect(page.getByText('No zones yet')).toBeVisible();
  });

  test('a zone cannot be drawn over another', async ({ page, api }) => {
    stubEditor(api, { zones: [zone()] });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);
    await expect(zoneCards(page)).toHaveCount(1);

    // From an empty cell across the existing zone.
    await drag(page, [3, 0], [0, 4]);

    await expect(page.getByRole('alert')).toContainText("Zones can't overlap");
    await expect(zoneCards(page)).toHaveCount(1);
  });

  test('a zone can be removed', async ({ page, api }) => {
    stubEditor(api, {
      zones: [zone(), zone({ inventoryItemId: 12, name: 'Balcony', gridRow: 3 })],
    });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);
    await expect(zoneCards(page)).toHaveCount(2);

    await expect(zoneCards(page).nth(1).getByLabel('Zone name')).toHaveValue('Balcony');
    await zoneCards(page).nth(1).getByRole('button', { name: 'Remove' }).click();

    await expect(zoneCards(page)).toHaveCount(1);
    await expect(zoneCards(page).first().getByLabel('Zone name')).toHaveValue('Stalls');
  });

  test('a zone is moved by dragging its body and resized by dragging its corner', async ({
    page,
    api,
  }) => {
    stubEditor(api);
    api.on('PUT', `inventory/events/${EVENT_ID}/inventory`, { status: 204 });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);
    await drag(page, [0, 0], [2, 2]); // 3 x 3
    await page.getByLabel('Zone name').fill('Pit');
    await expect(zoneCards(page).first()).toContainText('9 capacity');

    await drag(page, [1, 1], [1, 3]); // grab the middle, move two columns right
    await drag(page, [2, 4], [3, 5]); // pull the bottom-right corner out by one each way
    await expect(zoneCards(page).first()).toContainText('16 capacity');

    await page.getByRole('button', { name: 'Save inventory' }).click();
    await page.waitForURL('**/organiser/events');
    const [save] = api.requests('PUT', `inventory/events/${EVENT_ID}/inventory`);
    expect(save.postDataJSON().zones[0]).toMatchObject({
      name: 'Pit',
      gridRow: 0,
      gridCol: 2,
      gridRowSpan: 4,
      gridColSpan: 4,
    });
  });
});

test.describe('keyboard-accessible zone editing (no drag gesture needed)', () => {
  test('"Add zone" places a zone at the first empty cell', async ({ page, api }) => {
    stubEditor(api);
    api.on('PUT', `inventory/events/${EVENT_ID}/inventory`, { status: 204 });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);
    await expect(page.getByText('No zones yet')).toBeVisible();

    await page.getByRole('button', { name: 'Add zone' }).click();

    await expect(zoneCards(page)).toHaveCount(1);
    await expect(zoneCards(page).first()).toContainText('1 capacity');
    await page.getByLabel('Zone name').fill('Floor');
    await page.getByLabel('Price per seat').fill('12.5');
    await page.getByRole('button', { name: 'Save inventory' }).click();

    await page.waitForURL('**/organiser/events');
    const [save] = api.requests('PUT', `inventory/events/${EVENT_ID}/inventory`);
    expect(save.postDataJSON()).toEqual({
      zones: [
        {
          inventoryItemId: null,
          name: 'Floor',
          price: 12.5,
          color: '#2563EB',
          gridRow: 0,
          gridCol: 0,
          gridRowSpan: 1,
          gridColSpan: 1,
        },
      ],
      gridRows: 6,
      gridCols: 8,
    });
  });

  test('typing row/column/span numbers repositions and resizes a zone', async ({ page, api }) => {
    stubEditor(api);
    api.on('PUT', `inventory/events/${EVENT_ID}/inventory`, { status: 204 });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);
    await page.getByRole('button', { name: 'Add zone' }).click();
    await page.getByLabel('Zone name').fill('Floor');

    await page.getByLabel('Starting row index for zone 1').fill('2');
    await page.getByLabel('Starting column index for zone 1').fill('3');
    await page.getByLabel('Row span for zone 1').fill('2');
    await page.getByLabel('Column span for zone 1').fill('4');

    await expect(zoneCards(page).first()).toContainText('8 capacity');

    await page.getByRole('button', { name: 'Save inventory' }).click();
    await page.waitForURL('**/organiser/events');
    const [save] = api.requests('PUT', `inventory/events/${EVENT_ID}/inventory`);
    expect(save.postDataJSON().zones[0]).toMatchObject({
      gridRow: 2,
      gridCol: 3,
      gridRowSpan: 2,
      gridColSpan: 4,
    });
  });

  test('typing a position that would overlap another zone is rejected, leaving both zones where they were', async ({
    page,
    api,
  }) => {
    // Occupies rows 0-1, columns 0-2, so the next "Add zone" lands at row 0, column 3.
    stubEditor(api, { zones: [zone()] });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);
    await page.getByRole('button', { name: 'Add zone' }).click();
    await expect(zoneCards(page)).toHaveCount(2);

    const added = zoneCards(page).nth(1);
    await added.getByLabel('Starting column index for zone 2').fill('0');

    await expect(page.getByRole('alert')).toContainText("Zones can't overlap");
    await expect(added.getByLabel('Starting column index for zone 2')).toHaveValue('3');
    await expect(zoneCards(page).nth(0).getByLabel('Zone name')).toHaveValue('Stalls');
  });
});

test.describe('the map size', () => {
  test('rows and columns can be added, typed in and removed, and are saved', async ({
    page,
    api,
  }) => {
    stubEditor(api, { gridRows: 4, gridCols: 5 });
    api.on('PUT', `inventory/events/${EVENT_ID}/inventory`, { status: 204 });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);
    await expect(page.getByLabel('Number of rows')).toHaveValue('4');
    await expect(page.getByLabel('Number of columns')).toHaveValue('5');

    await page.getByRole('button', { name: 'Add row' }).click();
    await page.getByRole('button', { name: 'Add column' }).click();
    await page.getByRole('button', { name: 'Add column' }).click();
    await page.getByRole('button', { name: 'Remove last row' }).click();
    await page.getByRole('button', { name: 'Remove last row' }).click();

    await expect(page.getByLabel('Number of rows')).toHaveValue('3');
    await expect(page.getByLabel('Number of columns')).toHaveValue('7');
    await expect(cell(page, 2, 6)).toBeVisible();
    await expect(cell(page, 3, 0)).toHaveCount(0);

    await page.getByRole('button', { name: 'Save inventory' }).click();
    await page.waitForURL('**/organiser/events');
    const [save] = api.requests('PUT', `inventory/events/${EVENT_ID}/inventory`);
    expect(save.postDataJSON()).toMatchObject({ gridRows: 3, gridCols: 7 });
  });
});

test.describe('validation and errors', () => {
  test('a zone without a name is not saved', async ({ page, api }) => {
    stubEditor(api);
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);
    await drag(page, [0, 0], [0, 2]);

    await page.getByRole('button', { name: 'Save inventory' }).click();

    await expect(page.getByRole('alert').first()).toContainText(NO_NAME);
    expect(api.requests('PUT', `inventory/events/${EVENT_ID}/inventory`)).toHaveLength(0);
  });

  test('a zone with a name of only spaces is not saved', async ({ page, api }) => {
    stubEditor(api);
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);
    await drag(page, [0, 0], [0, 2]);
    await page.getByLabel('Zone name').fill('   ');

    await page.getByRole('button', { name: 'Save inventory' }).click();

    await expect(page.getByRole('alert').first()).toContainText(NO_NAME);
    expect(api.requests('PUT', `inventory/events/${EVENT_ID}/inventory`)).toHaveLength(0);
  });

  test('a negative price is not saved', async ({ page, api }) => {
    stubEditor(api);
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);
    await drag(page, [0, 0], [0, 2]);
    await page.getByLabel('Zone name').fill('Floor');
    await page.getByLabel('Price per seat').fill('-1');

    await page.getByRole('button', { name: 'Save inventory' }).click();

    await expect(page.getByRole('alert')).toContainText('Please enter a price of 0 or more');
    expect(api.requests('PUT', `inventory/events/${EVENT_ID}/inventory`)).toHaveLength(0);
  });

  const failures = [
    {
      code: 'cannot_modify_committed_seat',
      status: 409,
      message: "A zone with sold or held seats can't be resized or removed",
    },
    {
      code: 'zone_below_allocated',
      status: 409,
      message: "can't be made smaller than the tickets",
    },
    { code: 'event_cancelled', status: 409, message: 'This event has been cancelled' },
    { code: 'unexpected', status: 500, message: 'Unable to save inventory. Please try again.' },
  ];

  for (const { code, status, message } of failures) {
    test(`the backend refusing a save (${code}) is explained and keeps the layout`, async ({
      page,
      api,
    }) => {
      stubEditor(api, { zones: [zone()] });
      api.on('PUT', `inventory/events/${EVENT_ID}/inventory`, { status, json: { error: code } });
      await page.goto(`/organiser/events/${EVENT_ID}/inventory`);

      await page.getByRole('button', { name: 'Save inventory' }).click();

      await expect(page.getByRole('alert')).toContainText(message);
      await expect(page).toHaveURL(/\/inventory$/);
      await expect(zoneCards(page)).toHaveCount(1);
    });
  }
});

test.describe('what an event allows', () => {
  test('a zone with sold seats cannot be removed but can still be renamed', async ({
    page,
    api,
  }) => {
    stubEditor(api, {
      event: { status: 'PUBLISHED' },
      zones: [zone({ soldCount: 2 }), zone({ inventoryItemId: 12, name: 'Balcony', gridRow: 3 })],
    });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);

    const stalls = zoneCards(page).nth(0);
    const balcony = zoneCards(page).nth(1);
    await expect(stalls.getByRole('button', { name: 'Remove' })).toBeDisabled();
    await expect(balcony.getByRole('button', { name: 'Remove' })).toBeEnabled();
    await stalls.getByLabel('Zone name').fill('Stalls (renamed)');
    await expect(stalls.getByLabel('Zone name')).toHaveValue('Stalls (renamed)');
  });

  test('a published event explains what can still be changed', async ({ page, api }) => {
    stubEditor(api, { event: { status: 'PUBLISHED' } });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);

    await expect(
      page.getByText('This event is on sale. You can add or remove seats'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save inventory' })).toBeEnabled();
  });

  const locked = [
    {
      name: 'a cancelled event',
      event: { status: 'CANCELLED' },
      message: 'This event has been cancelled — its inventory can no longer be edited.',
    },
    {
      name: 'an event that has already started',
      event: { status: 'PUBLISHED', starts_at: new Date(Date.now() - 3600_000).toISOString() },
      message: 'This event has already started — its inventory can no longer be edited.',
    },
  ];

  for (const { name, event, message } of locked) {
    test(`${name} cannot be edited`, async ({ page, api }) => {
      stubEditor(api, { event });
      await page.goto(`/organiser/events/${EVENT_ID}/inventory`);

      await expect(page.getByText(message)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save inventory' })).toBeDisabled();
      await drag(page, [0, 0], [1, 1]);
      await expect(zoneCards(page)).toHaveCount(0);
    });
  }

  test('an event that does not exist says so', async ({ page, api }) => {
    api.on('GET', `event/events/${EVENT_ID}`, { status: 404, json: { error: 'event_not_found' } });
    api.on('GET', `inventory/events/${EVENT_ID}/inventory`, { status: 404, json: { error: 'x' } });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);

    await expect(page.getByRole('heading', { name: 'Event not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to managed events' })).toBeVisible();
  });
});
