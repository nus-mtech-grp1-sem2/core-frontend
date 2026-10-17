import { expect, test } from '@playwright/test';
import { toBuffer } from 'qrcode';

import { accessToken, useSession, userSub } from './support/auth';
import {
  configureInventory,
  createEvent,
  publishEvent,
  setAvailableBuyers,
  signedInPage,
} from './support/events';
import { buyGaTicket, callAs, createPublishedGaEvent } from './support/orders';
import { admitNext, shortenAdmissionInterval } from './support/queue';
import { assertLocalStack, sql } from './support/stack';
import { credentials } from './support/users';

// One event moves through the whole ticketing journey, so these tests run in order and share
// state. The title carries a run id: the local database keeps events between runs.
const runId = Date.now().toString(36);
const TITLE = `E2E General Admission ${runId}`;

/** A 1x1 white PNG: a valid image that holds no QR code. */
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const VALID = 'Valid ticket. Check-in accepted.';

// A ticket bought under another name and email, and one for a different event.
const NAMED = { name: 'Nora Namesake', email: 'nora.namesake@example.com' };
const OTHER = { name: 'Wendy Wrongevent', email: 'wendy.wrongevent@example.com' };

let eventId = 0;
let namedOrderId = 0;
let otherOrderId = 0;
let qrPng: Buffer; // a screenshot of the first ticket's QR code, as a helper would be shown it
let otherEventQr: Buffer; // the QR code of a valid ticket for a different event

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => {
  assertLocalStack();
  // The door's manual lookup ignores searches shorter than two characters, so make sure order
  // ids have at least two digits even on a fresh database. (A value below the current maximum
  // is ignored, so this never lowers the counter.)
  sql('ALTER TABLE checkout.orders AUTO_INCREMENT = 100');
});

test('organiser creates a general-admission event, sets inventory and publishes it', async ({
  browser,
}) => {
  const page = await signedInPage(browser, 'organiser');
  eventId = await createEvent(page, {
    title: TITLE,
    tier: 'TIER1_GA',
  });
  await configureInventory(page.request, eventId, {
    name: 'General admission',
    price: 5,
    cols: 10,
  });
  await setAvailableBuyers(page.request, eventId, 10);
  await publishEvent(page, TITLE);
  // Customers are admitted to this event at different times below; don't make each wait 60 s.
  await shortenAdmissionInterval(page.request, eventId);
  await page.context().close();
});

