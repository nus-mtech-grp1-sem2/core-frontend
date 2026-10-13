import { expectAccessible } from './support/a11y';
import type { MockApi } from './support/api';
import { managedEvent } from './support/data';
import { EVENT_ID, OUTCOMES, stubDoorApi, uploadFile } from './support/door';
import { expect, test } from './support/fixtures';
import { BLANK_PNG, qrPng } from './support/qr-images';
import { customer, helper, organiser, signInAs } from './support/session';

// An axe pass (WCAG 2.x A and AA) over the pages and states that had none: what a person sees at
// each step, not just the page at rest. The pages audited earlier stay in their own specs.

const SELLING = managedEvent({
  organiser_sub: 'someone-else',
  description: 'An evening of live music.',
});

/** A row of seats in a hall, for the seat-selection views. */
const seats = Array.from({ length: 6 }, (_, index) => ({
  seatId: index + 1,
  seatLabel: `A${index + 1}`,
  gridRow: 0,
  gridCol: index,
  inventoryItemId: 1,
  sectionName: 'Stalls',
  priceCents: 2500,
  color: '#2563EB',
  status: index === 1 ? 'SOLD' : index === 2 ? 'HELD' : 'AVAILABLE',
  tag: index === 4 ? 'ACCESSIBLE' : 'NONE',
}));

