import type { Locator, Page } from '@playwright/test';

import type { MockApi } from './support/api';
import { managedEvent, order, ticket } from './support/data';
import { EVENT_ID, stubDoorApi } from './support/door';
import { expect, test } from './support/fixtures';
import { customer, helper, organiser, signInAs, type TestUser } from './support/session';

// The `mobile` project runs these in a phone-sized, touch-enabled Chromium (Pixel 7). The screens
// people use on a phone are checked for what breaks on a small screen: sideways scrolling, controls
// too small to tap, navigation that does not open, and touch (not mouse) use.

/** WCAG 2.2 AA "Target Size (Minimum)": 24 x 24 CSS pixels. */
const MIN_TARGET = 24;

const seats = Array.from({ length: 6 }, (_, index) => ({
  seatId: index + 1,
  seatLabel: `A${index + 1}`,
  gridRow: 0,
  gridCol: index,
  inventoryItemId: 1,
  sectionName: 'Stalls',
  priceCents: 2500,
  color: '#2563EB',
  status: 'AVAILABLE',
  tag: 'NONE',
}));

const admitted = () => ({
  status: 'ADMITTED',
  position: 0,
  admissionToken: 'admission-token-for-the-test',
  tokenExpiresAt: new Date(Date.now() + 8 * 60_000).toISOString(),
});

function stubEvents(api: MockApi, overrides: Record<string, unknown> = {}) {
  api
    .on('GET', 'event/events', { json: { events: [managedEvent(overrides)] } })
    .on('GET', 'event/venues', {
      json: { venues: [{ venue: 'Marina Bay Arena', upcoming: 1, sample_event_id: 7 }] },
    })
    .on('GET', 'event/events/7', {
      json: { event: { ...managedEvent(overrides), organiser_sub: 'someone-else' } },
    })
    .on('GET', 'inventory/events/7/zones', {
      json: {
        zones: [
          {
            inventoryItemId: 1,
            name: 'General admission',
            priceCents: 2500,
            color: '#2563EB',
            remaining: 60,
          },
        ],
      },
    });
}

function stubCustomer(api: MockApi, queue?: Record<string, unknown>) {
  api
    .on('GET', 'ticket/customers/me/tickets', { json: { tickets: [] } })
    .on('GET', 'order/customers/me/orders', { json: { orders: [] } });
  if (queue) api.on('GET', 'queue/events/7/queue/me', { json: queue });
}

function stubOrganiser(api: MockApi) {
  const event = { ...managedEvent({ status: 'PUBLISHED' }), organiser_sub: organiser.sub };
  api
    .on('GET', 'event/team-invitations', { json: { invitations: [] } })
    .on('GET', 'event/events/manage', { json: { events: [event] } })
    .on('GET', 'order/events/7/orders/summary', {
      json: { paidOrders: 12, ticketsSold: 40, revenueCents: 100000 },
    })
    .on('GET', 'event/events/7', { json: { event } })
    .on('GET', 'event/events/7/team-members', { json: { members: [] } })
    .on('GET', 'inventory/events/7/inventory', {
      json: { gridRows: 3, gridCols: 6, zones: [], seats: [] },
    })
    .on('GET', 'ticket/events/7/checkin-stats', { json: { checkedIn: 1, issued: 2 } })
    .on('GET', 'queue/events/7/queue', { status: 404, json: { error: 'queue_not_configured' } });
}

interface Screen {
  readonly name: string;
  readonly path: string;
  readonly user: TestUser | null;
  readonly ready: (page: Page) => Locator;
  readonly stub: (api: MockApi) => void;
}

