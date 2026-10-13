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
    seats?: readonly Record<string, unknown>[];
  } = {},
) {
  api
    .on('GET', `event/events/${EVENT_ID}`, {
      // The seat map is for reserved seating; general admission tests pass their tier.
      json: { event: managedEvent({ status: 'DRAFT', tier: 'TIER2_SEATED', ...options.event }) },
    })
    .on('GET', `inventory/events/${EVENT_ID}/inventory`, {
      json: {
        gridRows: options.gridRows ?? 6,
        gridCols: options.gridCols ?? 8,
        zones: options.zones ?? [],
        seats: options.seats ?? [],
      },
    })
    .on('PUT', `inventory/events/${EVENT_ID}/stage`, { status: 204 })
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

test.describe('general admission, laid out on the mini-map', () => {
  /** Drags on the mini-map with the real mouse, between the centres of two map cells. */
  async function dragOnMap(
    page: Page,
    from: [number, number],
    to: [number, number],
    gridRows = 6,
    gridCols = 8,
    dispatchDirectly = false,
  ) {
    const map = page.locator('.overview-map');
    await map.scrollIntoViewIfNeeded();
    const box = (await map.boundingBox())!;
    const cellWidth = box.width / gridCols;
    const cellHeight = box.height / gridRows;
    const at = ([row, col]: [number, number]) => [
      box.x + (col + 0.5) * cellWidth,
      box.y + (row + 0.5) * cellHeight,
    ];
    const [x1, y1] = at(from);
    const [x2, y2] = at(to);
    if (dispatchDirectly) {
      await map.evaluate((element, points) => {
        Object.defineProperty(element, 'setPointerCapture', { value: () => undefined, configurable: true });
        const dispatch = (type: string, x: number, y: number) =>
          element.dispatchEvent(new PointerEvent(type, {
            bubbles: true,
            button: 0,
            pointerId: 1,
            pointerType: 'mouse',
            clientX: x,
            clientY: y,
          }));
        dispatch('pointerdown', points.x1, points.y1);
        dispatch('pointermove', points.x2, points.y2);
        dispatch('pointerup', points.x2, points.y2);
      }, { x1: x1!, y1: y1!, x2: x2!, y2: y2! });
      return;
    }
    await page.mouse.move(x1!, y1!);
    await page.mouse.down();
    await page.mouse.move(x2!, y2!, { steps: 6 });
    await page.mouse.up();
  }

  test('there is no seat map; sections are drawn, moved and resized on the mini-map', async ({
    page,
    api,
  }) => {
    stubEditor(api, { event: { tier: 'TIER1_GA' } });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);
    await expect(page.locator('.grid-map-canvas')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Select seats' })).toHaveCount(0);

    await dragOnMap(page, [0, 0], [2, 2]); // draw a 3 x 3 section with an interior grab point
    await expect(zoneCards(page)).toHaveCount(1);
    const position = () =>
      Promise.all(
        ['Row index', 'Column index', 'Row span', 'Column span'].map((field) =>
          page.getByLabel(`${field} for zone 1`).inputValue(),
        ),
      );
    expect(await position()).toEqual(['0', '0', '3', '3']);

    await dragOnMap(page, [1, 1], [3, 4]); // grab its body and move it
    await expect.poll(position).toEqual(['2', '3', '3', '3']);

    await dragOnMap(page, [4, 5], [5, 7]); // drag its bottom-right corner to resize it
    await expect.poll(position).toEqual(['2', '3', '4', '5']);
  });

  test('a general-admission map can grow past 100 rows and columns', async ({ page, api }) => {
    stubEditor(api, { event: { tier: 'TIER1_GA' }, gridRows: 100, gridCols: 100 });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);

    await page.getByRole('button', { name: 'Add row' }).click();
    await page.getByRole('button', { name: 'Add column' }).click();
    await expect(page.getByRole('button', { name: 'Add row' })).toBeEnabled();
    await expect(page.locator('.overview-map')).toBeVisible();
  });

  test('a high-capacity drag uses larger sections to stay within the section limit', async ({ page, api }) => {
    stubEditor(api, { event: { tier: 'TIER1_GA' }, gridRows: 300, gridCols: 300 });
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);

    await dragOnMap(page, [0, 0], [299, 299], 300, 300, true);

    // A balanced 7 x 7 layout covers the full area without exceeding 50 sections.
    await expect(zoneCards(page)).toHaveCount(49);
    await expect(page.getByLabel('Zone name').first()).toHaveValue('Section A1');
    await expect(page.getByLabel('Zone name').last()).toHaveValue('Section G7');
    const firstRowSpan = page.getByRole('spinbutton', { name: 'Row span for zone 1', exact: true });
    await expect(firstRowSpan).toHaveValue('42');
    await expect(page.getByRole('spinbutton', { name: 'Column span for zone 49', exact: true })).toHaveValue('43');

    await firstRowSpan.fill('30');
    await expect(firstRowSpan).toHaveValue('30');
    await page.getByLabel('Zone name').first().fill('Front floor');
    await expect(page.getByLabel('Zone name').first()).toHaveValue('Front floor');
  });
});