test('customer queues, is admitted, buys two tickets and sees each with a QR code', async ({
  browser,
  request,
}) => {
  const context = await browser.newContext();
  await useSession(context, 'customer');
  const page = await context.newPage();

  // Every event sells through its queue, which the customer joins on opening the event.
  // The catalogue is paged and the local database keeps earlier events, so search for this one.
  await page.goto(`/events?q=${encodeURIComponent(TITLE)}`);
  await page.getByRole('link', { name: TITLE }).first().click();
  await page.waitForURL(new RegExp(`/events/${eventId}/queue$`));
  await expect(page.locator('.position strong')).toHaveText('1');

  // Automatic admission is off in this tier, so the organiser admits the customer.
  expect(await admitNext(request, eventId)).toMatchObject({ admitted: 1 });
  await page.waitForURL(new RegExp(`/events/${eventId}/tickets$`), { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
  await expect(page.getByText('It is your turn.')).toBeVisible();
  await page.getByLabel('Quantity').fill('2');
  await page.getByRole('button', { name: /Buy tickets/ }).click();

  await page.waitForURL(/\/checkout\/\d+/);
  await page.getByLabel('Card number').fill('4242424242424242');
  await page.getByLabel('Expiry date').fill('12/99');
  await page.getByLabel('CVC').fill('123');
  await page.getByRole('button', { name: /^Pay/ }).click();

  // Payment is simulated and settles after a short delay, then the app sends the customer on.
  await page.waitForURL(/\/my-events/, { timeout: 60_000 });
  const tickets = page.getByRole('article').filter({ hasText: TITLE });
  await expect(tickets).toHaveCount(2, { timeout: 60_000 });
  await expect(tickets.first()).toContainText('Ready to scan');
  const qr = tickets.first().getByRole('img', { name: /QR code for ticket/ });
  await expect(qr).toBeVisible();
  qrPng = await qr.screenshot();
  await context.close();
});

test('a differently named ticket and a ticket for another event are issued', async ({
  request,
}) => {
  const otherEventId = await createPublishedGaEvent(request, `E2E Other Event ${runId}`, 5);
  const [named, other] = await Promise.all([
    buyGaTicket(request, 'customer2', eventId, NAMED),
    buyGaTicket(request, 'customer', otherEventId, OTHER),
  ]);
  namedOrderId = named.orderId;
  otherOrderId = other.orderId;
  otherEventQr = await toBuffer(other.qrToken, { width: 320, margin: 4 });
});

test('a helper who is not on the event team is refused by the backend', async ({ request }) => {
  const response = await request.post('/api/ticket/scanner/sessions', {
    headers: { Authorization: `Bearer ${accessToken('helper')}` },
    data: { eventId },
  });
  expect(response.status()).toBe(403);
});

test.describe('door check-in', () => {
  test.beforeAll(() => {
    // Assigning a helper normally goes through an invitation (covered by team-invitations.e2e.ts).
    // Here the door is the subject, so seed the accepted row directly.
    sql(
      `INSERT INTO event_inventory.event_team_memberships
         (event_id, user_sub, user_email, role, invite_status, granted_by_sub)
       VALUES (${Number(eventId)}, '${userSub('helper')}', '${credentials('helper').email}',
               'HELPER', 'ACCEPTED', '${userSub('organiser')}')`,
    );
  });

  test('scans a QR image once, then reports it as already used', async ({ browser }) => {
    const context = await browser.newContext();
    await useSession(context, 'helper');
    const page = await context.newPage();
    const upload = (image: Buffer) =>
      page
        .getByLabel('Upload QR image')
        .setInputFiles({ name: 'ticket.png', mimeType: 'image/png', buffer: image });

    await page.goto(`/checkin/${eventId}`);
    await expect(page.getByRole('status').filter({ hasText: '0 of 3 checked in' })).toBeVisible();

    await upload(qrPng);
    await expect(page.getByRole('status').filter({ hasText: VALID })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '1 of 3 checked in' })).toBeVisible();

    await upload(qrPng);
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Already used. This ticket was checked in earlier.' }),
    ).toBeVisible();

    await upload(BLANK_PNG);
    await expect(page.getByRole('alert')).toContainText('No readable QR code was found');
    await context.close();
  });

  test('finds the other ticket by customer email and checks it in', async ({ browser }) => {
    const context = await browser.newContext();
    await useSession(context, 'helper');
    const page = await context.newPage();

    await page.goto(`/checkin/${eventId}`);
    await page.getByLabel('Name, email or order ID').fill(credentials('customer').email);
    const results = page.getByRole('listitem').filter({ hasText: 'General admission' });
    await expect(results).toHaveCount(2);

    // One ticket was scanned above; check in the one that is still ISSUED.
    await results.filter({ hasText: 'ISSUED' }).getByRole('button', { name: 'Check in' }).click();
    const confirmation = page.getByRole('dialog');
    await expect(confirmation.getByRole('heading')).toHaveText('Check in this ticket?');
    // Yes is the default answer, so Enter confirms.
    await expect(confirmation.getByRole('button', { name: 'Yes, check in' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: VALID })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '2 of 3 checked in' })).toBeVisible();
    await context.close();
  });

  test('finds a ticket by name, email or order id, only within this event', async ({ browser }) => {
    // The name comes from the purchase itself (customerName on the order), not seeded here.
    const context = await browser.newContext();
    await useSession(context, 'helper');
    const page = await context.newPage();
    await page.goto(`/checkin/${eventId}`);

    const search = page.getByLabel('Name, email or order ID');
    const results = page.getByRole('listitem').filter({ hasText: 'General admission' });
    for (const query of [NAMED.name.split(' ')[1], NAMED.email, String(namedOrderId)]) {
      await search.fill(query);
      await expect(page.getByRole('status').filter({ hasText: '1 result' })).toBeVisible();
      await expect(results).toHaveCount(1);
      await expect(results.first()).toContainText(NAMED.name);
    }

    // The other event's ticket exists, but this event's lookup must not reveal it.
    for (const query of [OTHER.name, OTHER.email, String(otherOrderId)]) {
      await search.fill(query);
      await expect(page.getByRole('status').filter({ hasText: '0 results' })).toBeVisible();
      await expect(results).toHaveCount(0);
    }

    await search.fill(NAMED.name);
    await expect(results).toHaveCount(1);
    await results.first().getByRole('button', { name: 'Check in' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, check in' }).click();
    await expect(page.getByRole('status').filter({ hasText: VALID })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '3 of 3 checked in' })).toBeVisible();
    await context.close();
  });

  test('a valid ticket for a different event is refused as the wrong event', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await useSession(context, 'helper');
    const page = await context.newPage();
    await page.goto(`/checkin/${eventId}`);
    await expect(page.getByRole('status').filter({ hasText: '3 of 3 checked in' })).toBeVisible();

    await page
      .getByLabel('Upload QR image')
      .setInputFiles({ name: 'other.png', mimeType: 'image/png', buffer: otherEventQr });
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Wrong event. This ticket is not assigned to this event.' }),
    ).toBeVisible();
    // Nothing was checked in by it.
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: '3 of 3 checked in' })).toBeVisible();
    await context.close();
  });
});