const screens: Screen[] = [
  {
    name: 'home',
    path: '/',
    user: null,
    ready: (page) => page.getByText('E2E Summer Concert').first(),
    stub: (api) => stubEvents(api),
  },
  {
    name: 'events',
    path: '/events',
    user: null,
    ready: (page) => page.getByRole('link', { name: 'E2E Summer Concert' }).first(),
    stub: (api) => stubEvents(api),
  },
  {
    name: 'sign in',
    path: '/login',
    user: null,
    ready: (page) => page.getByRole('button', { name: /Continue to sign in/ }),
    stub: () => undefined,
  },
  {
    name: 'a general-admission event',
    path: '/events/7',
    user: customer,
    ready: (page) => page.getByRole('heading', { name: 'E2E Summer Concert' }),
    stub: (api) => {
      stubEvents(api);
      stubCustomer(api);
    },
  },
  {
    name: 'choosing seats',
    path: '/events/7',
    user: customer,
    ready: (page) => page.getByText('It is your turn.'),
    stub: (api) => {
      stubEvents(api, { tier: 'TIER2_SEATED' });
      stubCustomer(api, admitted());
      api.on('GET', 'inventory/events/7/seats', { json: { gridRows: 1, gridCols: 6, seats } });
    },
  },
  {
    name: 'my tickets',
    path: '/my-events',
    user: customer,
    ready: (page) => page.getByRole('article').first(),
    stub: (api) =>
      api
        .on('GET', 'ticket/customers/me/tickets', { json: { tickets: [ticket()] } })
        .on('GET', 'order/customers/me/orders', { json: { orders: [order()] } }),
  },
  {
    name: 'door check-in',
    path: `/checkin/${EVENT_ID}`,
    user: helper,
    ready: (page) => page.getByRole('status').filter({ hasText: '3 of 10 checked in' }),
    stub: (api) => stubDoorApi(api),
  },
  {
    name: 'helper home',
    path: '/helper',
    user: helper,
    ready: (page) => page.getByRole('heading', { name: /Welcome/ }),
    stub: (api) =>
      api.on('GET', 'event/helper/shifts', {
        json: {
          events: [
            {
              event_id: EVENT_ID,
              title: 'E2E Helper Concert',
              venue: 'E2E Hall',
              total_seats: 100,
              starts_at: new Date().toISOString(),
            },
          ],
        },
      }),
  },
  {
    name: 'organiser events',
    path: '/organiser/events',
    user: organiser,
    ready: (page) => page.getByRole('listitem').filter({ hasText: 'E2E Summer Concert' }),
    stub: (api) => stubOrganiser(api),
  },
  {
    name: 'organiser sales',
    path: '/organiser/sales',
    user: organiser,
    ready: (page) => page.getByRole('row').filter({ hasText: 'E2E Summer Concert' }),
    stub: (api) => stubOrganiser(api),
  },
  {
    name: 'the seat-map editor',
    path: '/organiser/events/7/inventory',
    user: organiser,
    ready: (page) => page.getByRole('heading', { name: 'Configure inventory' }),
    stub: (api) => stubOrganiser(api),
  },
  {
    name: 'event management',
    path: '/organiser/events/7',
    user: organiser,
    ready: (page) => page.getByRole('heading', { name: 'Team' }),
    stub: (api) => stubOrganiser(api),
  },
];

async function open(page: Page, api: MockApi, screen: Screen) {
  if (screen.user) await signInAs(page, screen.user);
  screen.stub(api);
  await page.goto(screen.path);
  await expect(screen.ready(page)).toBeVisible();
}

/** The page itself must not scroll sideways: wide content has to scroll inside its own box. */
async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'the page is wider than the screen').toBeLessThanOrEqual(clientWidth);
}

/** Visible buttons, selects and text fields smaller than the AA minimum, as `label (WxH)`. */
function undersizedControls(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const controls = document.querySelectorAll(
      'button, [role="button"], select, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"])',
    );
    return [...controls]
      .map((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const shown =
          box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.opacity !== '0';
        const name =
          element.getAttribute('aria-label') ||
          (element as HTMLElement).innerText ||
          element.textContent ||
          element.tagName;
        return {
          shown,
          small: box.width < min || box.height < min,
          label: `${name.trim().slice(0, 30)} (${Math.round(box.width)}x${Math.round(box.height)})`,
        };
      })
      .filter((control) => control.shown && control.small)
      .map((control) => control.label);
  }, MIN_TARGET);
}

for (const [label, size] of [
  ['a phone', { width: 412, height: 915 }],
  ['a common Android phone', { width: 360, height: 740 }],
  ['the narrowest phone', { width: 320, height: 640 }],
  ['a phone on its side', { width: 915, height: 412 }],
] as const) {
  test.describe(`on ${label}`, () => {
    test.use({ viewport: size });

    for (const screen of screens) {
      test(`${screen.name} does not scroll sideways`, async ({ page, api }) => {
        await open(page, api, screen);
        await expectNoSidewaysScroll(page);
      });
    }
  });
}

test.describe('tap targets', () => {
  for (const screen of screens) {
    test(`${screen.name}: buttons and fields are big enough to tap`, async ({ page, api }) => {
      await open(page, api, screen);
      expect(await undersizedControls(page), `controls under ${MIN_TARGET}px`).toEqual([]);
    });
  }
});