test.describe('sections of a large map', () => {
  test('dragging across sections of the overview makes each one a zone, ready to edit below', async ({
    page,
    api,
  }) => {
    // 100 x 100 is 4 x 4 fixed sections of 30; "Stalls" already sits in the top-left one.
    stubEditor(api, { gridRows: 100, gridCols: 100, zones: [zone()] });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);
    await expect(zoneCards(page)).toHaveCount(1);

    const map = page.locator('.overview-map');
    const box = (await map.boundingBox())!;
    const section = box.width / (100 / 30);
    await page.mouse.move(box.x + section * 0.5, box.y + section * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + section * 1.5, box.y + section * 1.5, { steps: 5 });
    await page.mouse.up();

    // Every section becomes a zone; the seat map shows the first of them.
    await expect(zoneCards(page)).toHaveCount(4);
    await expect(page.getByText('Viewing rows 1–30, columns 1–30')).toBeVisible();
    for (const [index, name] of ['Stalls', 'Section A2', 'Section B1', 'Section B2'].entries()) {
      await expect(page.getByLabel('Zone name').nth(index)).toHaveValue(name);
    }
    await expect(page.getByText('1 section already has a zone or stage piece')).toBeVisible();
    // Each fills its whole 30 x 30 section.
    await expect(page.getByLabel('Row span for zone 4')).toHaveValue('30');
    await expect(page.getByLabel('Column span for zone 4')).toHaveValue('30');

    // Each new zone is customised like any other.
    await page.getByLabel('Zone name').nth(1).fill('Upper Circle');
    await expect(page.getByLabel('Zone name').nth(1)).toHaveValue('Upper Circle');
  });

  test('a button for each zone jumps the editor to that zone', async ({ page, api }) => {
    stubEditor(api, {
      gridRows: 100,
      gridCols: 100,
      zones: [
        zone(),
        zone({
          inventoryItemId: 12,
          name: 'Balcony',
          code: 'B',
          gridRow: 50,
          gridCol: 40,
          gridRowSpan: 15,
          gridColSpan: 30,
        }),
      ],
    });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);
    const zonesNav = page.getByRole('navigation', { name: 'Go to a zone' });

    // Balcony covers rows 51–65 and columns 41–70, which reach into four sections.
    await zonesNav.getByRole('button', { name: 'Balcony' }).click();
    await expect(page.getByText('Viewing rows 31–90, columns 31–90')).toBeVisible();
    await expect(page.locator('[data-grid-row="50"][data-grid-col="40"]')).toBeVisible();

    await zonesNav.getByRole('button', { name: 'Stalls' }).click();
    await expect(page.getByText('Viewing rows 1–30, columns 1–30')).toBeVisible();
  });

  test('a single click on a section only shows it, and the keyboard can pick a section too', async ({
    page,
    api,
  }) => {
    stubEditor(api, { gridRows: 100, gridCols: 100, zones: [zone()] });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);
    const box = (await page.locator('.overview-map').boundingBox())!;
    const section = box.width / (100 / 30);

    await page.mouse.click(box.x + section * 3.2, box.y + section * 0.5);
    await expect(page.getByText('Viewing rows 1–30, columns 91–100')).toBeVisible();
    await expect(zoneCards(page)).toHaveCount(1);

    await page.getByRole('button', { name: /^Rows 31–60, cols 31–60/ }).press('Enter');
    await expect(page.getByText('Viewing rows 31–60, columns 31–60')).toBeVisible();
  });
});

