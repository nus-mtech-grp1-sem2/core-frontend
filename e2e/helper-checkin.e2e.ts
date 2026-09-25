import { toBuffer } from 'qrcode';

import { expect, test } from './support/fixtures';
import { helper, signInAs } from './support/session';

const EVENT_ID = 7;
const SCANNER_TOKEN = 'scanner-session-test-token';
const TICKET_TOKEN = 'tkt_test_0123456789abcdef';

/** A 1x1 white PNG: a valid image that contains no QR code. */
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeEach(async ({ page, api }) => {
  await signInAs(page, helper);
  api
    .on('GET', 'event/helper/shifts', {
      json: {
        events: [
          {
            event_id: EVENT_ID,
            title: 'E2E Helper Concert',
            starts_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          },
        ],
      },
    })
    .on('POST', 'ticket/scanner/sessions', { json: { sessionToken: SCANNER_TOKEN } })
    .on('GET', `ticket/events/${EVENT_ID}/checkin-stats`, { json: { checkedIn: 3, issued: 10 } });
});

async function uploadQr(page: import('@playwright/test').Page, image: Buffer) {
  await page.getByLabel('Upload QR image').setInputFiles({
    name: 'ticket.png',
    mimeType: 'image/png',
    buffer: image,
  });
}

test('shows the door workspace for an assigned event', async ({ page }) => {
  await page.goto(`/checkin/${EVENT_ID}`);
  await expect(page.getByRole('status').filter({ hasText: '3 of 10 checked in' })).toBeVisible();
});

const outcomes = [
  { apiOutcome: 'SUCCESS', message: 'Valid ticket. Check-in accepted.' },
  { apiOutcome: 'DUPLICATE', message: 'Already used. This ticket was checked in earlier.' },
  {
    apiOutcome: 'WRONG_EVENT',
    message: 'Wrong event. This ticket is not assigned to this event.',
  },
  { apiOutcome: 'INVALID', message: 'Invalid ticket. It could not be checked in.' },
] as const;

for (const { apiOutcome, message } of outcomes) {
  test(`uploaded QR: ${apiOutcome} is reported as "${message}"`, async ({ page, api }) => {
    api.on('POST', 'ticket/tickets/validate', { json: { outcome: apiOutcome } });
    await page.goto(`/checkin/${EVENT_ID}`);

    await uploadQr(page, await toBuffer(TICKET_TOKEN, { width: 320, margin: 4 }));

    await expect(page.getByRole('status').filter({ hasText: message })).toBeVisible();

    const [validate] = api.requests('POST', 'ticket/tickets/validate');
    expect(validate.postDataJSON()).toEqual({ qrToken: TICKET_TOKEN });
    expect(await validate.headerValue('authorization')).toBe(`Bearer ${SCANNER_TOKEN}`);
  });
}

test('an image with no QR code is rejected without calling ticket validation', async ({
  page,
  api,
}) => {
  await page.goto(`/checkin/${EVENT_ID}`);

  await uploadQr(page, BLANK_PNG);

  await expect(page.getByRole('alert')).toContainText('No QR code could be read from that image.');
  expect(api.requests('POST', 'ticket/tickets/validate')).toHaveLength(0);
});

test('a helper not assigned to the event is told so', async ({ page, api }) => {
  api.on('POST', 'ticket/scanner/sessions', { status: 403, json: { error: 'forbidden' } });
  await page.goto(`/checkin/${EVENT_ID}`);

  await expect(page.getByRole('alert')).toContainText(
    'This event is not assigned to your helper account.',
  );
});