test('only the event organisers can manage the event', async ({ request }) => {
  const managing = (path: string, data: unknown = {}) => ({ path: `${path}`, data });
  const actions = [
    { method: 'post', ...managing(`/api/event/events/${eventId}/publish`) },
    { method: 'post', ...managing(`/api/event/events/${eventId}/cancel`) },
    {
      method: 'put',
      ...managing(`/api/queue/events/${eventId}/queue/config`, {
        opensAt: new Date().toISOString(),
        admissionBatchSize: 1,
        admissionIntervalSec: 60,
      }),
    },
    { method: 'post', ...managing(`/api/queue/events/${eventId}/queue/admit-next`) },
  ] as const;

  // A customer and a helper (who is on this event's team, but as a helper) are both refused.
  for (const role of ['customer', 'helper'] as const) {
    for (const action of actions) {
      const response = await callAs(request, role, action.method, action.path, action.data);
      expect(response.status(), `${role} ${action.path}`).toBe(403);
      expect(((await response.json()) as { error: string }).error).toBe('event_organiser_required');
    }
  }

  const anonymous = await request.post(`/api/event/events/${eventId}/cancel`, { data: {} });
  expect(anonymous.status()).toBe(401);
  expect(((await anonymous.json()) as { error: string }).error).toBe('unauthenticated');

  // Nothing above changed the event: it is still on sale.
  expect(sql(`SELECT status FROM event_inventory.events WHERE event_id = ${Number(eventId)}`)).toBe(
    'PUBLISHED',
  );
});

test('organiser sees the sales and the attendees', async ({ browser }) => {
  const context = await browser.newContext();
  await useSession(context, 'organiser');
  const page = await context.newPage();

  await page.goto('/organiser/sales');
  const row = page.getByRole('row').filter({ hasText: TITLE });
  await expect(row).toContainText('On sale');
  await expect(row).toContainText('3');

  await page.goto('/organiser/attendees');
  await page.getByLabel('Filter by event').selectOption({ label: TITLE });
  await expect(
    page.getByRole('row').filter({ hasText: credentials('customer').email }),
  ).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: NAMED.email })).toBeVisible();

  // The event page shows the team roster and how far check-in has got.
  await page.goto(`/organiser/events/${eventId}`);
  await expect(
    page.getByRole('listitem').filter({ hasText: credentials('helper').email }),
  ).toContainText('Helper · accepted');
  await expect(page.locator('#checkin-heading + .inventory-summary')).toContainText(
    '3 of 3 checked in',
  );
  await context.close();
});