test.describe('drawing zones', () => {
  test('seats of a zone that is not saved yet can be switched off straight away', async ({
    page,
    api,
  }) => {
    stubEditor(api, { event: { tier: 'TIER2_SEATED' } });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);
    await drag(page, [0, 0], [1, 2]); // a new 2 x 3 zone, no seats saved yet
    await page.getByLabel('Zone name').fill('Floor');
    await page.getByLabel('Price per seat').fill('10');

    await page.getByRole('button', { name: 'Select seats' }).click();
    await drag(page, [1, 0], [1, 2]); // switch the back row off
    await expect(cell(page, 1, 1)).toHaveClass(/blocked/);
    await expect(cell(page, 0, 1)).not.toHaveClass(/blocked/);

    // Saving creates the seats; the editor then reads them back and switches the back row off.
    let loads = 0;
    api
      .on('GET', `inventory/events/${EVENT_ID}/inventory`, () => {
        loads += 1;
        return {
          json: {
            gridRows: 6,
            gridCols: 8,
            zones: [],
            seats: [0, 1].flatMap((gridRow) =>
              [0, 1, 2].map((gridCol) => ({
                seatId: 200 + gridRow * 3 + gridCol,
                gridRow,
                gridCol,
                seatLabel: `${'AB'[gridRow]}${gridCol + 1}`,
                inventoryItemId: 21,
                status: 'AVAILABLE',
                tag: 'NONE',
              })),
            ),
          },
        };
      })
      .on('PUT', `inventory/events/${EVENT_ID}/inventory`, { status: 204 })
      .on('PUT', `inventory/events/${EVENT_ID}/stage`, { status: 204 })
      .on('PATCH', `inventory/events/${EVENT_ID}/seats`, { json: { updated: 3 } });
    await page.getByRole('button', { name: 'Save inventory' }).click();
    await page.waitForURL('**/organiser/events');

    expect(loads).toBe(1);
    expect(
      api.requests('PATCH', `inventory/events/${EVENT_ID}/seats`).map((r) => r.postDataJSON()),
    ).toEqual([{ seatIds: [203, 204, 205], available: false }]);
  });

  test('dragging over seats switches them off, or back on, and saving keeps it', async ({
    page,
    api,
  }) => {
    // Stalls is 2 x 3: A3 is sold, B1 was already switched off.
    const seat = (seatId: number, gridRow: number, gridCol: number, status = 'AVAILABLE') => ({
      seatId,
      gridRow,
      gridCol,
      seatLabel: `${'AB'[gridRow]}${gridCol + 1}`,
      inventoryItemId: 11,
      status,
      tag: status === 'BLOCKED' ? 'MAINTENANCE' : 'NONE',
    });
    stubEditor(api, {
      event: { tier: 'TIER2_SEATED' },
      zones: [zone({ soldCount: 1 })],
      seats: [
        seat(101, 0, 0),
        seat(102, 0, 1),
        seat(103, 0, 2, 'SOLD'),
        seat(104, 1, 0, 'BLOCKED'),
        seat(105, 1, 1),
        seat(106, 1, 2),
      ],
    });
    api
      .on('PATCH', `inventory/events/${EVENT_ID}/seats`, { json: { updated: 1 } })
      .on('PUT', `inventory/events/${EVENT_ID}/inventory`, { status: 204 })
      .on('PUT', `inventory/events/${EVENT_ID}/stage`, { status: 204 });
    await page.goto(`/organiser/events/${EVENT_ID}/inventory`);

    await page.getByRole('button', { name: 'Select seats' }).click();
    await drag(page, [0, 0], [1, 2]);

    await expect(cell(page, 0, 0)).toHaveClass(/blocked/);
    await expect(cell(page, 1, 2)).toHaveClass(/blocked/);
    await expect(cell(page, 1, 0)).not.toHaveClass(/blocked/);
    await expect(cell(page, 0, 2)).toHaveClass(/sold/);
    await expect(cell(page, 0, 2)).not.toHaveClass(/blocked/);

    // Dragging over a seat again switches it back.
    await drag(page, [0, 1], [0, 1]);
    await expect(cell(page, 0, 1)).not.toHaveClass(/blocked/);

    await page.getByRole('button', { name: 'Save inventory' }).click();
    await page.waitForURL('**/organiser/events');
    const switched = api
      .requests('PATCH', `inventory/events/${EVENT_ID}/seats`)
      .map((r) => r.postDataJSON());
    expect(switched).toEqual([
      { seatIds: [101, 105, 106], available: false },
      { seatIds: [104], available: true },
    ]);
  });

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
    await expect(zoneCards(page).first()).toContainText('6 seats');
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
    await expect(zoneCards(page).first()).toContainText('9 seats');

    await drag(page, [1, 1], [1, 3]); // grab the middle, move two columns right
    await drag(page, [2, 4], [3, 5]); // pull the bottom-right corner out by one each way
    await expect(zoneCards(page).first()).toContainText('16 seats');

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
    await expect(zoneCards(page).first()).toContainText('1 seats');
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

    await expect(zoneCards(page).first()).toContainText('8 seats');

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