test.describe('the navigation menu', () => {
  test('opens with a tap, lists the workspaces and goes where it is tapped', async ({
    page,
    api,
  }) => {
    await signInAs(page, organiser);
    stubOrganiser(api);
    stubEvents(api);
    stubCustomer(api);
    await page.goto('/organiser/sales');
    await expect(page.getByRole('row').filter({ hasText: 'E2E Summer Concert' })).toBeVisible();

    const toggle = page.getByRole('button', { name: 'Toggle navigation' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    for (const name of ['Customer', 'Organiser', 'Event helper']) {
      await expect(
        page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name }),
      ).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Workspace' })
      .getByRole('link', { name: 'Customer' })
      .tap();
    await expect(page).toHaveURL(/localhost:4200\/$/);

    // Whether or not going somewhere closes the menu, the toggle opens and closes it.
    await expect(toggle).toHaveAttribute('aria-expanded', /^(true|false)$/);
    const before = (await toggle.getAttribute('aria-expanded')) ?? 'false';
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', before === 'true' ? 'false' : 'true');
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', before);
  });
});

test.describe('using it with a finger', () => {
  test('a customer taps through choosing seats', async ({ page, api }) => {
    await signInAs(page, customer);
    stubEvents(api, { tier: 'TIER2_SEATED' });
    stubCustomer(api, admitted());
    api.on('GET', 'inventory/events/7/seats', { json: { gridRows: 1, gridCols: 6, seats } });
    await page.goto('/events/7');
    await expect(page.getByText('It is your turn.')).toBeVisible();
    const seat = (label: string) => page.getByRole('button', { name: new RegExp(`^${label} —`) });

    // One ticket: tapping another seat swaps the choice.
    await seat('A3').tap();
    await expect(seat('A3')).toHaveClass(/selected/);
    await seat('A4').tap();
    await expect(seat('A4')).toHaveClass(/selected/);
    await expect(seat('A3')).not.toHaveClass(/selected/);

    // Two tickets: both seats stay chosen.
    await page.getByLabel('Quantity').fill('2');
    await seat('A3').tap();
    await expect(seat('A3')).toHaveClass(/selected/);
    await expect(seat('A4')).toHaveClass(/selected/);
    await expect(page.getByRole('button', { name: 'Buy tickets' })).toBeInViewport({ ratio: 0.5 });
  });

  test('a customer taps to buy general-admission tickets and reaches checkout', async ({
    page,
    api,
  }) => {
    await signInAs(page, customer);
    stubEvents(api);
    stubCustomer(api);
    api
      .on('POST', 'order/orders', { json: { order: { order_id: 301 } } })
      .on('GET', 'order/orders/301', {
        json: { order: order({ status: 'PENDING_PAYMENT' }) },
      });
    await page.goto('/events/7');
    await page.getByLabel('Quantity').fill('2');

    await page.getByRole('button', { name: /Buy tickets/ }).tap();

    await page.waitForURL(/\/checkout\/301/);
  });

  test('the helper taps through the door screen', async ({ page, api }) => {
    await signInAs(page, helper);
    stubDoorApi(api);
    // A blank video stands in for the camera: nothing is scanned, the tap is what is tested.
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        return Promise.resolve(canvas.captureStream(5));
      };
    });
    await page.goto(`/checkin/${EVENT_ID}`);
    await expect(page.getByRole('status').filter({ hasText: '3 of 10 checked in' })).toBeVisible();

    await page.getByRole('button', { name: 'Mute sounds' }).tap();
    await expect(page.getByRole('status').filter({ hasText: 'Sound muted' })).toBeVisible();

    const chooser = page.waitForEvent('filechooser');
    await page.locator('label.upload').tap();
    expect((await chooser).isMultiple()).toBe(false);

    await page.getByRole('button', { name: 'Open camera' }).tap();
    const preview = page.getByLabel('Camera preview');
    await expect(preview).toBeVisible();
    // The preview fits the screen instead of pushing the page wider.
    const box = await preview.boundingBox();
    expect(box?.width ?? Infinity).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    await expectNoSidewaysScroll(page);

    await page.getByRole('button', { name: 'Stop camera' }).tap();
    await expect(page.getByRole('button', { name: 'Open camera' })).toBeVisible();
  });

  test('a helper looks a ticket up by name and checks it in with a tap', async ({ page, api }) => {
    await signInAs(page, helper);
    stubDoorApi(api);
    api
      .on('GET', 'ticket/tickets/search', {
        json: {
          tickets: [
            {
              ticket_id: 501,
              order_id: 301,
              event_id: EVENT_ID,
              customer_name: 'Casey Customer',
              customer_email: 'casey@example.test',
              zone_name: 'General admission',
              seat_label: null,
              status: 'ISSUED',
            },
          ],
        },
      })
      .on('POST', 'ticket/tickets/validate', { json: { outcome: 'SUCCESS' } });
    await page.goto(`/checkin/${EVENT_ID}`);
    await page.getByLabel('Name, email or order ID').fill('casey');

    await page.getByRole('button', { name: 'Check in' }).tap();
    const confirmation = page.getByRole('dialog');
    await expect(confirmation).toContainText('Casey Customer (casey@example.test)');
    await confirmation.getByRole('button', { name: 'Yes, check in' }).tap();

    await expect(
      page.getByRole('status').filter({ hasText: 'Valid ticket. Check-in accepted.' }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
});