function stubPublicEvent(api: MockApi, overrides: Record<string, unknown> = {}) {
  api
    .on('GET', 'event/events', { json: { events: [managedEvent(overrides)] } })
    .on('GET', 'event/venues', {
      json: { venues: [{ venue: 'Marina Bay Arena', upcoming: 1, sample_event_id: 7 }] },
    })
    .on('GET', 'event/events/7', { json: { event: { ...SELLING, ...overrides } } })
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

function stubSeated(api: MockApi) {
  stubPublicEvent(api, { tier: 'TIER2_SEATED' });
  api.on('GET', 'inventory/events/7/seats', { json: { gridRows: 1, gridCols: 6, seats } });
}

function stubCustomer(api: MockApi, queue?: Record<string, unknown> | 'none') {
  api
    .on('GET', 'ticket/customers/me/tickets', { json: { tickets: [] } })
    .on('GET', 'order/customers/me/orders', { json: { orders: [] } });
  if (queue === 'none') {
    api.on('GET', 'queue/events/7/queue/me', { status: 404, json: { error: 'not_in_queue' } });
  } else if (queue) {
    api.on('GET', 'queue/events/7/queue/me', { json: queue });
  }
}

const soon = () => new Date(Date.now() + 8 * 60_000).toISOString();

test.describe('public pages', () => {
  test('home, with events on sale', async ({ page, api }) => {
    stubPublicEvent(api);
    await page.goto('/');
    await expect(page.getByText('E2E Summer Concert').first()).toBeVisible();
    await expectAccessible(page);
  });

  test('sign in', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /Continue to sign in/ })).toBeVisible();
    await expectAccessible(page);
  });

  test('create an account', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('event page, as a customer', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, customer);
  });

  test('general admission: quantity and buy', async ({ page, api }) => {
    stubPublicEvent(api);
    stubCustomer(api);
    await page.goto('/events/7');
    await expect(page.getByRole('heading', { name: 'E2E Summer Concert' })).toBeVisible();
    await expectAccessible(page);
  });

  test('reserved seating: before joining the waiting room', async ({ page, api }) => {
    stubSeated(api);
    stubCustomer(api, 'none');
    await page.goto('/events/7');
    await expect(page.getByRole('button', { name: 'Join waiting room' })).toBeVisible();
    await expectAccessible(page);
  });

  test('reserved seating: waiting in the queue', async ({ page, api }) => {
    stubSeated(api);
    stubCustomer(api, { status: 'WAITING', position: 4 });
    await page.goto('/events/7');
    await expect(page.getByRole('button', { name: /waiting room|queue/i }).first()).toBeVisible();
    await expectAccessible(page);
  });

  test('reserved seating: admitted, choosing seats', async ({ page, api }) => {
    stubSeated(api);
    stubCustomer(api, {
      status: 'ADMITTED',
      position: 0,
      admissionToken: 'admission-token-for-the-test',
      tokenExpiresAt: soon(),
    });
    await page.goto('/events/7');
    await expect(page.getByText('It is your turn.')).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('button', { name: /^A1 —/ }).click();
    await expectAccessible(page);
  });

  test('reserved seating: admission expired', async ({ page, api }) => {
    stubSeated(api);
    stubCustomer(api, { status: 'EXPIRED' });
    await page.goto('/events/7');
    await expect(page.getByRole('button', { name: 'Rejoin the queue' })).toBeVisible();
    await expectAccessible(page);
  });

  test('the events list, with a team invitation waiting', async ({ page, api }) => {
    stubPublicEvent(api);
    stubCustomer(api);
    api.on('GET', 'event/team-invitations', {
      json: {
        invitations: [
          {
            membership_id: 5,
            event_id: 9,
            role: 'HELPER',
            title: 'E2E Helper Concert',
            venue: 'E2E Hall',
            starts_at: new Date(Date.now() + 86_400_000).toISOString(),
          },
        ],
      },
    });
    await page.goto('/events');
    await expect(page.getByRole('heading', { name: 'Event invitations' })).toBeVisible();
    await expectAccessible(page);
  });

  test('a customer who already holds tickets', async ({ page, api }) => {
    stubPublicEvent(api);
    api
      .on('GET', 'ticket/customers/me/tickets', {
        json: { tickets: [{ event_id: 7, order_id: 301, status: 'ISSUED' }] },
      })
      .on('GET', 'order/customers/me/orders', {
        json: { orders: [{ order_id: 301, event_id: 7, status: 'PAID' }] },
      });
    await page.goto('/events/7');
    await expect(page.getByRole('link', { name: 'View my tickets' })).toBeVisible();
    await expectAccessible(page);
  });

  test('an event that has finished', async ({ page, api }) => {
    stubPublicEvent(api, { starts_at: new Date(Date.now() - 3600_000).toISOString() });
    stubCustomer(api);
    await page.goto('/events/7');
    await expect(page.getByRole('heading', { name: 'E2E Summer Concert' })).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('door check-in', () => {
  test.beforeEach(async ({ page, api }) => {
    await signInAs(page, helper);
    stubDoorApi(api);
  });

  test('helper home, with a shift tonight', async ({ page, api }) => {
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
    });
    await page.goto('/helper');
    await expect(page.getByRole('link', { name: 'Open door check-in' })).toBeVisible();
    await expectAccessible(page);
  });

  test('the door screen at rest', async ({ page }) => {
    await page.goto(`/checkin/${EVENT_ID}`);
    await expect(page.getByRole('status').filter({ hasText: '3 of 10 checked in' })).toBeVisible();
    await expectAccessible(page);
  });

  for (const { apiOutcome, message } of OUTCOMES) {
    test(`the door screen after a scan: ${apiOutcome}`, async ({ page, api }) => {
      api.on('POST', 'ticket/tickets/validate', { json: { outcome: apiOutcome } });
      await page.goto(`/checkin/${EVENT_ID}`);
      await uploadFile(page, {
        name: 'ticket.png',
        mimeType: 'image/png',
        buffer: await qrPng(),
      });
      await expect(page.getByRole('status').filter({ hasText: message })).toBeVisible();
      await expectAccessible(page);
    });
  }

  test('the door screen when an image cannot be read', async ({ page }) => {
    await page.goto(`/checkin/${EVENT_ID}`);
    await uploadFile(page, { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('nope') });
    await expect(page.getByRole('alert')).toBeVisible();
    await expectAccessible(page);
  });

  test('the door screen when the camera is blocked', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    });
    await page.goto(`/checkin/${EVENT_ID}`);
    await page.getByRole('button', { name: 'Open camera' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expectAccessible(page);
  });

  test('the door screen with manual lookup results', async ({ page, api }) => {
    api.on('GET', 'ticket/tickets/search', {
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
          {
            ticket_id: 502,
            order_id: 301,
            event_id: EVENT_ID,
            customer_name: 'Casey Customer',
            customer_email: 'casey@example.test',
            zone_name: 'General admission',
            seat_label: null,
            status: 'CHECKED_IN',
          },
        ],
      },
    });
    await page.goto(`/checkin/${EVENT_ID}`);
    await page.getByLabel('Name, email or order ID').fill('casey');
    await expect(page.getByRole('listitem').filter({ hasText: 'ISSUED' })).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('organiser pages', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, organiser);
  });

  const stubOrganiser = (api: MockApi, status = 'PUBLISHED') => {
    const event = { ...managedEvent({ status }), organiser_sub: organiser.sub };
    api
      .on('GET', 'event/team-invitations', { json: { invitations: [] } })
      .on('GET', 'event/events/manage', { json: { events: [event] } })
      .on('GET', 'event/events/7', { json: { event } })
      .on('GET', 'event/events/7/team-members', {
        json: {
          members: [
            {
              membership_id: 1,
              user_sub: organiser.sub,
              user_email: organiser.email,
              role: 'ORGANISER',
              invite_status: 'ACCEPTED',
              name: 'Olive Organiser',
            },
            {
              membership_id: 2,
              user_sub: 'helper-sub',
              user_email: 'helper@example.test',
              role: 'HELPER',
              invite_status: 'PENDING',
            },
          ],
        },
      })
      .on('GET', 'inventory/events/7/inventory', {
        json: {
          gridRows: 3,
          gridCols: 6,
          zones: [
            {
              inventoryItemId: 1,
              name: 'Stalls',
              code: 'A',
              priceCents: 2500,
              color: '#2563EB',
              seatCount: 6,
              soldCount: 0,
              heldCount: 0,
              gridRow: 0,
              gridCol: 0,
              gridRowSpan: 1,
              gridColSpan: 6,
            },
          ],
          seats: [],
        },
      })
      .on('GET', 'ticket/events/7/checkin-stats', { json: { checkedIn: 1, issued: 2 } })
      .on('GET', 'queue/events/7/queue', { status: 404, json: { error: 'queue_not_configured' } });
  };

  test('workspace home', async ({ page, api }) => {
    stubOrganiser(api);
    await page.goto('/organiser');
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expectAccessible(page);
  });

  test('managed events list', async ({ page, api }) => {
    stubOrganiser(api);
    await page.goto('/organiser/events');
    await expect(
      page.getByRole('listitem').filter({ hasText: 'E2E Summer Concert' }),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test('the new-event form', async ({ page, api }) => {
    stubOrganiser(api);
    await page.goto('/organiser/events');
    await page.getByRole('button', { name: 'New event' }).click();
    await expect(page.getByLabel('Title')).toBeVisible();
    await expectAccessible(page);
  });

  test('a draft event, with its team', async ({ page, api }) => {
    stubOrganiser(api, 'DRAFT');
    await page.goto('/organiser/events/7');
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
    await expectAccessible(page);
  });

  test('a published event', async ({ page, api }) => {
    stubOrganiser(api);
    await page.goto('/organiser/events/7');
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
    await expectAccessible(page);
  });

  test('a reserved-seating event, with its waiting room', async ({ page, api }) => {
    stubOrganiser(api);
    api
      .on('GET', 'event/events/7', {
        json: {
          event: {
            ...managedEvent({ status: 'PUBLISHED', tier: 'TIER2_SEATED' }),
            organiser_sub: organiser.sub,
          },
        },
      })
      .on('GET', 'inventory/events/7/seats', { json: { gridRows: 1, gridCols: 6, seats } })
      .on('GET', 'queue/events/7/queue', {
        json: {
          queue: { eventId: 7, admissionBatchSize: 5, status: 'OPEN', waitingCount: 3 },
        },
      });
    await page.goto('/organiser/events/7');
    await expect(page.getByRole('heading', { name: 'Waiting room' })).toBeVisible();
    await expectAccessible(page);
  });

  test('the seat-map editor with zones', async ({ page, api }) => {
    stubOrganiser(api, 'DRAFT');
    await page.goto('/organiser/events/7/inventory');
    await expect(page.getByLabel('Zone name')).toBeVisible();
    await expectAccessible(page);
  });

  test('the seat-map editor with a validation error', async ({ page, api }) => {
    stubOrganiser(api, 'DRAFT');
    await page.goto('/organiser/events/7/inventory');
    await page.getByLabel('Zone name').fill('');
    await page.getByRole('button', { name: 'Save inventory' }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('keyboard use', () => {
  test('the skip link is the first stop and lands on the main content', async ({ page, api }) => {
    stubPublicEvent(api);
    await page.goto('/events');
    await expect(page.getByText('E2E Summer Concert').first()).toBeVisible();

    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');

    await expect(page.locator('#main')).toBeAttached();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.closest('#main') !== null))
      .toBe(true);
  });

  test('a seat can be chosen and dropped with the keyboard', async ({ page, api }) => {
    await signInAs(page, customer);
    stubSeated(api);
    stubCustomer(api, {
      status: 'ADMITTED',
      position: 0,
      admissionToken: 'admission-token-for-the-test',
      tokenExpiresAt: soon(),
    });
    await page.goto('/events/7');
    await expect(page.getByText('It is your turn.')).toBeVisible();
    const seat = page.getByRole('button', { name: /^A1 —/ });

    await seat.focus();
    await page.keyboard.press('Enter');
    await expect(seat).toHaveClass(/selected/);
    await page.keyboard.press('Space');
    await expect(seat).not.toHaveClass(/selected/);
    // Seats that are sold or held cannot be reached at all.
    await expect(page.getByRole('button', { name: /^A2 —/ })).toBeDisabled();
  });

  test('the door screen can be worked entirely from the keyboard', async ({ page, api }) => {
    await signInAs(page, helper);
    stubDoorApi(api);
    await page.goto(`/checkin/${EVENT_ID}`);
    await expect(page.getByRole('status').filter({ hasText: '3 of 10 checked in' })).toBeVisible();

    const focused = () =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        const text =
          active?.getAttribute('aria-label') ||
          active?.innerText ||
          active?.closest('label')?.textContent ||
          '';
        return text.trim();
      });
    const reached: string[] = [];
    for (let stop = 0; stop < 30 && !reached.includes('Mute sounds'); stop += 1) {
      await page.keyboard.press('Tab');
      reached.push(await focused());
    }
    expect(reached).toEqual(
      expect.arrayContaining(['Upload QR image', 'Open camera', 'Mute sounds']),
    );

    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Sound muted' })).toBeVisible();
  });

  test('the upload control shows where the keyboard focus is', async ({ page, api }) => {
    await signInAs(page, helper);
    stubDoorApi(api);
    await page.goto(`/checkin/${EVENT_ID}`);
    await expect(page.getByRole('status').filter({ hasText: '3 of 10 checked in' })).toBeVisible();

    const label = page.locator('label.upload');
    const input = label.locator('input');
    let uploadFocused = false;
    for (let stop = 0; stop < 30 && !uploadFocused; stop += 1) {
      await page.keyboard.press('Tab');
      uploadFocused = await input.evaluate((element) => element === document.activeElement);
    }
    expect(uploadFocused).toBe(true);
    await expect(input).toBeFocused();

    const focusStyle = (element: import('@playwright/test').Locator) =>
      element.evaluate((node) => {
        const computed = getComputedStyle(node);
        return {
          outline: computed.outlineStyle,
          width: computed.outlineWidth,
          color: computed.outlineColor,
          offset: computed.outlineOffset,
        };
      });
    const uploadFocus = await focusStyle(label);
    expect(uploadFocus).toEqual({
      outline: 'solid',
      width: '3px',
      color: 'rgb(79, 70, 229)',
      offset: '2px',
    });

    const bounds = await label.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(bounds!.x - 5).toBeGreaterThanOrEqual(0);
    expect(bounds!.y - 5).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width + 5).toBeLessThanOrEqual(viewport!.width);
    expect(bounds!.y + bounds!.height + 5).toBeLessThanOrEqual(viewport!.height);
    const ancestorsAllowOutline = await label.evaluate((element) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const { overflowX, overflowY } = getComputedStyle(parent);
        if (
          [overflowX, overflowY].some((overflow) =>
            ['auto', 'clip', 'hidden', 'scroll'].includes(overflow),
          )
        ) {
          return false;
        }
      }
      return true;
    });
    expect(ancestorsAllowOutline).toBe(true);

    await page.keyboard.press('Tab');
    const cameraButton = page.getByRole('button', { name: 'Open camera' });
    await expect(cameraButton).toBeFocused();
    expect(uploadFocus).toEqual(await focusStyle(cameraButton));
    await expect(label).toHaveCSS('outline-style', 'none');

    await page.keyboard.press('Shift+Tab');
    await expect(input).toBeFocused();
    await expect(label).toHaveCSS('outline-style', 'solid');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({ name: 'blank.png', mimeType: 'image/png', buffer: BLANK_PNG });
    await expect(page.getByRole('alert')).toContainText(
      'No readable QR code was found. Upload the original image or a crop with a clear white border around the whole QR code.',
    );
  });

  test('a chosen seat is announced as chosen, not only coloured', async ({ page, api }) => {
    await signInAs(page, customer);
    stubSeated(api);
    stubCustomer(api, {
      status: 'ADMITTED',
      position: 0,
      admissionToken: 'admission-token-for-the-test',
      tokenExpiresAt: soon(),
    });
    await page.goto('/events/7');
    await expect(page.getByText('It is your turn.')).toBeVisible();

    await page.getByRole('button', { name: /^A1 —/ }).click();

    await expect(page.getByRole('button', { name: /^A1 —/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
