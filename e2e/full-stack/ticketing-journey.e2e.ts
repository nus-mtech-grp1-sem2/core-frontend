import { expect, test } from '@playwright/test';

import { accessToken, useSession, userSub } from './support/auth';
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

let eventId = 0;
let qrPng: Buffer; // a screenshot of the first ticket's QR code, as a helper would be shown it

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => assertLocalStack());

/** `YYYY-MM-DDTHH:mm` in local time, `days` from now, as a datetime-local input expects. */
function startsAt(days: number): string {
  const date = new Date(Date.now() + days * 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test('organiser creates a general-admission event, sets inventory and publishes it', async ({
  browser,
}) => {
  const context = await browser.newContext();
  await useSession(context, 'organiser');
  const page = await context.newPage();

  await page.goto('/organiser/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByLabel('Title').fill(TITLE);
  await page.getByLabel('Description').fill('Created by the full-stack e2e suite');
  await page.getByLabel('Venue').fill('E2E Test Hall');
  await page.getByLabel('Starts at').fill(startsAt(7));
  await page.getByLabel('Total seats').fill('10');
  await page.getByLabel('Available buyers').fill('10');

  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/event/events') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create event' }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  eventId = ((await response.json()) as { eventId: number }).eventId;
  expect(eventId).toBeGreaterThan(0);

  // The inventory editor is a drag-to-draw seat map; configure it through the same call it makes.
  const inventory = await page.request.put(`/api/inventory/events/${eventId}/inventory`, {
    headers: { Authorization: `Bearer ${accessToken('organiser')}` },
    data: {
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
    },
  });
  expect(inventory.ok(), `inventory PUT -> ${inventory.status()} ${await inventory.text()}`).toBe(
    true,
  );

  await page.reload();
  const card = page.getByRole('listitem').filter({ hasText: TITLE });
  // Publishing asks for confirmation; Playwright dismisses dialogs unless one is accepted.
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('publish this event');
    await dialog.accept();
  });
  await card.getByRole('button', { name: 'Publish' }).click();
  await expect(card).toContainText('On sale');
  await context.close();
});

test('customer buys two tickets and sees each with a QR code', async ({ browser }) => {
  const context = await browser.newContext();
  await useSession(context, 'customer');
  const page = await context.newPage();

  await page.goto('/events');
  await page.getByRole('link', { name: TITLE }).first().click();
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
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

test('a helper who is not on the event team is refused by the backend', async ({ request }) => {
  const response = await request.post('/api/ticket/scanner/sessions', {
    headers: { Authorization: `Bearer ${accessToken('helper')}` },
    data: { eventId },
  });
  expect(response.status()).toBe(403);
});

test.describe('door check-in', () => {
  test.beforeAll(() => {
    // Assigning a helper normally goes through an invitation that looks the user up in
    // Cognito (needs AWS access). The local database is disposable, so seed the accepted row.
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
    await expect(page.getByRole('status').filter({ hasText: '0 of 2 checked in' })).toBeVisible();

    await upload(qrPng);
    await expect(page.getByRole('status').filter({ hasText: VALID })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '1 of 2 checked in' })).toBeVisible();

    await upload(qrPng);
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Already used. This ticket was checked in earlier.' }),
    ).toBeVisible();

    await upload(BLANK_PNG);
    await expect(page.getByRole('alert')).toContainText('No QR code could be read');
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
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe('Check in this ticket?');
      await dialog.accept();
    });
    await results.filter({ hasText: 'ISSUED' }).getByRole('button', { name: 'Check in' }).click();
    await expect(page.getByRole('status').filter({ hasText: VALID })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '2 of 2 checked in' })).toBeVisible();
    await context.close();
  });
});

test('organiser sees the sales and the attendees', async ({ browser }) => {
  const context = await browser.newContext();
  await useSession(context, 'organiser');
  const page = await context.newPage();

  await page.goto('/organiser/sales');
  const row = page.getByRole('row').filter({ hasText: TITLE });
  await expect(row).toContainText('On sale');
  await expect(row).toContainText('2');

  await page.goto('/organiser/attendees');
  await page.getByLabel('Filter by event').selectOption({ label: TITLE });
  await expect(
    page.getByRole('row').filter({ hasText: credentials('customer').email }),
  ).toBeVisible();
  await context.close();
});
